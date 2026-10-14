// Standalone experiment. No microphone access or changes to SpeakSlow settings.
import Foundation
import AVFoundation
import Speech

func now() -> Double { ProcessInfo.processInfo.systemUptime }
func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}

struct Event: Sendable {
    let text: String
    let final: Bool
    let audioEnd: Double
}

@main struct Benchmark {
    static func main() async {
        do { try await run() }
        catch { emit(["type": "error", "error": String(describing: error)]); exit(1) }
    }

    static func run() async throws {
        let args = CommandLine.arguments
        guard (4...5).contains(args.count), ["speech", "speech-fast", "dictation"].contains(args[2]), ["bulk", "realtime"].contains(args[3]) else { throw NSError(domain: "usage: benchmark manifest.json speech|speech-fast|dictation bulk|realtime [resources]", code: 1) }
        let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[1]))) as! [[String: Any]]
        let engine = args[2]
        let paced = args[3] == "realtime"
        let resources = args.count == 5 && args[4] == "resources"
        let locale = Locale(identifier: "zh-TW")
        let installed = engine.hasPrefix("speech") ? await SpeechTranscriber.installedLocales : await DictationTranscriber.installedLocales
        emit(["type": "capability", "engine": engine, "installed_locales": installed.map { $0.identifier }, "speech_available": SpeechTranscriber.isAvailable])

        for (index, item) in manifest.enumerated() {
            let assetStart = now()
            let module: any SpeechModule
            let events: AsyncThrowingStream<Event, Error>
            if engine.hasPrefix("speech") {
                let reports: Set<SpeechTranscriber.ReportingOption> = engine == "speech-fast" ? [.volatileResults, .fastResults] : [.volatileResults]
                let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: reports, attributeOptions: [.audioTimeRange])
                module = transcriber
                events = AsyncThrowingStream { continuation in
                    let task = Task {
                        do {
                            for try await result in transcriber.results {
                                continuation.yield(Event(text: String(result.text.characters), final: result.isFinal, audioEnd: CMTimeGetSeconds(CMTimeRangeGetEnd(result.range))))
                            }
                            continuation.finish()
                        } catch { continuation.finish(throwing: error) }
                    }
                    continuation.onTermination = { _ in task.cancel() }
                }
            } else {
                let transcriber = DictationTranscriber(locale: locale, preset: .progressiveLongDictation)
                module = transcriber
                events = AsyncThrowingStream { continuation in
                    let task = Task {
                        do {
                            for try await result in transcriber.results {
                                continuation.yield(Event(text: String(result.text.characters), final: result.isFinal, audioEnd: CMTimeGetSeconds(CMTimeRangeGetEnd(result.range))))
                            }
                            continuation.finish()
                        } catch { continuation.finish(throwing: error) }
                    }
                    continuation.onTermination = { _ in task.cancel() }
                }
            }
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
                emit(["type": "asset_download", "engine": engine])
                try await request.downloadAndInstall()
            }
            let assetMS = (now() - assetStart) * 1000
            let file = try AVAudioFile(forReading: URL(fileURLWithPath: item["path"] as! String))
            let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [module])!
            let converter = AnalyzerInputConverter(analyzerFormat: format)
            let analyzer = SpeechAnalyzer(modules: [module], options: .init(priority: .userInitiated, modelRetention: .processLifetime))
            let prepareStart = now()
            try await analyzer.prepareToAnalyze(in: format)
            let prepareMS = (now() - prepareStart) * 1000
            let (inputs, continuation) = AsyncStream<AnalyzerInput>.makeStream()
            try await analyzer.start(inputSequence: inputs)
            if resources && index == 0 {
                emit(["type": "phase", "phase": "ready_idle", "uptime_s": now()])
                try await Task.sleep(for: .seconds(3))
                emit(["type": "phase", "phase": "workload", "uptime_s": now()])
            }
            let start = now()
            let reader = Task { () throws -> ([String: Any]) in
                var finals: [String] = []
                var observations: [[String: Any]] = []
                for try await event in events {
                    let t = (now() - start) * 1000
                    if !event.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        observations.append(["elapsed_ms": t, "text": event.text, "final": event.final, "audio_end_s": event.audioEnd])
                    }
                    if event.final { finals.append(event.text) }
                }
                return ["text": finals.joined(), "events": observations, "complete_ms": (now() - start) * 1000]
            }
            let rate = file.processingFormat.sampleRate
            let duration = Double(file.length) / rate
            let chunkFrames = AVAudioFrameCount(rate * 0.1)
            var frames: AVAudioFramePosition = 0
            while frames < file.length {
                let count = AVAudioFrameCount(min(AVAudioFramePosition(chunkFrames), file.length - frames))
                let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: count)!
                try file.read(into: buffer, frameCount: count)
                frames += AVAudioFramePosition(buffer.frameLength)
                if paced {
                    let delay = start + Double(frames) / rate - now()
                    if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
                }
                for input in try converter.convert(buffer, at: nil) { continuation.yield(input) }
            }
            for input in try converter.flush() { continuation.yield(input) }
            let inputEnd = now()
            continuation.finish()
            try await analyzer.finalizeAndFinishThroughEndOfInput()
            var result = try await reader.value
            result["type"] = "result"
            result["id"] = item["id"]
            result["engine"] = engine
            result["mode"] = paced ? "realtime" : "bulk"
            result["duration_s"] = duration
            result["prepare_ms"] = prepareMS
            result["assets_ms"] = assetMS
            result["feed_end_ms"] = (inputEnd - start) * 1000
            result["tail_ms"] = (now() - inputEnd) * 1000
            emit(result)
        }
        if resources {
            emit(["type": "phase", "phase": "post_idle", "uptime_s": now()])
            try await Task.sleep(for: .seconds(5))
            emit(["type": "phase", "phase": "exit", "uptime_s": now()])
        }
    }
}
