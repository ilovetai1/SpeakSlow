// Owned JSONL helper. stdout is protocol only; no request/model content is logged.
import Foundation
import FoundationModels
import Darwin

private let protocolVersion = 1
private let maximumMessageBytes = 262_144
private let maximumTextBytes = 131_072
private let maximumOutputTokens = 2_048
// Additional conservative headroom after counting the actual transcript entries.
private let framingAllowance = 64

private struct Request: Decodable, Sendable {
    let protocolVersion: Int
    let id: String
    let generation: Int
    let op: String
    let instructions: String?
    let prompt: String?
    let locale: String?
    let maxOutputTokens: Int?
    let timeoutMs: Int?
    let targetId: String?
    let targetGeneration: Int?
}

private struct Payload: Encodable, Sendable {
    var helper: String?
    var maximumMessageBytes: Int?
    var state: String?
    var available: Bool?
    var reason: String?
    var variant: String?
    var modelDisplayName: String?
    var locale: String?
    var contextSize: Int?
    var tokenCounting: Bool?
    var osVersion: String?
    var text: String?
    var complete: Bool?
    var inputTokenCount: Int?
    var outputTokenCount: Int?
    var maxOutputTokens: Int?
    var framingAllowance: Int?
}

private struct Envelope: Encodable {
    let protocolVersion: Int
    let id: String
    let generation: Int
    let success: Bool
    let result: Payload?
    let code: String?
}

private enum Output {
    static func send(_ request: Request, result: Payload? = nil, code: String? = nil) {
        let envelope = Envelope(protocolVersion: protocolVersion, id: request.id,
            generation: request.generation, success: code == nil, result: result, code: code)
        guard let data = try? JSONEncoder().encode(envelope), data.count + 1 <= maximumMessageBytes else {
            let error = Envelope(protocolVersion: protocolVersion, id: request.id,
                generation: request.generation, success: false, result: nil, code: "output_over_limit")
            guard let bytes = try? JSONEncoder().encode(error) else { Darwin.exit(2) }
            FileHandle.standardOutput.write(bytes + Data([10]))
            return
        }
        FileHandle.standardOutput.write(data + Data([10]))
    }
}

private struct Failure: Error { let code: String }
private func failure(_ code: String) -> Failure { Failure(code: code) }

@available(macOS 27, *)
private func errorCode(_ error: Error) -> String {
    if let local = error as? Failure { return local.code }
    if error is CancellationError { return "cancelled" }
    if let native = error as? LanguageModelError {
        switch native {
        case .contextSizeExceeded: return "context_exceeded"
        case .guardrailViolation: return "guardrail_violation"
        case .refusal: return "refusal"
        case .unsupportedLanguageOrLocale: return "locale_unsupported"
        case .timeout: return "timeout"
        case .rateLimited: return "rate_limited"
        case .unsupportedCapability: return "capability_unavailable"
        case .unsupportedTranscriptContent, .unsupportedGenerationGuide: return "input_invalid"
        @unknown default: return "provider_error"
        }
    }
    if let native = error as? SystemLanguageModel.Error {
        switch native {
        case .assetsUnavailable: return "model_not_ready"
        @unknown default: return "provider_error"
        }
    }
    if error is LanguageModelSession.Error { return "provider_busy" }
    // Never copy localizedDescription/debugDescription: they may include content.
    return "provider_error"
}

@available(macOS 27, *)
private actor Runtime {
    private var active: (request: Request, task: Task<Void, Never>)?
    private var seen = Set<String>()

    private func capabilities(_ model: SystemLanguageModel) -> Payload {
        var result = Payload()
        result.locale = "zh-TW"
        result.osVersion = ProcessInfo.processInfo.operatingSystemVersionString
        result.tokenCounting = true
        result.available = false
        result.state = "unavailable"
        switch model.availability {
        case .available: break
        case .unavailable(let reason):
            switch reason {
            case .deviceNotEligible: result.reason = "device_not_eligible"
            case .appleIntelligenceNotEnabled: result.reason = "apple_intelligence_not_enabled"
            case .modelNotReady: result.reason = "model_not_ready"
            @unknown default: result.reason = "model_unavailable"
            }
            return result
        }
        guard model.supportsLocale(Locale(identifier: "zh-TW")) else {
            result.reason = "locale_unsupported"; return result
        }
        guard model.contextSize > 0 else {
            result.reason = "capability_unavailable"; return result
        }
        if model.variant == .core3 { result.variant = "core3" }
        else if model.variant == .coreAdvanced3 { result.variant = "core_advanced3" }
        else { result.reason = "capability_unavailable"; return result }
        result.modelDisplayName = model.variant.displayName
        result.contextSize = model.contextSize
        result.available = true
        result.state = "ready"
        return result
    }

    func handle(_ request: Request) {
        guard request.protocolVersion == protocolVersion,
              UUID(uuidString: request.id) != nil,
              request.generation >= 0 else { Darwin.exit(2) }
        // Bounded replay protection; a host uses a fresh generation for each job.
        guard !seen.contains(request.id) else { Darwin.exit(2) }
        if seen.count >= 256 { seen.removeAll(keepingCapacity: true) }
        seen.insert(request.id)
        switch request.op {
        case "handshake":
            var result = Payload(); result.helper = "apple-foundation-models"
            result.maximumMessageBytes = maximumMessageBytes
            Output.send(request, result: result)
        case "probe":
            Output.send(request, result: capabilities(SystemLanguageModel.default))
        case "generate":
            guard active == nil else { Output.send(request, code: "provider_busy"); return }
            guard let instructions = request.instructions, let prompt = request.prompt,
                  !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  instructions.utf8.count <= maximumTextBytes, prompt.utf8.count <= maximumTextBytes,
                  request.locale == "zh-TW", let limit = request.maxOutputTokens,
                  (1...maximumOutputTokens).contains(limit), let deadline = request.timeoutMs,
                  (1...60_000).contains(deadline) else {
                Output.send(request, code: "input_invalid"); return
            }
            let task = Task { await self.generate(request, instructions: instructions, prompt: prompt, limit: limit) }
            active = (request, task)
        case "cancel":
            guard let current = active, current.request.id == request.targetId,
                  current.request.generation == request.targetGeneration else {
                Output.send(request, result: Payload()); return
            }
            current.task.cancel()
            Task {
                // ACK only after the framework task releases its session. The host
                // terminates this owned helper if that does not happen in time.
                await current.task.value
                Output.send(request, result: Payload())
            }
        default: Output.send(request, code: "input_invalid")
        }
    }

    private func generate(_ request: Request, instructions: String, prompt: String, limit: Int) async {
        defer { if active?.request.id == request.id { active = nil } }
        do {
            try Task.checkCancellation()
            let model = SystemLanguageModel.default // Default guardrails; never PCC.
            var result = capabilities(model)
            guard result.available == true else { throw failure(result.reason ?? "model_unavailable") }
            let localeInstruction = "目標語系為 zh-TW；需要中文輸出時使用臺灣繁體中文。保留任務要求保留的原文語言與中英混用。"
            let session = LanguageModelSession(model: model, instructions: Instructions(instructions + "\n" + localeInstruction))
            let options = GenerationOptions(samplingMode: .greedy, maximumResponseTokens: limit, toolCallingMode: .disallowed)
            // Count the actual fresh session plus the exact prompt entry, including
            // native framing and generation configuration; no character heuristic.
            var entries = Array(session.transcript)
            entries.append(.prompt(Transcript.Prompt(segments: [.text(.init(content: prompt))], options: options)))
            let inputCount: Int
            do { inputCount = try await model.tokenCount(for: entries) }
            catch {
                try Task.checkCancellation()
                let code = errorCode(error)
                throw failure(code == "provider_error" ? "budget_unavailable" : code)
            }
            try Task.checkCancellation()
            guard inputCount > 0, let capacity = result.contextSize else { throw failure("budget_unavailable") }
            guard inputCount <= capacity - limit - framingAllowance else { throw failure("context_exceeded") }
            let response = try await session.respond(to: Prompt(prompt), options: options)
            try Task.checkCancellation()
            let outputCount = response.usage.output.totalTokenCount
            // maximumResponseTokens can stop without an error. Equality is
            // conservatively rejected even if natural completion coincides.
            guard outputCount > 0 else { throw failure("invalid_response") }
            guard outputCount < limit else { throw failure("output_over_limit") }
            guard response.usage.input.totalTokenCount >= 0,
                  response.usage.input.totalTokenCount + outputCount <= capacity else { throw failure("context_exceeded") }
            let text = response.content
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw failure("invalid_response") }
            guard text.utf8.count <= maximumTextBytes else { throw failure("output_over_limit") }
            result.text = text; result.complete = true
            result.inputTokenCount = inputCount; result.outputTokenCount = outputCount
            result.maxOutputTokens = limit; result.framingAllowance = framingAllowance
            Output.send(request, result: result)
        } catch {
            Output.send(request, code: Task.isCancelled ? "cancelled" : errorCode(error))
        }
    }

    func stop() async {
        if let current = active { current.task.cancel(); await current.task.value }
    }
}

@main
private struct AppleFoundationModelsHelper {
    static func main() async {
        #if !arch(arm64)
        Darwin.exit(2)
        #else
        guard #available(macOS 27, *) else { Darwin.exit(2) }
        let runtime = Runtime()
        // readLine() is unbounded. Parse finite byte chunks, reject overlong lines
        // before decoding, and never emit the offending input as diagnostics.
        await Task.detached {
            // Blocking stdin reads must not occupy the main actor used by the
            // framework. The actor remains reentrant while inference awaits.
            var frame = Data()
            var bytes = [UInt8](repeating: 0, count: 4096)
            while true {
                // FileHandle.read(upToCount:) may wait to fill the requested
                // length on a pipe. POSIX read returns the available bytes.
                let count = bytes.withUnsafeMutableBytes { Darwin.read(STDIN_FILENO, $0.baseAddress, $0.count) }
                if count < 0 { if errno == EINTR { continue }; Darwin.exit(2) }
                if count == 0 { break }
                for byte in bytes.prefix(count) {
                    if byte == 10 {
                        guard !frame.isEmpty, let request = try? JSONDecoder().decode(Request.self, from: frame) else { Darwin.exit(2) }
                        frame.removeAll(keepingCapacity: true)
                        await runtime.handle(request)
                    } else {
                        guard frame.count < maximumMessageBytes - 1 else { Darwin.exit(2) }
                        frame.append(byte)
                    }
                }
            }
            guard frame.isEmpty else { Darwin.exit(2) }
            await runtime.stop()
        }.value
        #endif
    }
}
