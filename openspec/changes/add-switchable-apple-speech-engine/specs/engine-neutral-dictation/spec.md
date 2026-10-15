## ADDED Requirements

### Requirement: Every ASR entry point uses the selected engine coordinator
General recording, operation mode, history re-recognition, file transcription, and subtitle transcription SHALL enter the main-process coordinator with a frozen engine and response profile. No entry point SHALL directly initialize an unselected ASR backend. History re-recognition SHALL explicitly use the current selected engine without claiming the historical item was originally recognized by it.

#### Scenario: User re-recognizes saved audio after switching
- **WHEN** a history item has retained audio and the user requests re-recognition
- **THEN** the job uses the current selected engine and communicates that choice without inventing original-engine metadata

#### Scenario: Historical audio is absent
- **WHEN** a history item has no retained audio
- **THEN** re-recognition remains unavailable and no backend is started to fabricate a replacement

### Requirement: Apple final text preserves native punctuation before explicit app processing
Apple results SHALL bypass Sherpa punctuation inference, phrase-ending hard rules, pause-based session resets, pause-based automatic line breaks, and Sherpa-specific audio normalization. Only stable final text SHALL enter the existing enabled Traditional Chinese conversion, global or App dictionary, and optional polishing flow. The system MUST NOT interpret result chunks as automatic paragraph boundaries.

#### Scenario: Apple returns punctuation after a thinking pause
- **WHEN** Apple revises punctuation across a pause in one continuous session
- **THEN** the reducer keeps the final native punctuation without applying Sherpa question or exclamation heuristics

#### Scenario: User has enabled post-recognition dictionary rules
- **WHEN** the Apple final snapshot matches an approved global or App-scoped rule
- **THEN** the existing dictionary rules apply before optional polishing and remain distinguishable from native model hints

### Requirement: Both engines share the existing finalization and output contract
Both engines SHALL use the existing `transcript-polishing-workflow` contract for the independent polishing switch, operation-mode bypass, technical polishing failure, persistence failure, current-cursor paste, independent Enter, single-flight lifecycle, and history baseline/latest-final text. Volatile preview SHALL stay inside SpeakSlow and MUST NOT trigger paste, Enter, history writes, dictionary learning approval, or polishing. ASR failure MUST NOT be confused with the existing authorized polishing-failure fallback.

#### Scenario: Polishing is disabled for Apple
- **WHEN** Apple finishes and polishing is disabled
- **THEN** the system uses the processed pre-polish transcript without starting Ollama and follows the independent paste and Enter settings

#### Scenario: Apple runs in operation mode
- **WHEN** the active job is an operation or voice command
- **THEN** the system uses the non-AI transcript through the existing command contract without automatic polishing

#### Scenario: A preview changes several times
- **WHEN** the current Apple session emits revised volatile text
- **THEN** only the SpeakSlow preview changes and configured output waits for one stable final snapshot

#### Scenario: History persistence fails after successful recognition
- **WHEN** the final text cannot be saved to SQLite
- **THEN** the system retains the existing save-failure notice and continues configured output instead of suppressing the result

### Requirement: Audio retention and non-ASR tools do not belong to a recognizer
Audio save, recovery, retention, and temporary-file handling SHALL be shared independently of the selected recognizer and retain existing settings, including `save_audio` and `no_persist`. Text conversion, emoji, dictionaries, and required Python utility work SHALL run without initializing an ASR model. Existing utility data and command behavior SHALL be preserved.

#### Scenario: Apple recording saves audio
- **WHEN** the existing audio-save setting is enabled for a completed recording
- **THEN** the shared audio store saves once using the existing retention behavior without invoking Sherpa

#### Scenario: File or history job forbids new persistence
- **WHEN** a job uses `no_persist` or reuses historical audio
- **THEN** the shared store does not create a duplicate recording entry or audio copy

#### Scenario: User uses a text or TTS utility with Apple selected
- **WHEN** conversion, emoji settings, or an existing TTS command is invoked
- **THEN** the utility preserves its prior behavior without constructing a Sherpa recognizer or extending its existing external-service data scope

### Requirement: File and subtitle failures cannot appear as complete output
A file SHALL be one coordinated analysis job with explicit completion or failure. Subtitle export SHALL use reliable native audio ranges on a continuous timeline and MUST NOT invent timestamps proportional to character counts. A failed chunk or unavailable timing MUST NOT silently skip content, substitute TXT for SRT, or report a complete export.

#### Scenario: A file fails after some text has been previewed
- **WHEN** decoding or recognition fails partway through the file
- **THEN** the UI marks the job incomplete and does not report a complete transcript or subtitle export

#### Scenario: Subtitle timing is unavailable
- **WHEN** reliable native audio timing cannot be obtained
- **THEN** SRT export fails with a specific reason instead of creating fabricated timing or silently changing the output format

### Requirement: Latency metrics distinguish ASR without changing LLM provider semantics
Enabled latency diagnostics SHALL use bounded allowlisted `asrEngine` and `asrProfile` enums separately from the existing LLM `provider`. The v2 store SHALL preserve the existing enable-setting default, seven-day and 1000-record bounds, disabled behavior, safe export, and absence of transcripts, audio, prompts, arbitrary paths, and model names. Old records SHALL be imported read-only with unknown ASR values and deduplicated by opaque identifier; subsequent writes SHALL target v2. Clearing metrics SHALL clear both versions and active collectors so old data cannot reappear through import.

#### Scenario: Existing metrics predate engine identification
- **WHEN** valid v1 records are first imported
- **THEN** they appear once with unknown ASR engine and profile while their LLM provider keeps its original meaning

#### Scenario: User clears metrics during processing
- **WHEN** the user clears diagnostics while a collector is active
- **THEN** both stores and in-flight collectors are cleared and completion cannot restore the cleared records

#### Scenario: Metrics are disabled
- **WHEN** latency diagnostics are disabled
- **THEN** neither engine persists new latency records or transcript-derived diagnostics

### Requirement: Timing measurements preserve clock and completion boundaries
The system SHALL distinguish first preview, stop-to-ASR-final, and stop-to-paste-command latency. Durations SHALL be computed within one monotonic clock domain; raw timestamps from renderer, main, and Swift MUST NOT be subtracted as if interchangeable. A paste-command acknowledgement SHALL NOT be described as proof that the target application received text.

#### Scenario: Native helper reports an analysis duration
- **WHEN** helper timing is combined with main-process workflow metrics
- **THEN** the record retains separate bounded durations rather than subtracting incompatible clock epochs

### Requirement: Release claims are supported by paired end-to-end evidence
Release acceptance SHALL include paired Taiwan Traditional Chinese material covering at least 30 valid comparisons, 20–60-second speech, pauses, punctuation, questions, numbers, names, and mixed English. It SHALL report text accuracy, punctuation and sentence-boundary evaluation, first preview, stop-to-final, stop-to-paste-command, physical footprint, CPU, and observable ANE/GPU activity separately. Cold, warm, idle, repeated switching, and hidden-utility behavior SHALL be exercised. Short-clip CER without punctuation and isolated helper memory MUST NOT be presented as full-product or iPhone-equivalence acceptance.

#### Scenario: Resource comparison is published
- **WHEN** Apple and Sherpa resource results are reported
- **THEN** the report identifies app and helper physical footprint, accessible system-service scope, shared/protected-process uncertainty, and evidence that the unselected ASR runtime is absent
- **AND** it does not infer battery use or guaranteed ANE allocation from CPU time or one trace

#### Scenario: Product is described as approaching iPhone experience
- **WHEN** an iPhone-equivalence or near-equivalence claim is considered
- **THEN** it requires an explicitly defined fair physical-iPhone comparison in addition to the Mac paired benchmark

#### Scenario: The proposed performance gate is evaluated
- **WHEN** at least 30 valid paired stop-to-paste-command observations are available
- **THEN** Apple accountable CPU and physical footprint must be below matched Sherpa measurements and Apple P95 regression must not exceed `max(50ms, Sherpa P95 × 10%)`
- **AND** these proposed release thresholds do not replace existing latency-instrumentation overhead requirements

### Requirement: Same-recording Apple comparison preserves raw results and timing boundaries
Saved history audio SHALL provide an explicit Speech versus Dictation comparison while Apple is ready. One lease SHALL block other ASR work through both runs and restoration. The system SHALL read the recording once, feed identical PCM sequentially at audio speed, allow either execution order, and show raw text with separately measured preparation, first-text and audio-end-to-final durations. Comparison SHALL NOT apply dictionaries, conversion, polishing, history changes, new audio persistence or paste. Optional reference-based CER SHALL preserve character and homophone differences while excluding punctuation and whitespace; no accuracy percentage SHALL appear without a reference. Cancellation SHALL invalidate output and restore the saved mode before releasing the lease, or expose restoration failure.

#### Scenario: User compares a saved recording
- **WHEN** both selected modules complete on the same recording
- **THEN** the UI displays two raw transcripts and their separate durations without changing the historical transcript or saved engine settings
- **AND** it explains that real-time replay is not physical-microphone-to-paste acceptance and that single runs can be affected by order and warm-up

#### Scenario: User cancels or a module lacks assets
- **WHEN** comparison is cancelled or one module cannot run
- **THEN** cancellation cannot later save or paste text, missing assets are visible for the affected module, and no replacement recognizer runs silently
