## ADDED Requirements

### Requirement: Transcript polishing has one independent enable switch
The system SHALL expose transcript polishing as a single enabled or disabled setting, independent of automatic paste and automatic Enter settings.

#### Scenario: Polishing is enabled for right-Alt transcription
- **WHEN** right-Alt transcription completes and polishing is enabled
- **THEN** the system sends the pre-polish transcript to the selected Provider and Model before final output

#### Scenario: Polishing is disabled
- **WHEN** right-Alt transcription completes and polishing is disabled
- **THEN** the system uses the pre-polish transcript as the final text and does not start Ollama for polishing

#### Scenario: Operation mode handles a voice command
- **WHEN** the recording is being interpreted as an operation or voice command
- **THEN** the system bypasses AI polishing and uses the non-AI transcript

### Requirement: One persisted and user-editable polishing prompt
The system SHALL present one persisted polishing prompt in the AI text-optimization settings, SHALL use it for all selected providers and models, and SHALL append transcript content as a separate data block without requiring a user-managed placeholder.

#### Scenario: No prompt has been saved yet
- **WHEN** an existing installation opens the AI text-optimization settings without a stored polishing prompt
- **THEN** the system displays the current Taiwan Traditional Chinese constrained-polishing instruction as the initial value
- **AND** it does not require a database migration

#### Scenario: User saves a revised prompt
- **WHEN** the user enters a non-empty polishing prompt and saves AI settings
- **THEN** the system persists the exact trimmed instruction independently of Provider and Model
- **AND** subsequent right-Alt and history re-polishing requests both use that saved instruction

#### Scenario: User enters an empty prompt
- **WHEN** the polishing prompt contains only whitespace
- **THEN** the settings UI prevents saving it
- **AND** the main-process setting interface rejects it without overwriting the prior valid value

#### Scenario: Transcript is assembled for inference
- **WHEN** a polishing request uses the saved instruction
- **THEN** the main process appends the transcript inside a fixed `<transcript>` data block
- **AND** the user does not need to add or preserve a placeholder

#### Scenario: Transcript contains a question or imperative
- **WHEN** the transcript contains a question or command addressed to an assistant
- **THEN** the default prompt instructs the model to edit it as transcript text rather than answer or execute it

#### Scenario: Transcript contains mixed languages
- **WHEN** the input contains Traditional Chinese and English text
- **THEN** the default prompt instructs the model to preserve the language mixture and not translate it

### Requirement: Only technical response validity is enforced
The system MUST treat a provider response as usable when the request contract succeeds and yields well-formed, non-empty final text; it SHALL NOT perform semantic consistency validation or deterministic self-correction preprocessing.

#### Scenario: Provider returns usable final text
- **WHEN** the provider request succeeds with well-formed, non-empty final content
- **THEN** the system accepts that content without checking facts, numbers, dates, names, negation, or model quality

#### Scenario: Provider returns unusable content
- **WHEN** the response is malformed, empty, or contains only thinking content
- **THEN** the system classifies the attempt as a polishing failure

#### Scenario: Transcript contains a self-correction
- **WHEN** the transcript includes phrases such as `不對`、`改成` or `我是說`
- **THEN** the system sends the transcript to the model without deterministic correction preprocessing

### Requirement: Final output respects independent paste settings
The system SHALL use the latest final text for output, SHALL paste only when automatic paste is enabled, and SHALL send Enter only when automatic Enter is independently enabled and paste succeeded.

#### Scenario: Polished text is automatically pasted
- **WHEN** polishing succeeds and automatic paste is enabled
- **THEN** the system pastes the polished text into the current cursor of the foreground application at completion time
- **AND** it does not restore the application that was active when recording started

#### Scenario: Automatic paste is disabled
- **WHEN** final text is ready and automatic paste is disabled
- **THEN** the system saves and displays the text without invoking clipboard paste

#### Scenario: Automatic Enter is enabled
- **WHEN** automatic paste succeeds and automatic Enter is enabled
- **THEN** the system sends Enter after the successful paste

#### Scenario: Paste does not occur
- **WHEN** automatic paste is disabled or paste fails
- **THEN** the system does not send Enter

### Requirement: Polishing failure does not interrupt transcription output
The system SHALL use the pre-polish transcript as final text after any polishing failure, SHALL NOT retry another model or provider, and SHALL record the latest issue inside the SpeakSlow main window without displaying a toast, modal, or operating-system notification.

#### Scenario: Automatic polishing fails
- **WHEN** the provider is unavailable, the model is missing, the request times out, input is over-limit, or the response is technically unusable
- **THEN** the system uses the pre-polish transcript as final text
- **AND** it pastes that text only when automatic paste is enabled
- **AND** the main window shows `潤稿失敗，已使用原始文字`

#### Scenario: A later polishing request succeeds
- **WHEN** the main window contains a polishing issue and a later polishing request succeeds
- **THEN** the system clears the prior polishing issue

### Requirement: Right-Alt processing is single-flight
The system MUST allow only one right-Alt recording-to-output pipeline at a time and SHALL reject a new start event while the prior pipeline is busy.

#### Scenario: User triggers right Alt while processing is busy
- **WHEN** recording, transcription, polishing, saving, or output for the prior request has not completed
- **THEN** the system does not start or queue another recording and shows the current busy state

### Requirement: Persistence failure does not block final output
The system SHALL attempt to save the pre-polish transcript and latest final text, but a persistence failure MUST NOT prevent configured paste output.

#### Scenario: History save fails before output
- **WHEN** final text is available but SQLite persistence fails
- **THEN** the system continues the configured paste and Enter workflow
- **AND** the main window shows `歷史紀錄保存失敗`

### Requirement: Only the baseline and latest final text are retained
The system SHALL retain the pre-polish transcript and latest final text without creating candidate versions or processing metadata, and SHALL avoid duplicate presentation of the same final text.

#### Scenario: New recording is persisted
- **WHEN** a right-Alt recording reaches final output
- **THEN** history retains the pre-polish transcript for recovery and one latest final text for display
- **AND** it does not retain Provider, Model, duration, status, or rejected candidate versions

#### Scenario: Existing compatible columns contain duplicate final text
- **WHEN** a legacy history row contains the same final value in multiple compatible columns
- **THEN** the history UI displays that final text only once

### Requirement: History can be re-polished from the baseline transcript
The system SHALL let the user re-polish a history item from its pre-polish transcript using the currently selected Provider and Model, SHALL show a preview, and MUST require confirmation before replacing the latest final text.

#### Scenario: User previews re-polishing
- **WHEN** the user invokes re-polishing for a history item
- **THEN** the system uses the stored pre-polish transcript rather than the current final text
- **AND** it previews the current final text and new candidate without pasting or sending Enter

#### Scenario: User accepts the new candidate
- **WHEN** the re-polishing preview is confirmed
- **THEN** the system replaces the latest final text without retaining another version

#### Scenario: User cancels or re-polishing fails
- **WHEN** the preview is canceled or the request fails
- **THEN** the system preserves the existing latest final text and performs no clipboard output
