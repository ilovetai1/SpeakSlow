## ADDED Requirements

### Requirement: The Mac product requires macOS 27 and Apple Silicon
The macOS application and its native speech helper SHALL declare macOS 27 as the minimum deployment target and SHALL support the distributed Apple Silicon architecture. The main process SHALL verify the actual operating system, architecture, helper availability, and compatible versioned protocol before preparing speech recognition. A macOS 26 installation or an unsupported Mac architecture MUST NOT activate a legacy recognition path. This requirement SHALL replace the earlier Mac macOS 26 compatibility and selectable Sherpa product policy without changing the Windows or Linux support baseline.

#### Scenario: Supported Mac starts the application
- **WHEN** the application starts on macOS 27 or later with the supported Apple Silicon build and a compatible helper
- **THEN** it evaluates Apple speech module, locale, and asset readiness before enabling recording
- **AND** passing the platform check alone does not display the runtime as ready

#### Scenario: An older Mac operating system attempts to run the new version
- **WHEN** the new Mac application is installed or launched on macOS 26
- **THEN** its deployment metadata or startup gate rejects the unsupported environment with an observable minimum-version limitation
- **AND** it does not launch Sherpa or an older speech helper to continue the job

#### Scenario: Native helper is missing or incompatible
- **WHEN** a supported Mac lacks the packaged helper or the helper reports an incompatible protocol
- **THEN** preparation reports a distinct helper failure and keeps recognition unavailable
- **AND** it does not claim the operating system or locale is unsupported solely because the helper failed

### Requirement: Every Mac audio recognition entry point uses Apple Speech
The main-process speech coordinator SHALL route all Mac audio-to-text jobs to Apple Speech, including ordinary microphone recording, hotkey and compact-panel recording, live preview, imported audio or video TXT, SRT, saved-audio history retranscription, and voice input for command mode. The Mac UI MUST NOT offer Sherpa, Paraformer, Whisper, or Zipformer as alternative recognition routes, and generic setting or legacy IPC calls MUST NOT bypass this restriction. Status queries, dictionaries, emoji, conversion, TTS, and settings MUST NOT initialize a Sherpa ASR recognizer. Utility-only workers needed for existing non-ASR features SHALL remain permitted without recognizer initialization.

#### Scenario: Each Mac transcription entry point creates a job
- **WHEN** any supported Mac microphone, file, subtitle, history, or command-input entry point creates an audio recognition job
- **THEN** the coordinator identifies its engine as `apple` and invokes the selected Apple module
- **AND** no Sherpa ASR process or recognizer is initialized for that job

#### Scenario: A legacy caller requests Sherpa on Mac
- **WHEN** a legacy IPC caller or generic setting write attempts to select or invoke a Sherpa-only recognition operation on Mac
- **THEN** the main process returns an explicit unsupported-operation or configuration error
- **AND** the operation cannot activate Sherpa or change the persisted Apple choice

#### Scenario: Non-ASR utility is used on Mac
- **WHEN** a user opens dictionary or emoji settings, converts text, or invokes existing TTS
- **THEN** the utility preserves its existing text or speech-output contract without initializing an ASR recognizer

### Requirement: Legacy Mac recognition preferences migrate before runtime activation
On Mac, a missing `asr_engine` or the recognized legacy value `sherpa` SHALL migrate to persisted `apple` before any ASR runtime starts. An existing `apple` value SHALL remain unchanged. The migration SHALL preserve valid `apple_response_profile` values and resolve a missing profile to `accurate`. It SHALL preserve stored Sherpa preferences, downloaded models, saved audio, transcript history, and AI provider and polishing preferences. The migration MUST NOT enable polishing, overwrite an existing AI provider, or delete old setting data. Unknown engine or profile identifiers SHALL produce an observable configuration error rather than be treated as a recognized legacy value. Migration SHALL be idempotent, and failed persistence MUST block recognition instead of reporting a migration that was not saved.

#### Scenario: Existing Mac user selected Sherpa and streaming
- **WHEN** a supported Mac starts with `asr_engine=sherpa`, saved Sherpa streaming preferences, and existing history
- **THEN** `asr_engine=apple` is persisted before recognition preparation and a missing Apple profile resolves to `accurate`
- **AND** the old Sherpa settings, models, history, AI provider, and polishing-enabled value remain preserved
- **AND** subsequent startups do not repeat or reverse the migration

#### Scenario: Existing Mac user selected an Apple profile
- **WHEN** the saved engine is `apple` and the profile is `responsive` or `dictation`
- **THEN** that profile remains the selected profile and is not reset to `accurate`

#### Scenario: Migration cannot be saved
- **WHEN** persisting the Mac engine migration fails
- **THEN** the application displays a configuration-save failure and disables recognition until a successful retry
- **AND** neither Apple nor Sherpa starts as an unpersisted substitute

#### Scenario: Stored engine or profile is malformed
- **WHEN** a stored engine or Apple profile contains an unknown identifier
- **THEN** the application reports the invalid setting and requires explicit correction before activating recognition

### Requirement: Three Apple recognition profiles remain explicit
The Mac application SHALL preserve `accurate`, `responsive`, and `dictation` as distinct persisted profiles. Missing profile preferences SHALL resolve to `accurate`. `accurate` SHALL use `SpeechTranscriber` with volatile results and without fast results; `responsive` SHALL explicitly add fast results; `dictation` SHALL use `DictationTranscriber` with progressive long dictation and audio-time metadata. The UI SHALL identify their different module and quality behavior without promising identical iPhone output or model training from dictionary edits. Every audio entry point SHALL use the frozen selected profile, except the explicitly requested paired Apple comparison.

#### Scenario: New Mac installation has no profile
- **WHEN** the user opens recognition settings before choosing an Apple profile
- **THEN** `accurate` is selected and fast results are not enabled implicitly

#### Scenario: User selects another profile while idle
- **WHEN** an idle user selects `responsive` or `dictation`
- **THEN** the choice is persisted, synchronized across windows, and used by subsequent microphone, file, SRT, history, and command-input jobs
- **AND** the application prepares that specific module rather than a substitute

#### Scenario: Dictation lacks support while Speech is available
- **WHEN** the selected Dictation module lacks the required locale or assets but SpeechTranscriber is available
- **THEN** Dictation remains selected with its specific limitation
- **AND** SpeechTranscriber does not run in its place

### Requirement: Readiness reflects the selected module and exact locale
The coordinator SHALL expose checking, download-needed, downloading, preparing, ready, busy, stopping, unavailable, and failed states with bounded reason codes. It SHALL query the selected module's actual support, exact Taiwan Traditional Chinese locale, system asset inventory, and successful preparation. Equivalent identifier spelling SHALL be normalized without accepting another Chinese region or simplified script. SpeechTranscriber availability SHALL gate Speech profiles; it MUST NOT stand in for Dictation availability. Probe errors SHALL remain distinguishable from confirmed lack of support. Missing assets SHALL require an explicit installation action, and asset status and preparation SHALL be rechecked after installation before reporting ready.

#### Scenario: Only another Chinese locale is supported
- **WHEN** the selected module supports another Chinese region but not the semantic equivalent of `zh-TW`
- **THEN** recognition is unavailable with a locale reason
- **AND** it does not silently select `zh-CN`, `zh-HK`, or a language-equivalent replacement

#### Scenario: Required assets are missing
- **WHEN** the selected module's system inventory reports missing assets
- **THEN** the UI displays the download requirement and explicit installation action while blocking recording
- **AND** completing progress alone does not report ready before inventory recheck and preparation succeed

#### Scenario: Capability request fails
- **WHEN** a capability probe fails or the helper cannot be contacted
- **THEN** the application reports a retryable probe or helper failure rather than confirmed device incompatibility

### Requirement: Apple live preview replaces the Mac Zipformer streaming route
The Mac application SHALL provide live microphone preview through the same Apple session used for final recognition. It MUST NOT start Zipformer, split sessions on the former Sherpa silence threshold, or let a stored `enable_streaming_mode` value choose another recognizer. Legacy Mac streaming intent SHALL map to the Apple live-preview capture path without overwriting a valid Apple profile or enabling `responsive` implicitly. The UI SHALL explain that preview latency and revision behavior depend on the chosen Apple profile. Preview text MUST NOT be pasted, saved as a normal completed transcript, or sent to polishing before successful finalization.

#### Scenario: User previously enabled Sherpa streaming
- **WHEN** a migrated Mac user starts recording with a stored true `enable_streaming_mode`
- **THEN** capture uses one Apple session with the selected Apple profile and revisable preview
- **AND** the stored legacy streaming preference does not activate Zipformer or reset the Apple profile

#### Scenario: A pause exceeds the former streaming threshold
- **WHEN** a speaker pauses during an Apple recording
- **THEN** the application retains the same analyzer session and continuous audio timeline
- **AND** a local silence threshold does not force a new recognition session or paste partial text

#### Scenario: Apple revises preview wording
- **WHEN** Apple emits overlapping tentative text followed by a different final result
- **THEN** the preview replaces mutable content without duplicating earlier versions
- **AND** only the successfully finalized transcript enters the shared optional-polishing and output workflow

### Requirement: File and subtitle transcription preserve a continuous audio timeline
Each imported Mac audio or video file SHALL own one Apple recognition job and one continuous analyzer session regardless of transport chunk boundaries. Audio decoding and conversion SHALL preserve the first and final frames and actual sample timing. TXT results SHALL enter the shared optional-polishing workflow defined by `transcript-polishing-workflow`. SRT SHALL use trustworthy Apple audio-time ranges and SHALL bypass generative full-transcript polishing. The application MUST NOT fabricate timing from character counts, silently convert failed SRT to TXT, or report success after a missing or failed segment.

#### Scenario: A long imported file crosses sixty seconds
- **WHEN** an imported file exceeds the former sixty-second Sherpa chunk boundary
- **THEN** transport continues within the same Apple session and full-file time axis
- **AND** the boundary does not reset recognition context or omit audio

#### Scenario: User requests TXT with optional polishing
- **WHEN** Apple successfully finalizes an imported TXT job
- **THEN** its stable baseline enters the common optional-polishing policy before final TXT output
- **AND** selecting a recognition profile alone does not enable polishing

#### Scenario: User requests SRT while polishing is enabled
- **WHEN** a user transcribes an imported file as SRT with the global polishing switch enabled
- **THEN** the SRT uses Apple ASR segment text and trustworthy audio ranges without generative whole-text rewriting
- **AND** missing or invalid ranges produce an explicit incomplete or timing failure instead of a successful substitute output

### Requirement: History retranscription and model comparison retain distinct contracts
Mac history retranscription SHALL use the current Apple profile and an existing saved audio file. It SHALL explicitly identify that it reruns the current configuration rather than the original historical engine. A successful retranscription SHALL replace the existing baseline and final text using the established history contract without silently invoking history polishing, automatic paste, or duplicate audio persistence. Missing audio SHALL prevent retranscription. Paired Apple comparison SHALL remain a diagnostic operation using the same saved audio bytes, explicit Speech and Dictation profiles, raw recognition output, and restoration of the selected profile; it MUST NOT mutate transcript history, apply dictionaries, run polishing, or paste output. This change MUST NOT require a history schema migration.

#### Scenario: User retranscribes a saved recording
- **WHEN** the user explicitly reruns an existing history item whose audio file is available
- **THEN** the current selected Apple profile processes that file and successful output replaces that item's baseline and final text
- **AND** it does not create another audio copy, automatically polish the result, or paste it into another application

#### Scenario: Original audio is unavailable
- **WHEN** the history item has no saved audio or the file has disappeared
- **THEN** retranscription reports the limitation without replacing its existing text

#### Scenario: User compares Speech and Dictation
- **WHEN** the paired Apple comparison runs against a saved recording
- **THEN** both runs use the same audio bytes and return separately identified raw results
- **AND** the operation restores the selected profile and reports restoration failure visibly without changing saved history or outputting text

### Requirement: Command input and text utilities preserve their boundaries
Command-mode voice input SHALL use Apple recognition and the current profile, but its recognized instruction SHALL bypass automatic transcript polishing and enter the existing command dispatcher. This ASR policy MUST NOT implicitly replace the provider used by command AI or freeform operations on selected text, change translation services, or enable unrelated AI behavior. Post-recognition Traditional Chinese conversion, dictionaries, and emoji SHALL preserve their established deterministic contracts and scopes. Apple native punctuation SHALL remain authoritative before these established transformations; Sherpa punctuation models, pause-based line breaks, and heuristic list formatting MUST NOT run on Apple results.

#### Scenario: User speaks a command while polishing is enabled
- **WHEN** command mode recognizes an instruction with the global polishing switch enabled
- **THEN** the finalized Apple instruction enters command matching without automatic generative polishing
- **AND** the recognized instruction is not pasted as ordinary dictation

#### Scenario: A command explicitly invokes an AI text action
- **WHEN** an existing command requests AI processing of selected text
- **THEN** it follows the configured text-action provider and its own existing contract rather than deriving a provider from the Apple ASR profile

#### Scenario: Dictionary changes while Apple is active
- **WHEN** an applicable deterministic dictionary rule transforms stable Apple output
- **THEN** the existing scope and replacement rules apply without loading Sherpa or claiming to train the Apple speech model

### Requirement: Mac transcription jobs serialize lifecycle and output
The main process SHALL own one shared transcription lease across capture, recognition, optional polishing, history save, and output, including file, history, and comparison jobs. Each job SHALL freeze its Apple profile and owner identity. Profile changes and overlapping jobs MUST be rejected visibly rather than queued during an active lease. Normal stop SHALL deliver pending audio, flush conversion, close input, drain final results, and finalize at most once. Cancellation, owner destruction, renderer failure, and stale generations SHALL prevent late results from saving, polishing, or pasting. Input queues SHALL remain bounded with observable backpressure failure rather than dropped audio.

#### Scenario: Profile changes during polishing
- **WHEN** ASR has completed but the job still owns its polishing or output lease and another window requests a profile change
- **THEN** the main process rejects the change as busy and preserves the frozen job profile

#### Scenario: Duplicate stop races with final results
- **WHEN** duplicate stop events target the same active recording
- **THEN** the application drains one final result and performs history save and output at most once

#### Scenario: Owner closes during recognition
- **WHEN** the owning renderer closes or crashes before finalization
- **THEN** the job is cancelled and its late results cannot save, polish, or paste text
- **AND** a subsequent accepted job has a fresh identity

#### Scenario: Audio transport exceeds its bounded queue
- **WHEN** the consumer cannot keep up with pending input
- **THEN** the job reports backpressure failure and does not label a truncated transcript as complete

### Requirement: Recognition failures never activate a substitute
On Mac, Apple platform, asset, locale, preparation, module, audio transport, resource, and helper failures SHALL remain observable with the selected profile preserved and a retry or corrective action. The system MUST NOT silently switch to Sherpa, another Apple module or locale, cloud recognition, or partial-text success. Empty successful recognition SHALL follow the no-speech path without polishing, normal transcript history, or paste. Recognition failure SHALL remain distinct from the separately specified original-text behavior after a completed ASR result fails optional polishing. Cleanup SHALL release owned sessions, readers, buffers, and helpers without terminating shared system Speech or ANE services.

#### Scenario: Apple fails during an active recording
- **WHEN** the selected Apple module or helper fails after partial preview has appeared
- **THEN** the job ends with an explicit failure and preserves the selected profile for an explicit retry
- **AND** no alternative engine runs and no partial preview is automatically saved, polished, or pasted as a completed transcript

#### Scenario: Successful finalization contains no speech
- **WHEN** the final Apple transcript is empty
- **THEN** the user receives no-speech feedback without polishing, normal history creation, or text output

#### Scenario: User retries after failure
- **WHEN** the user explicitly retries after the blocking condition has been corrected
- **THEN** the coordinator rechecks readiness and creates a fresh owned session rather than reusing a failed or cancelled session

### Requirement: Windows and Linux retain their existing recognition behavior
The new Mac platform gate, Apple-only routing, and Mac setting migration SHALL be conditional on macOS. Windows and Linux SHALL retain the existing Sherpa defaults, supported profiles, streaming routes, model lifecycle, and applicable UI controls. They MUST NOT launch or require Apple helpers, migrate `sherpa` to `apple`, raise their minimum operating-system version because of this change, or present Apple speech as an available local recognizer.

#### Scenario: Existing Windows or Linux installation starts
- **WHEN** a Windows or Linux installation starts with its current Sherpa engine and streaming preferences
- **THEN** those preferences and recognition behavior remain effective without Mac-specific migration
- **AND** no Apple helper is launched or required

#### Scenario: New Windows or Linux installation has no engine preference
- **WHEN** a new Windows or Linux installation starts without `asr_engine`
- **THEN** it retains the existing Sherpa default and model preparation path
- **AND** the Mac deployment requirement does not block startup
