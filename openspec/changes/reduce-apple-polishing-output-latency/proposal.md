## Why

Apple on-device polishing currently blocks cursor output until the full model response finishes. Observed Apple polishing latency dominates the stop-to-paste path, so SpeakSlow needs an explicit fast-output contract that preserves recoverable text and prevents a late model result from overwriting text already pasted into another application.

## What Changes

- **BREAKING**: When `apple_on_device` polishing is enabled and no output-mode preference exists, use fast output: save and paste the deterministic pre-polish transcript first, then finish Apple polishing as a non-pasting candidate update.
- Add an Apple-only setting that lets the user choose fast output or the existing wait-for-polished-output behavior. Ollama and remote providers keep their current behavior.
- In fast mode, keep the pre-polish transcript as the recoverable baseline, update the same history item with the latest successful Apple candidate, and never paste or send Enter a second time for that result.
- Preserve explicit cancellation, failure visibility, single-flight ownership, and operation-mode bypass behavior while the background candidate is pending.
- Remove the redundant host capability probe from the Apple generation path while retaining the helper's request-time readiness and budget checks.
- Return and aggregate bounded native timing and token-count metadata without recording transcript, prompt, or generated content.

## Capabilities

### New Capabilities

- `apple-polishing-output-latency`: Defines Apple-only output-mode selection, non-overwriting candidate completion, request-time readiness behavior, and content-free native latency observability.

### Modified Capabilities

- `transcript-polishing-workflow`: Allows Apple fast mode to persist and output the pre-polish transcript before polishing completes, then update the same history item without another clipboard action.

## Impact

- Recording finalization and renderer callbacks in `src/hooks/useRecording.js`, `src/utils/transcriptFinalization.mjs`, and `src/App.jsx`.
- AI settings, persisted setting validation, and renderer/main-process synchronization.
- History persistence and IPC need an update-in-place path for the latest final text.
- Apple native helper protocol, adapter/manager metadata, latency aggregation, and privacy tests.
- Existing Apple workflow tests change; non-Apple provider behavior and public network/API dependencies do not change.
