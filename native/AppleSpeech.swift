// JSONL protocol v1. The host owns microphone capture, permissions and files.
import Foundation
import AVFoundation
import Speech

private let outputLock = NSLock()
func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    outputLock.lock()
    FileHandle.standardOutput.write(data + Data([10]))
    outputLock.unlock()
}
struct RuntimeFailure: Error { let code: String }
func fail(_ code: String) -> RuntimeFailure { RuntimeFailure(code: code) }
@available(macOS 26, *)
func speechFailureCode(_ error: Error) -> String {
    if let local = error as? RuntimeFailure { return local.code }
    if error is CancellationError { return "session_closed" }
    let native = error as NSError
    if native.domain == SFSpeechError.errorDomain {
        let codes: [SFSpeechError.Code: String] = [
            .audioDisordered: "audio_disordered", .unexpectedAudioFormat: "audio_format",
            .noModel: "assets_not_ready", .assetLocaleNotAllocated: "locale_not_reserved",
            .tooManyAssetLocalesAllocated: "locale_reservation_limit", .incompatibleAudioFormats: "audio_format",
            .moduleOutputFailed: "module_output_failed", .cannotAllocateUnsupportedLocale: "locale_unsupported",
            .insufficientResources: "insufficient_resources",
        ]
        if let code = SFSpeechError.Code(rawValue: native.code), let reason = codes[code] { return reason }
    }
    return "apple_analysis_failed"
}

// ACK means that the SDK has pulled the buffer, not merely that JSON was read.
// This keeps offline files bounded without pacing them artificially in real time.
final class InputReceipt: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    private var completed = false
    private var failure: Error?
    func set(_ continuation: CheckedContinuation<Void, Error>) {
        lock.lock(); let done = completed, error = failure
        if !done { self.continuation = continuation }
        lock.unlock()
        if done { if let error { continuation.resume(throwing: error) } else { continuation.resume() } }
    }
    func complete(_ error: Error? = nil) {
        lock.lock()
        if completed { lock.unlock(); return }
        completed = true; failure = error
        let current = continuation; continuation = nil; lock.unlock()
        if let error { current?.resume(throwing: error) } else { current?.resume() }
    }
}
final class ReceiptRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: [UUID: InputReceipt] = [:]
    func add(_ id: UUID, _ receipt: InputReceipt) { lock.lock(); pending[id] = receipt; lock.unlock() }
    func remove(_ id: UUID) { lock.lock(); pending.removeValue(forKey: id); lock.unlock() }
    func cancel() {
        lock.lock(); let current = Array(pending.values); pending.removeAll(); lock.unlock()
        for receipt in current { receipt.complete(fail("session_closed")) }
    }
}
@available(macOS 26, *)
struct QueuedInput: @unchecked Sendable { let input: AnalyzerInput; let receipt: InputReceipt }
@available(macOS 26, *)
struct AcknowledgedInputs: AsyncSequence, Sendable {
    typealias Element = AnalyzerInput
    let stream: AsyncStream<QueuedInput>
    struct AsyncIterator: AsyncIteratorProtocol {
        var base: AsyncStream<QueuedInput>.Iterator
        mutating func next() async -> AnalyzerInput? {
            guard let packet = await base.next() else { return nil }
            packet.receipt.complete()
            return packet.input
        }
    }
    func makeAsyncIterator() -> AsyncIterator { AsyncIterator(base: stream.makeAsyncIterator()) }
}

@available(macOS 26, *)
actor AnalysisSession {
    let id: String
    let analyzer: SpeechAnalyzer
    let transcriber: SpeechTranscriber
    let inputFormat: AVAudioFormat
    let outputFormat: AVAudioFormat
    let converter: AVAudioConverter
    let continuation: AsyncStream<QueuedInput>.Continuation
    let receipts = ReceiptRegistry()
    var reader: Task<Void, Error>?
    var sequence = 0
    var outputFrames: Int64 = 0
    var inputFrames: Int64 = 0
    var finished = false
    var feeding = false
    var cancelled = false

    init(id: String, profile: String, rate: Double, channels: AVAudioChannelCount) async throws {
        self.id = id
        var reports: Set<SpeechTranscriber.ReportingOption> = [.volatileResults]
        if profile == "responsive" { reports.insert(.fastResults) }
        transcriber = SpeechTranscriber(locale: Locale(identifier: "zh-TW"), transcriptionOptions: [], reportingOptions: reports, attributeOptions: [.audioTimeRange])
        guard let target = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]),
              let source = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: channels, interleaved: false),
              let conversion = AVAudioConverter(from: source, to: target) else { throw fail("audio_format") }
        inputFormat = source; outputFormat = target; converter = conversion
        converter.primeMethod = .none
        analyzer = SpeechAnalyzer(modules: [transcriber], options: .init(priority: .userInitiated, modelRetention: .whileInUse))
        let (stream, continuation) = AsyncStream<QueuedInput>.makeStream(bufferingPolicy: .bufferingOldest(20))
        self.continuation = continuation
        try await analyzer.prepareToAnalyze(in: target)
        let transcriber = self.transcriber
        let receipts = self.receipts
        reader = Task {
          do {
            for try await result in transcriber.results {
                let start = CMTimeGetSeconds(result.range.start)
                let end = CMTimeGetSeconds(CMTimeRangeGetEnd(result.range))
                let watermark = CMTimeGetSeconds(result.resultsFinalizationTime)
                guard start.isFinite, end.isFinite, end >= start else { throw fail("result_range") }
                var units: [[String: Any]] = []
                var prefix = ""
                for run in result.text.runs {
                    let text = String(result.text[run.range].characters)
                    if let time = run.audioTimeRange {
                        let a = CMTimeGetSeconds(time.start), b = CMTimeGetSeconds(CMTimeRangeGetEnd(time))
                        if a.isFinite && b.isFinite && b >= a {
                            units.append(["text": prefix + text, "start": a, "end": b]); prefix = ""
                        } else { prefix += text }
                    } else if !units.isEmpty {
                        let last = units.count - 1
                        units[last]["text"] = (units[last]["text"] as? String ?? "") + text
                    } else { prefix += text }
                }
                if !prefix.isEmpty && !units.isEmpty { units[units.count - 1]["text"] = (units.last?["text"] as? String ?? "") + prefix }
                emit(["event": "result", "sessionId": id, "text": String(result.text.characters), "start": start, "end": end, "units": units, "finalizedThrough": watermark.isFinite ? watermark : result.isFinal ? end : 0, "isFinal": result.isFinal])
            }
          } catch { receipts.cancel(); throw error }
        }
        do { try await analyzer.start(inputSequence: AcknowledgedInputs(stream: stream)) }
        catch { reader?.cancel(); continuation.finish(); throw error }
    }

    func convert(_ source: AVAudioPCMBuffer?, end: Bool) async throws {
        var supplied = false
        while true {
            let capacity = AVAudioFrameCount(max(512, ceil(Double(source?.frameLength ?? 0) * outputFormat.sampleRate / inputFormat.sampleRate) + 512))
            guard let out = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { throw fail("audio_format") }
            var conversionError: NSError?
            let status = converter.convert(to: out, error: &conversionError) { _, state in
                if !supplied, let source {
                    supplied = true; state.pointee = .haveData; return source
                }
                state.pointee = end ? .endOfStream : .noDataNow
                return nil
            }
            if conversionError != nil || status == .error { throw fail("audio_conversion") }
            if out.frameLength > 0 {
                let time = CMTime(value: outputFrames, timescale: CMTimeScale(outputFormat.sampleRate))
                let id = UUID(), receipt = InputReceipt()
                receipts.add(id, receipt)
                defer { receipts.remove(id) }
                try await withCheckedThrowingContinuation { (accepted: CheckedContinuation<Void, Error>) in
                    receipt.set(accepted)
                    let result = continuation.yield(QueuedInput(input: AnalyzerInput(buffer: out, bufferStartTime: time), receipt: receipt))
                    switch result {
                    case .enqueued: break
                    case .dropped: receipt.complete(fail("audio_backpressure"))
                    case .terminated: receipt.complete(fail("session_closed"))
                    @unknown default: receipt.complete(fail("audio_backpressure"))
                    }
                }
                outputFrames += Int64(out.frameLength)
            }
            if status != .haveData { break }
        }
    }

    func feed(_ command: [String: Any]) async throws {
        guard !finished, !feeding, command["sequence"] as? Int == sequence,
              let frames = command["frames"] as? Int, frames > 0, frames <= Int(inputFormat.sampleRate / 5),
              command["sampleRate"] as? Double == inputFormat.sampleRate,
              command["channelCount"] as? Int == Int(inputFormat.channelCount),
              let encoded = command["pcm"] as? String, let bytes = Data(base64Encoded: encoded),
              bytes.count == frames * Int(inputFormat.channelCount) * 2,
              let buffer = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(frames)),
              let planes = buffer.floatChannelData else { throw fail("audio_protocol") }
        feeding = true
        defer { feeding = false }
        buffer.frameLength = AVAudioFrameCount(frames)
        bytes.withUnsafeBytes { raw in
            for frame in 0..<frames {
                for channel in 0..<Int(inputFormat.channelCount) {
                    let index = (frame * Int(inputFormat.channelCount) + channel) * 2
                    let sample = Int16(bitPattern: UInt16(raw[index]) | (UInt16(raw[index + 1]) << 8))
                    planes[channel][frame] = Float(sample) / 32768
                }
            }
        }
        try await convert(buffer, end: false)
        inputFrames += Int64(frames); sequence += 1
    }

    func finish() async throws -> Double {
        guard !finished, !feeding else { throw fail("session_closed") }
        finished = true
        try await convert(nil, end: true)
        continuation.finish()
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        try await reader?.value
        return Double(inputFrames) / inputFormat.sampleRate
    }

    func cancel() async {
        if cancelled { return }
        cancelled = true
        finished = true; receipts.cancel(); continuation.finish(); reader?.cancel()
        await analyzer.cancelAndFinishNow()
        _ = try? await reader?.value
        reader = nil
    }
}

@available(macOS 26, *)
actor SpeechServer {
    var session: AnalysisSession?
    func module(_ profile: String) -> SpeechTranscriber {
        SpeechTranscriber(locale: Locale(identifier: "zh-TW"), transcriptionOptions: [], reportingOptions: profile == "responsive" ? [.volatileResults, .fastResults] : [.volatileResults], attributeOptions: [.audioTimeRange])
    }
    func probe(_ profile: String) async throws -> [String: Any] {
        guard SpeechTranscriber.isAvailable else { return ["state": "unavailable", "reason": "device_unsupported"] }
        let locales = await SpeechTranscriber.supportedLocales
        let exact = locales.contains { $0.language.languageCode?.identifier == "zh" && $0.region?.identifier == "TW" && $0.language.script?.identifier != "Hans" }
        guard exact else { return ["state": "unavailable", "reason": "locale_unsupported"] }
        let status = await AssetInventory.status(forModules: [module(profile)])
        switch status {
        case .installed: return ["state": "ready", "locale": "zh-TW"]
        case .downloading: return ["state": "downloading", "locale": "zh-TW"]
        case .supported: return ["state": "needs_download", "locale": "zh-TW"]
        case .unsupported: return ["state": "unavailable", "reason": "assets_unsupported"]
        @unknown default: throw fail("assets_unknown")
        }
    }
    func handle(_ command: [String: Any]) async -> Bool {
        let id = command["id"] as? String ?? ""
        let op = command["op"] as? String ?? ""
        let profile = command["profile"] as? String ?? "accurate"
        do {
            guard !id.isEmpty, ["accurate", "responsive"].contains(profile) else { throw fail("protocol_invalid") }
            var result: [String: Any] = [:]
            switch op {
            case "hello": result = ["protocol": 1]
            case "probe": result = try await probe(profile)
            case "prepare":
                let transcriber = module(profile)
                guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else { throw fail("audio_format") }
                let analyzer = SpeechAnalyzer(modules: [transcriber], options: .init(priority: .userInitiated, modelRetention: .whileInUse))
                try await analyzer.prepareToAnalyze(in: format)
            case "install":
                let capability = try await probe(profile)
                guard capability["state"] as? String != "unavailable" else { throw fail("locale_unsupported") }
                _ = try await AssetInventory.reserve(locale: Locale(identifier: "zh-TW"))
                if let request = try await AssetInventory.assetInstallationRequest(supporting: [module(profile)]) {
                    let monitor = Task {
                        while !Task.isCancelled {
                            emit(["event": "download", "progress": request.progress.fractionCompleted])
                            try? await Task.sleep(for: .milliseconds(250))
                        }
                    }
                    defer { monitor.cancel() }
                    try await request.downloadAndInstall()
                }
                result = try await probe(profile)
            case "start":
                guard session == nil, let sid = command["sessionId"] as? String,
                      let rate = command["sampleRate"] as? Double, rate >= 8000, rate <= 96000,
                      let channels = command["channelCount"] as? Int, (1...2).contains(channels) else { throw fail("audio_protocol") }
                guard try await probe(profile)["state"] as? String == "ready" else { throw fail("assets_not_ready") }
                session = try await AnalysisSession(id: sid, profile: profile, rate: rate, channels: AVAudioChannelCount(channels))
            case "feed", "finish", "cancel":
                guard let active = session, active.id == command["sessionId"] as? String else { throw fail("session_closed") }
                if op == "feed" { try await active.feed(command) }
                else if op == "finish" { result["duration"] = try await active.finish(); session = nil }
                else { await active.cancel(); session = nil }
            case "shutdown":
                if let active = session { await active.cancel(); session = nil }
            default: throw fail("protocol_invalid")
            }
            emit(["id": id, "success": true, "result": result])
        } catch {
            if let active = session { await active.cancel(); session = nil }
            let code = speechFailureCode(error)
            emit(["id": id, "success": false, "error": code])
        }
        return op != "shutdown"
    }
}

@main struct AppleSpeech {
    static func main() async {
        if #available(macOS 26, *) {
            let server = SpeechServer()
            await Task.detached {
                while let line = readLine() {
                    guard line.utf8.count <= 262144, let bytes = line.data(using: .utf8),
                          let command = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
                        emit(["success": false, "error": "protocol_invalid"]); break
                    }
                    // Finish and shared asset installation may await for a long
                    // time. Keep reading so cancel/shutdown can reenter actor.
                    if ["feed", "finish", "install"].contains(command["op"] as? String ?? "") {
                        Task { _ = await server.handle(command) }
                    } else if !(await server.handle(command)) { break }
                }
            }.value
        }
    }
}
