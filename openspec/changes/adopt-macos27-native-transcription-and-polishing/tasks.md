## 1. Baseline and contract fixtures

- [x] 1.1 Record the current dirty-file baseline, run the focused speech／AI／window regression set, and keep unrelated user changes intact.
- [x] 1.2 Add deterministic fixtures for Mac platform detection, fresh／legacy／invalid setting states, Apple provider availability, protocol errors, cancellation, timeout, over-limit input, and no-network dispatch.
- [x] 1.3 Validate this OpenSpec change strictly and keep old active-change evidence separate from the new acceptance status.

## 2. macOS 27 Apple-only speech routing

- [x] 2.1 Raise the Apple speech helper and macOS package deployment target to 27 while preserving the existing arm64 target and dirty `window-visibility` build/resource changes.
- [x] 2.2 Implement an idempotent Mac settings migration that persists `asr_engine=apple`, preserves valid Apple profile and all existing user data/provider settings, and blocks runtime preparation on invalid or failed writes.
- [x] 2.3 Enforce Apple-only ASR in the main speech coordinator and both dedicated and generic setting IPC on Mac; retain Sherpa behavior on Windows and Linux.
- [x] 2.4 Update Mac speech settings and runtime status UI to remove Sherpa／Zipformer selection while preserving `accurate`、`responsive`、`dictation`, asset installation, failure, and retry states.
- [x] 2.5 Verify ordinary recording, compact／hotkey recording, Apple live preview, command input, file TXT／SRT, and history retranscription all freeze and use Apple without starting Sherpa.

## 3. Apple Foundation Models native runtime

- [x] 3.1 Add a macOS 27 Swift Foundation Models helper with a versioned bounded JSONL protocol for handshake, availability, token preflight, generation, cancellation, and structured terminal errors.
- [x] 3.2 Implement per-request `LanguageModelSession` isolation, `SystemLanguageModel.default`, zh-TW capability checks, runtime variant／context metadata, native token counting, bounded output, normal guardrails, and complete-response validation.
- [x] 3.3 Add a main-process helper manager with owned process lifecycle, request correlation, one-active-request control, 60-second whole-request deadline, cancellation grace, crash recovery, size limits, and content-free logs.
- [x] 3.4 Add an `apple_on_device` adapter that maps helper results to the existing provider contract without HTTP, Ollama, PCC, `fm`, or secret access.
- [x] 3.5 Add helper build, ad-hoc signing, packaged resource resolution, and shutdown wiring without overwriting existing native helper build steps.

## 4. Provider registry, settings, and observability

- [x] 4.1 Replace the Ollama-versus-HTTP conditional with an explicit provider registry used by processing and status checks; reject unknown providers and exclude Apple from `DEEPSEEK_API_KEY` fallback.
- [x] 4.2 Add Apple readiness/status IPC and preload exposure, fixed error mapping, and provider-specific capability metadata without exposing transcript content or stored secrets.
- [x] 4.3 Add Apple to AI settings as a no-key, no-URL, system-managed-model provider; preselect it only for a true new Mac installation and keep polishing disabled by default.
- [x] 4.4 Preserve existing provider and prompt settings during upgrade, require current Apple readiness before newly enabling polishing, and never synthesize a placeholder key.
- [x] 4.5 Add `apple_on_device` to bounded latency/provider classifications and UI labels without classifying it as remote or granting Ollama-only cursor-context access.

## 5. Shared transcript finalization

- [x] 5.1 Route the stable Apple live-preview final transcript through the existing conversion, scoped dictionary, optional polishing, single history save, paste, and Enter workflow; partials remain preview-only.
- [x] 5.2 Add TXT file polishing preview／confirm／reset using the raw full-file transcript and current provider, while keeping `no_persist`, source files, clipboard, and SRT untouched until explicit user action.
- [x] 5.3 Preserve SRT native timing and command-mode polishing bypass, and keep history retranscription distinct from history re-polishing preview／confirmation.
- [x] 5.4 Extend cancellation, disable-during-request, owner destruction, stale response, duplicate stop, persistence failure, and original-text fallback tests across normal, streaming, file, history, and custom AI workflows.

## 6. Quality and privacy evaluation

- [x] 6.1 Create versioned tuning and holdout manifests that include the known 30000／3500 reversal, numbers, dates, negation, self-correction, names, mixed language, homophone counterexamples, long input, silence, and noisy audio.
- [x] 6.2 Add a reproducible harness that records source/app/helper hashes, OS build, hardware, model variant／context, prompt/options, raw ASR, final output, all failures, latency stages, and fixed Ollama digest without writing product logs.
- [ ] 6.3 Run the current macOS 27 Apple ASR／polishing versus no-polish and fixed Ollama paired evaluation; report critical semantic errors separately and keep automatic enablement blocked on any such error.
- [ ] 6.4 Run or import source-complete macOS 26.0–26.3 and 26.4 paired results on comparable hardware; if unavailable, preserve the cross-version conclusion as `unverified` rather than inferring it.
- [x] 6.5 Verify ready-assets offline behavior and controlled outbound hooks show no transcript-bearing Apple request leaves the native helper; scan logs and metrics with sentinel content.

## 7. Regression, package, and handoff gates

- [x] 7.1 Run focused Node／React tests, full serial tests, Swift helper integration, renderer build, backend build, OpenSpec strict validation, and diff checks; report skips and unrelated pre-existing lint failures separately.
- [x] 7.2 Build the arm64 macOS package and verify deployment metadata, packaged helper paths／protocols／architecture, ad-hoc signature integrity, and preservation of window-visibility and recording-owner fixes.
- [ ] 7.3 With explicit installation authorization, verify the installed app on macOS 27 using isolated and real settings, physical microphone, target-field read-back, unavailable states, cancellation, restart, and only one `/Applications/SpeakSlow.app`.
- [x] 7.4 Keep Developer ID／notarization, macOS 26／26.4 comparison, automatic-polishing enablement, tag, and release marked incomplete until their separate evidence exists; perform installation and branch push only after separate explicit authorization.
