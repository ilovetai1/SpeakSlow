## 1. Apple Output Setting and History Contract

- [x] 1.1 Add validated `apple_polishing_output_mode` persistence and Apple-only settings UI with `fast` as the missing-value default.
- [x] 1.2 Add a conditional same-row candidate update in the database, IPC, and preload boundary, including conflict and missing-row outcomes.
- [x] 1.3 Add setting and database contract tests for valid modes, rejected values, same-row updates, and late-write conflicts.

## 2. Two-Phase Recording Finalization

- [x] 2.1 Extend transcript finalization with Apple baseline-first orchestration, one initial insert, conditional candidate update, and cancellation checks at every async boundary.
- [x] 2.2 Route only eligible `apple_on_device` automatic recordings through fast mode while preserving wait mode, operation commands, and every non-Apple provider path.
- [x] 2.3 Add explicit `baseline_output` and `candidate_only` renderer handling so paste and Enter run at most once and the later candidate updates only panel and issue state.
- [x] 2.4 Add unit and renderer lifecycle tests for output-before-generation, paste/Enter once, failure, disable, cancellation, owner teardown, save/update failure, wait mode, and non-Apple behavior.

## 3. Apple Generation Critical Path and Telemetry

- [x] 3.1 Remove the per-generation host probe while retaining explicit status probes and native request-time capability and budget checks.
- [x] 3.2 Measure native capability, token-count, and complete-response durations and return only finite non-negative supplementary timing metadata.
- [x] 3.3 Record Apple native timings against the internal latency session, omit invalid timing without failing valid text, and keep internal metadata out of renderer results.
- [x] 3.4 Extend latency-stage labels and tests without adding Apple-only missing stages to non-Apple sessions.
- [x] 3.5 Add protocol, native integration, and sentinel privacy tests proving generation sends no preceding probe and metrics/logs contain no model content.

## 4. Verification and Handoff

- [x] 4.1 Run focused unit and renderer tests for settings, finalization, history, Apple protocol, metrics, cancellation, and privacy.
- [x] 4.2 Run the full test suite, strict OpenSpec validation, renderer production build, and native helper build.
- [x] 4.3 Review the final diff for unrelated files, read back all changed contracts, and record verified results and remaining end-to-end limitations.

### Verification record

- Focused tests: 66 passed, 0 failed.
- Full Node suite: 270 tests; 259 passed, 0 failed, 11 skipped by explicit environment gates.
- Electron-ABI SQLite contract: 2 passed, 0 failed.
- Real macOS 27 Foundation Models helper integration: 1 passed, 0 failed; observed `core_advanced3`, 8,192-token context, and `zh-TW`.
- `npm run build:renderer`, native helper builds, strict OpenSpec validation, and `git diff --check HEAD` passed.
- Final review found only the unrelated pre-existing untracked `docs/research/GPT_VOICE_COMPARISON_2026-10-22.md`; it was not modified or included.
- Installed `/Applications/SpeakSlow.app` 2.1.1 passed version, signature, packaged-helper, launch, single-copy, and Electron-ABI SQLite checks.
- Remaining acceptance limitation: this change was not exercised through a physical microphone and an external target application's real cursor in this work session.
