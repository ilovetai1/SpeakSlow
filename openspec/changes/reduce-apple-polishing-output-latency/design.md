## Context

The current automatic recording pipeline is serial: final ASR, deterministic conversion and dictionary replacement, Apple polishing, history insert, then configured paste and Enter. An exploratory sample of seven installed-app Apple requests measured polishing at about 1.92 seconds P50 and stop-to-paste at about 2.74 seconds P50; comparable output without polishing was about 0.82 seconds P50. The sample is too small for a stable P95 claim, but it identifies model completion as the dominant delay.

This change depends on the active `adopt-macos27-native-transcription-and-polishing` change. It replaces only that change's Apple automatic-recording output timing. History re-polishing, TXT preview, SRT, operation mode, Ollama, and remote-provider behavior remain unchanged. The adoption change must be archived before this change so that its Apple requirements exist in the base specifications first.

## Goals / Non-Goals

**Goals:**

- Remove Apple generation from the cursor-output critical path without losing the deterministic transcript.
- Guarantee one paste and at most one Enter for an Apple fast-output recording.
- Keep the Apple candidate owned, cancellable, and single-flight until its terminal state.
- Update the same history row safely when the later candidate succeeds.
- Remove the redundant host probe while retaining the native request-time readiness and budget gate.
- Measure native capability, token-count, and complete-response durations without content.

**Non-Goals:**

- Do not detach model work from the recording owner or allow a second recording while its candidate is pending.
- Do not stream or paste partial model output.
- Do not add prewarming, lower the output-token limit, shorten the polishing instruction, or claim a model-quality improvement.
- Do not change the database schema or retain candidate-version history.
- Do not change output timing for Ollama, remote providers, history re-polishing, file transcription, SRT, or operation commands.

## Decisions

### Apple has an explicit output-timing setting

Persist `apple_polishing_output_mode` with the allowed values `fast` and `wait_for_polished`. A missing value resolves to `fast`; this is the intentional user-visible migration. The setting is evaluated only when polishing is enabled, `apple_on_device` is selected, and the automatic recording is not an operation command. Settings exposes both choices and validates the enum in the main process.

Alternative considered: preserve wait mode for existing Apple users. This avoids a behavior change, but it leaves the measured delay in place unless every user discovers the new setting. Apple polishing remains opt-in and the UI exposes the prior behavior, so fast is the chosen default.

### Fast mode is a two-phase, single-owner finalization

After final ASR and deterministic transformations, finalization inserts the baseline history row. Whether that insert succeeds or fails, it then emits one `baseline_output` event so the renderer applies the existing paste and Enter policy. Apple generation starts only after that output event completes. This ordering makes stop-to-paste independent of model completion and keeps the existing save-before-output attempt.

The recording pipeline and speech-job lease remain active until generation, conditional history update, and the candidate UI event reach a terminal state. The later event is marked `candidate_only`; the renderer updates the processed-text panel and issue state but never calls the clipboard or Enter path.

Alternative considered: detached background work after releasing the recording lease. It would permit an earlier next recording, but it introduces overlapping owners, late history writes, and shutdown/cancellation races. That is outside this change.

### Candidate history updates are conditional and in place

The initial insert result supplies the row identifier. On successful polishing, the main process updates `text` only when that row still has the expected `raw_text` and baseline `text`. This prevents a late candidate from replacing a row that was edited, re-transcribed, or otherwise changed. The update preserves `raw_text`, clears obsolete `processed_text`, creates no second row, and returns a distinct conflict result when the condition does not match.

If the initial insert failed, the candidate remains visible in the current panel but no replacement insert is attempted. If the conditional update fails or conflicts, the baseline or newer row stays intact and the main panel reports a history-save issue. Cancellation, disable, owner teardown, or shutdown invalidates the late result before any update or candidate event. An already completed external paste is not reversible and is not repeated.

### Generation performs one request-time readiness gate

The manager's `generate()` path sends `generate` directly instead of issuing a separate `probe` first. The Swift handler still obtains the system model and verifies availability, locale support, context metadata, token budget, and generation completeness for that request. Public `probe()` remains available for the settings status action.

This removes only the duplicate host round trip, measured exploratorily at roughly 20–37 milliseconds. It does not cache readiness or weaken request-time validation.

### Native telemetry is supplementary and content-free

The Swift success result includes monotonic durations for capability/readiness work, token counting, and the complete `respond` call, plus existing input and output token counts. The host accepts only finite non-negative timing values for metrics. Missing or malformed supplementary timing is omitted and made observable as unavailable metrics; it does not convert otherwise valid generated text into a polishing failure.

The adapter records the native durations against the current internal latency-session identifier, then removes internal timing metadata before returning the public processing result. Metrics and logs contain no transcript, prompt, response, path, secret, raw framework error, or stderr. Because the implementation remains non-streaming, it does not invent a first-token duration.

Alternative considered: use `streamResponse` solely to obtain first-token timing. Local exploratory runs showed the first partial about 0.31 seconds before completion while full completion remained about 1.01 seconds, and SpeakSlow already displays the baseline. The extra lifecycle complexity does not improve safe cursor output.

### Prewarm and generation-limit experiments are not adopted

Exploratory interleaved runs did not show completion-time improvement from `prewarm`, and output-token caps from 128 through 1024 produced no material latency difference for the fixed short fixture. These samples do not prove the techniques can never help, but they do not justify additional lifecycle or truncation risk in this change.

## Risks / Trade-offs

- [The pasted baseline can differ from the later panel/history candidate] → Label both output modes clearly and never auto-replace external text.
- [The next recording remains blocked while the candidate finishes] → Keep the existing single-flight safety boundary; evaluate detached ownership separately with dedicated lifecycle tests.
- [A row changes before the candidate arrives] → Use a row ID plus expected-baseline conditional update and report the conflict without overwriting.
- [Initial history persistence fails] → Preserve the existing output contract, show the candidate in the panel, and do not create a second history row.
- [Telemetry contains model content] → Whitelist numeric fields and run sentinel privacy tests over logs and exported metrics.
- [Fast becomes the default for existing Apple users] → Keep `wait_for_polished` available in Apple settings and scope the default only to Apple automatic recording.

## Migration Plan

1. Add setting validation and UI with `fast` as the missing-value default.
2. Add the conditional history-update IPC without a schema migration.
3. Add two-phase finalization and candidate-only renderer handling behind the Apple setting.
4. Remove the duplicate generation probe and add supplementary native metrics.
5. Run unit, renderer lifecycle, protocol/privacy, and production build checks.

Rollback sets `apple_polishing_output_mode` to `wait_for_polished` or reverts the two-phase branch. Existing history remains compatible because no schema changes or extra candidate rows are introduced.

## Open Questions

None for this change. Releasing the single-flight lease before candidate completion requires a separate ownership design and acceptance scope.
