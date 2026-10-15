## ADDED Requirements

### Requirement: Apple recognition uses a deployment-compatible native helper
The Apple adapter SHALL use a versioned owned Swift helper with `SpeechAnalyzer` and explicitly selected `SpeechTranscriber` or `DictationTranscriber`, an explicit macOS 26 deployment baseline, and module-specific runtime availability checks. Protocol v2 SHALL support the distinct `dictation` profile and reject an old v1 helper. The main application SHALL retain its existing cross-platform minimum requirements. macOS 27-only converters, input providers, and resource-limit overrides MUST NOT be required by the macOS 26 path.

#### Scenario: Helper runs on macOS 26
- **WHEN** Apple starts on a supported macOS 26 device
- **THEN** audio conversion and analysis use APIs available on 26 and do not reference unguarded 27-only functionality

#### Scenario: Helper protocol is incompatible
- **WHEN** the helper reports an unsupported protocol version or fails to launch
- **THEN** preparation fails with an observable helper error without falling back to another engine

### Requirement: Apple assets are managed through system inventory
The runtime SHALL query actual module asset status, distinguish supported, downloading, installed, and reserved states, and use `AssetInventory` installation requests and reported progress. It SHALL recheck status after completion or failure and SHALL NOT infer readiness from a progress percentage or a Sherpa model path. Downloads SHALL begin through an explicit user action when assets are missing.

#### Scenario: Download completes
- **WHEN** the system installation request completes
- **THEN** the adapter rechecks module assets and performs preparation before reporting ready

#### Scenario: User cancels activation during download
- **WHEN** the user stops waiting or switches away during an asset operation
- **THEN** the app invalidates that activation and ignores its late completion
- **AND** the UI does not claim a shared system download stopped or system model files were deleted without supporting evidence

#### Scenario: Network or reservation failure occurs
- **WHEN** installation fails or the runtime reservation limit is reached
- **THEN** the UI reports the corresponding reason and allows an explicit retry without replacing the engine or locale

### Requirement: PCM input is continuous, validated, and bounded
The helper SHALL receive PCM from the existing Electron capture rather than open a second microphone. Its protocol SHALL validate request, session, generation, sequence, actual sample rate, channel count, frame count, and payload limits. All queues SHALL have bounded buffering with backpressure; they MUST NOT silently drop or truncate audio. The initial bridge contract SHALL use 100ms chunks, a 256KiB message limit, and at most two seconds of pending unsent audio, independent of total recording length.

#### Scenario: Actual capture rate differs from the requested rate
- **WHEN** Electron supplies 44.1kHz or 48kHz audio despite a requested 16kHz format
- **THEN** the helper uses the actual format and a compatible conversion path with a continuous sample-based timeline

#### Scenario: Pending audio exceeds the buffer budget
- **WHEN** acknowledgements cannot keep up and the pending unsent budget is exceeded
- **THEN** the job stops with `audio_backpressure` and does not report a truncated transcript as successful

#### Scenario: Audio arrives for an old session
- **WHEN** a chunk has a stale generation, wrong session, or invalid sequence
- **THEN** it cannot enter the current analyzer and the protocol violation is observable

### Requirement: Audio conversion preserves the beginning and tail
The runtime SHALL obtain a compatible format from the configured Speech module and use `AVAudioConverter` on the macOS 26 path. Buffer ownership, sample timing, format changes, input completion, and converter tail flushing SHALL be explicit. A file's transport chunks MUST NOT reset the analyzer or its context at arbitrary duration boundaries.

#### Scenario: User stops with a short final syllable
- **WHEN** capture stops with buffered frames remaining
- **THEN** the adapter delivers and acknowledges the tail, flushes conversion, and closes input before awaiting finalization

#### Scenario: Long file crosses a transport boundary
- **WHEN** file decoding produces a new transport chunk beyond sixty seconds
- **THEN** the same analysis job preserves its continuous time axis and context instead of treating the boundary as a new sentence or session

### Requirement: Results are reduced by audio range and finalization watermark
The adapter SHALL preserve result ranges, text, and finalization time, replace overlapping volatile content, and advance stability using the module finalization watermark or analyzer volatile boundary. It MUST preserve earlier text that becomes stable without being reissued with `isFinal=true`. Preview updates MUST NOT append every tentative string or discard stable text solely because its original event was volatile.

#### Scenario: Earlier volatile text becomes stable without a final event
- **WHEN** range `[0,1)` arrives as volatile and a later result advances finalization time to 1 without reissuing that first range
- **THEN** the reducer retains the first range exactly once as stable text

#### Scenario: A phrase is revised repeatedly
- **WHEN** several results overlap the same mutable audio range with different wording or punctuation
- **THEN** the latest matching range replaces mutable content without duplicating the earlier variants

#### Scenario: File output requests timing metadata
- **WHEN** a job requests subtitles
- **THEN** the module requests supported audio-time attributes without implicitly enabling fast results
- **AND** the reducer preserves a single full-file timeline

### Requirement: Normal finish and cancellation have distinct outcomes
Normal stop SHALL finish capture and queued input, flush conversion, close the input sequence, await analyzer finalization, drain results, and emit one final snapshot. Cancellation SHALL invalidate the session, stop input, cancel analysis and readers, and release resources without automatic history or output from partial text. Duplicate stop or late callbacks MUST NOT duplicate finalization.

#### Scenario: Normal stop is requested twice
- **WHEN** two stop events target one active session
- **THEN** the adapter returns one final outcome and the shared output pipeline runs at most once

#### Scenario: Cancellation races with final results
- **WHEN** final text arrives after the session has been cancelled
- **THEN** it cannot be saved or pasted by that cancelled job

#### Scenario: No speech is recognized
- **WHEN** the final snapshot is empty after a valid recording
- **THEN** the application presents no-speech feedback without running polishing, creating normal transcript history, or pasting text

### Requirement: Errors and cleanup are observable without disclosing transcript data
The runtime SHALL propagate asset, audio-format, ordering, resource, module-output, and helper-exit failures as bounded structured errors. It SHALL terminate the failed job and its input without treating partial text as normal success. Logs SHALL use the project log manager with safe status and timing fields and MUST NOT contain transcript, PCM, arbitrary paths, or unfiltered helper output. On session end it SHALL release analyzer, modules, converters, buffers, and readers; switching SHALL additionally end the owned helper.

#### Scenario: Analyzer results throw
- **WHEN** a results stream reports a module or resource error
- **THEN** capture and analysis stop, the UI shows the failure, and a retry creates a fresh session
- **AND** no partial transcript is automatically finalized as a successful job

#### Scenario: Apple becomes idle after a session
- **WHEN** finalization or cancellation completes
- **THEN** per-session references are released using the planned while-in-use retention policy
- **AND** any system cache still visible in resource measurements is reported separately rather than claimed to have vanished

### Requirement: Shipping acceptance includes packaged microphone and identity behavior
The application SHALL package and sign the helper as part of its native build and SHALL verify the actual installed host and helper identities, microphone permission behavior, Hardened Runtime configuration, and release signing requirements. It MUST NOT treat CLI success as packaged TCC acceptance or apply legacy `SFSpeechRecognizer` authorization requirements to Analyzer without evidence. Apple recognition SHALL remain on device; optional existing AI services SHALL retain their separately disclosed data behavior.

#### Scenario: Microphone access is denied in the packaged application
- **WHEN** the user denies microphone access
- **THEN** the installed application reports the capture limitation without launching a second capture process or bypassing the denial

#### Scenario: User enables cloud polishing with Apple recognition
- **WHEN** the on-device Apple transcript is subsequently sent through an existing enabled cloud-polishing provider
- **THEN** the UI retains that provider's data disclosure and does not label the entire workflow unconditionally offline
