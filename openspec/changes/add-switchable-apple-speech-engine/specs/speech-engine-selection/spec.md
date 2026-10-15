## ADDED Requirements

### Requirement: Users explicitly choose one persisted speech engine
The system SHALL expose `現有本機引擎` (`sherpa`) and `Apple 原生引擎` (`apple`) as mutually exclusive speech-engine choices. Missing `asr_engine` SHALL resolve to Sherpa for existing and new installations. A malformed stored value MUST produce an observable configuration error rather than choose an arbitrary engine.

#### Scenario: Installation has no engine preference
- **WHEN** the application starts without a stored `asr_engine`
- **THEN** Sherpa is the selected engine and its existing settings remain effective

#### Scenario: User restarts with a saved Apple choice
- **WHEN** `asr_engine` is `apple` on startup
- **THEN** the application restores Apple as the selected engine and evaluates its capability without starting Sherpa

#### Scenario: Persisted preference is malformed
- **WHEN** the stored engine value is not a supported identifier
- **THEN** the application shows a configuration error and requires an explicit valid choice before starting an ASR runtime

### Requirement: Selected preference and runtime readiness are distinct
The system SHALL present the persisted selection separately from runtime state, including checking, download needed, downloading, preparing, ready, busy, stopping, unavailable, and failed. Capability probe failures MUST remain distinguishable from confirmed lack of support. Only a successful capability, asset, and preparation sequence SHALL allow an Apple recording to start.

#### Scenario: Apple assets are absent
- **WHEN** Apple is selected and the required assets are not installed
- **THEN** settings show Apple selected with a download-needed state and an explicit download action
- **AND** recording is unavailable until preparation succeeds

#### Scenario: Capability query fails temporarily
- **WHEN** the capability query throws or the helper cannot be contacted
- **THEN** the application displays the corresponding failed state and retry action without claiming the device is unsupported

### Requirement: Apple availability preserves Taiwan Traditional Chinese locale semantics
The first Apple release SHALL require macOS 26 or later, a supported Apple Silicon application build, a compatible helper, `SpeechTranscriber.isAvailable`, and explicit Taiwan Traditional Chinese support and assets. Locale comparison SHALL normalize equivalent identifier representations without accepting a different Chinese region. Other platforms and older macOS SHALL retain Sherpa without attempting to load the Apple helper.

#### Scenario: Only another Chinese region is available
- **WHEN** the API supports another Chinese locale but not the semantic equivalent of `zh-TW`
- **THEN** Apple is unavailable for this release and the UI reports the locale limitation
- **AND** it does not silently use `zh-CN`, `zh-HK`, or a result selected only by language equivalence

#### Scenario: An older Mac restores an Apple preference
- **WHEN** a saved Apple preference is opened on an unsupported OS or application architecture
- **THEN** the selected preference remains Apple with an explicit unsupported reason and a user action to select Sherpa
- **AND** the Apple helper is not launched

### Requirement: Engine changes are serialized and validated by the main process
The main-process coordinator SHALL own selection persistence and lifecycle transitions. All setting-write entry points, including generic setting IPC, MUST use the same validation and busy gate. A failed settings write SHALL preserve the prior persisted selection and runtime. Successful writes SHALL be broadcast to every application window without stale draft overwrites.

#### Scenario: Engine preference cannot be saved
- **WHEN** a valid idle selection change fails to persist
- **THEN** the old selection and runtime remain in effect and all windows show the save failure

#### Scenario: Another window attempts a conflicting change
- **WHEN** a settings window or generic setting IPC attempts a change during a protected transition
- **THEN** the coordinator rejects the conflict visibly without overlapping runtime transitions

#### Scenario: Settings changes in one window
- **WHEN** an idle engine choice is persisted successfully
- **THEN** the main and settings windows receive the same current selection and lifecycle state
- **AND** saving unrelated drafts does not restore an older engine value

### Requirement: Switching is blocked for the whole active transcription job
The system MUST reject and MUST NOT queue engine or active Apple response-profile changes while recording, recognizing, finalizing, polishing, saving, or outputting a job, or while a file or history transcription job is active. Each accepted job SHALL freeze its engine and response profile until completion or cancellation.

#### Scenario: User changes the engine while polishing
- **WHEN** ASR has finished but the job is still polishing or pasting
- **THEN** the selection change is rejected with the busy state and the original job finishes using its frozen configuration

#### Scenario: Another window starts a file job
- **WHEN** a file transcription holds the shared busy gate
- **THEN** a recording start and engine change from another window are rejected rather than queued

### Requirement: The unselected ASR runtime is disposed and cannot be revived by utilities
After an idle change is persisted, the coordinator SHALL invalidate old session generations, dispose the old ASR runtime, await owned child termination, and then prepare the selected runtime. At steady state at most the selected ASR runtime may remain loaded. Status polling, settings, emoji, dictionaries, text conversion, TTS, file transcription, and history actions MUST NOT initialize an unselected recognizer. Shared system Speech or ANE services MUST NOT be killed.

#### Scenario: User changes from Sherpa to Apple
- **WHEN** the idle switch completes successfully
- **THEN** the owned Sherpa ASR process has exited before Apple becomes ready
- **AND** opening emoji settings and invoking text utilities do not recreate a Sherpa recognizer

#### Scenario: An old callback arrives after switching
- **WHEN** a result or preparation callback carries an invalidated generation
- **THEN** it cannot update the current runtime state, save a transcript, or trigger output

### Requirement: Engine failure never changes the user's choice silently
The system MUST retain the selected preference after preparation or recognition failure and SHALL display a specific reason and retry or explicit alternative-selection action. It MUST NOT automatically select another engine, another Apple module, or another locale to make the job appear successful.

#### Scenario: Apple preparation fails after a persisted switch
- **WHEN** Apple fails after Sherpa has been disposed
- **THEN** Apple remains selected with a failed state and recording stays blocked until a successful retry or explicit switch
- **AND** Sherpa does not restart automatically

### Requirement: Apple Dictation is an explicit selectable mode
Apple settings SHALL preserve the existing SpeechTranscriber `accurate` default and `responsive` option and add a distinct `dictation` profile using DictationTranscriber. All recording, file and history routes SHALL freeze and use the chosen profile. Switching SHALL obey the existing busy, persistence and lifecycle gates. Dictation assets and zh-TW support SHALL be queried for Dictation itself; Speech availability MUST NOT be used as its device gate. The system MUST NOT use either Apple module as an implicit fallback for the other.

#### Scenario: User selects system dictation
- **WHEN** an idle user explicitly chooses `dictation`
- **THEN** the selection persists and synchronizes across windows, and the runtime prepares DictationTranscriber
- **AND** new jobs and latency groups identify `dictation` separately from both Speech profiles

#### Scenario: Dictation assets are missing
- **WHEN** Dictation is selected but its zh-TW assets are not installed
- **THEN** the UI displays its download requirement without running SpeechTranscriber in its place

### Requirement: Engine-specific preferences have explicit applicability
Apple SHALL provide `完整上下文` (`accurate`, default) using volatile results without fast results and `即時回饋` (`responsive`) explicitly adding fast results with a quality tradeoff explanation. Sherpa performance, streaming, pause-based line breaks, heuristic list formatting, and native hotword controls SHALL remain saved and apply only to Sherpa. Post-recognition dictionary controls SHALL remain available with Apple.

#### Scenario: User first selects Apple
- **WHEN** Apple has no saved response-profile preference
- **THEN** accurate is selected and the implementation does not enable fast results through a progressive preset

#### Scenario: User returns to Sherpa
- **WHEN** an idle user explicitly selects Sherpa after using Apple
- **THEN** the previously saved Sherpa profile and streaming settings are restored without copying Apple settings into them

#### Scenario: Apple is selected in settings
- **WHEN** the settings page presents hotwords and automatic line breaks
- **THEN** it distinguishes unavailable Sherpa-only controls from the still-available post-recognition dictionary
- **AND** it does not claim a dictionary change trains or hints the Apple model
