## ADDED Requirements

### Requirement: Streaming transcription enters the shared finalization workflow only after final ASR
The system SHALL keep live Apple Speech partial results outside generative polishing, and after the streaming session produces one final transcript it SHALL apply the same conversion, dictionary, optional polishing, persistence, paste, and Enter contracts used by normal recording.

#### Scenario: Streaming final transcript is polished
- **WHEN** an Apple streaming session reaches a non-empty final transcript and transcript polishing is enabled
- **THEN** the system sends the stable pre-polish transcript to the selected Provider exactly once
- **AND** it saves and outputs the latest final text through the shared finalization workflow

#### Scenario: Streaming partial results change during recording
- **WHEN** Apple Speech revises a partial result before the recording stops
- **THEN** the system updates only the SpeakSlow preview
- **AND** it does not invoke a language model, save a normal history item, or paste that partial result

#### Scenario: Streaming polishing fails
- **WHEN** final streaming ASR succeeds but the selected polishing Provider fails, is unavailable, times out, or returns unusable content
- **THEN** the system saves and outputs the stable pre-polish transcript according to the existing paste settings
- **AND** it reports the existing non-blocking polishing failure without re-running ASR or switching Provider

### Requirement: TXT file transcription can request a bounded polishing preview
The system SHALL keep raw file transcription as the recoverable baseline and SHALL let a user request a polishing preview for TXT output using the current Provider, Model, prompt, and writing profile. The system MUST NOT automatically replace the raw file transcript without confirmation.

#### Scenario: User previews TXT polishing
- **WHEN** a TXT file transcription has completed and the user requests polishing
- **THEN** the system sends the raw file transcript through the main-process provider seam
- **AND** it displays the raw transcript and candidate without changing the source file, history, clipboard, or exported text

#### Scenario: User accepts a TXT polishing preview
- **WHEN** the user confirms a successful TXT polishing candidate
- **THEN** the file result view uses the candidate as its current export and copy text
- **AND** it retains the raw transcript in memory for reset or another preview during that file job

#### Scenario: TXT content exceeds the verified provider budget
- **WHEN** a TXT transcript cannot fit the selected provider's verified input and output budget
- **THEN** the system reports an input-over-limit result without truncating, splitting, or partially replacing the transcript
- **AND** the raw transcript remains available for copy and export

### Requirement: Timed subtitles and operation commands preserve their semantic boundaries
The system MUST keep operation-mode voice commands outside automatic polishing and MUST keep SRT generation outside free-form generative rewriting unless a later capability defines timing-preserving transformations.

#### Scenario: Operation mode receives Apple ASR text
- **WHEN** the selected Apple speech profile produces a final transcript while operation mode is active
- **THEN** the system routes the non-polished transcript to command dispatch
- **AND** it does not invoke the selected polishing Provider

#### Scenario: User requests SRT output
- **WHEN** file transcription is producing SRT with native audio time ranges
- **THEN** the system uses the Apple ASR segment text and timing without automatic language-model rewriting
- **AND** the UI does not present the TXT polishing preview as an SRT-safe operation

### Requirement: Local provider selection does not broaden fallback authority
Selecting the Apple on-device Provider SHALL affect every existing AI text-processing consumer that uses the shared provider seam, but a failure MUST NOT cause the system to invoke a previously configured Ollama, PCC, or remote Provider.

#### Scenario: Apple provider is selected for history polishing
- **WHEN** the user requests a history re-polishing preview while `apple_on_device` is selected
- **THEN** the preview uses the Apple on-device adapter and the shared persisted prompt
- **AND** confirmation remains required before replacing the current final text

#### Scenario: Apple provider fails for a custom AI command
- **WHEN** an existing custom or freeform AI text command invokes the shared provider seam and the Apple provider is unavailable
- **THEN** the command fails with the mapped Apple error
- **AND** the system does not send the selected text to another provider
