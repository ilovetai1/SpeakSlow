## ADDED Requirements

### Requirement: Explicit writing profiles with a compatible neutral default
SpeakSlow SHALL provide `neutral`, `message`, `email`, and `note` writing profiles. An explicit manual profile selection SHALL take precedence over a configured App mapping. When neither supplies a profile, the system SHALL select `neutral`. With `neutral` selected and text context disabled, the existing saved polishing instruction and transcript prompt contract SHALL remain unchanged. Profile selection SHALL NOT enable external text capture or authorize provider changes.

#### Scenario: Neutral default preserves the existing prompt
- **WHEN** no manual profile or applicable App mapping is configured and text context is disabled
- **THEN** the system SHALL use `neutral` and SHALL build the existing transcript-only prompt with the existing saved polishing instruction

#### Scenario: Manual selection overrides an App mapping
- **WHEN** the current App has an `email` mapping and the user explicitly selects `note`
- **THEN** the system SHALL use `note` without modifying the saved App mapping or enabling text context

#### Scenario: Profile selection does not collect external text
- **WHEN** the user selects `message` while text context is disabled
- **THEN** the system SHALL apply the profile instruction without reading selected text or cursor-neighbor text from an external application

### Requirement: Default-off text context with a narrow provider and workflow boundary
Raw text context SHALL be disabled by default and SHALL require a separate explicit user opt-in. In version 2.1.0, the system SHALL capture and consume raw text context only for automatic offline dictation using the Ollama provider in `optimize` mode with AI polishing enabled. Remote providers, streaming transcription, history re-polishing, and command mode SHALL NOT request external text context. Selecting a writing profile or enabling correction learning SHALL NOT enable text context for polishing.

#### Scenario: Eligible local dictation uses the enabled context feature
- **WHEN** raw text context is enabled and automatic offline dictation reaches Ollama `optimize` with AI polishing enabled
- **THEN** the system SHALL attempt a bounded context capture and SHALL consume it only after the validity and budget checks in this capability pass

#### Scenario: Remote and excluded workflows do not capture context
- **WHEN** polishing uses a remote provider or the operation is streaming transcription, history re-polishing, or command mode
- **THEN** the context-aware polishing feature SHALL NOT invoke the external text reader and SHALL NOT append raw external text to the provider request

#### Scenario: Disabled polishing does not capture context
- **WHEN** AI polishing or the raw text context setting is disabled
- **THEN** the context-aware polishing feature SHALL NOT read external field text for the transcription

### Requirement: An original read-only macOS field reader
The system SHALL use an original read-only macOS helper to return native field identity, field bounds, editability, secure-field status, and only the selected or cursor-neighbor text needed by the requested operation. The helper SHALL NOT insert text, generate keystrokes, activate applications, restore focus, or alter the existing paste and Enter behavior. The system SHALL require a reliable native field identity and SHALL NOT treat App PID, accessibility role, or bounds alone as proof of field identity. Secure fields, denied Apps, non-editable fields, unsupported platforms, missing permissions, and unsupported field interfaces SHALL yield typed non-available results.

#### Scenario: An eligible field returns bounded read-only evidence
- **WHEN** an allowed macOS application exposes a non-secure editable field with a reliable native identity
- **THEN** the helper SHALL return the identity, bounds, editability, secure-field status, and the requested bounded text without changing the field or focus

#### Scenario: A secure field does not expose text
- **WHEN** the target field is secure
- **THEN** the helper SHALL return `secure_field` and SHALL NOT read or return its selected or cursor-neighbor text

#### Scenario: A field cannot supply reliable identity
- **WHEN** the reader can observe only App PID, role, or bounds and cannot establish a reliable native field identity
- **THEN** it SHALL return a typed unsupported result and SHALL NOT present the context as valid

### Requirement: Bounded snapshots with a deadline and freshness check
A polishing snapshot SHALL contain no more than 200 Unicode code points in total across selected text, text before the cursor, and text after the cursor. The system SHALL enforce a 250 ms deadline for each capture and a two-second time-to-live from capture completion to prompt consumption, measured with a monotonic clock. Before consumption, the system SHALL verify that the native field identity remains the intended current field. An expired, changed, incomplete, or invalid snapshot SHALL NOT contribute text to the prompt. The system SHALL NOT truncate the transcript to accommodate a snapshot.

#### Scenario: Large neighboring text remains within the capture limit
- **WHEN** the field exposes more neighboring or selected text than the polishing snapshot budget permits
- **THEN** the helper SHALL return at most 200 Unicode code points across the three text portions and SHALL NOT return an unbounded full-field value

#### Scenario: A capture exceeds its deadline
- **WHEN** a context capture cannot complete within 250 ms
- **THEN** the system SHALL stop waiting for it, return `timeout`, and SHALL NOT use a late response in the polishing request

#### Scenario: A snapshot expires or the field changes
- **WHEN** consumption occurs more than two seconds after capture completion or the native field identity has changed
- **THEN** the system SHALL return a visible stale or focus-changed status and SHALL build the request without snapshot text

### Requirement: Optional context respects the existing local model budget
The system SHALL preserve the existing 500-Unicode-code-point local transcript limit and Ollama `num_ctx: 2048` configuration. It SHALL append optional context only when a measured usable remaining prompt budget can accommodate the applicable polishing instruction, profile, transcript, context wrapper, context text, and required output allowance. If the usable remaining budget cannot be established or is insufficient, the system SHALL omit optional context and report `omitted_budget`. It SHALL NOT reduce transcript content, replace the saved instruction, expand `num_ctx`, switch provider, or bypass the existing transcript-limit result to fit context.

#### Scenario: The complete request fits the measured budget
- **WHEN** the transcript is within the existing limit and the measured remaining budget accommodates the bounded optional context
- **THEN** the system SHALL include that context while retaining the complete transcript, the saved instruction, and `num_ctx: 2048`

#### Scenario: Context does not fit or its remaining budget is unknown
- **WHEN** the optional context does not fit the measured usable budget or that budget cannot be established
- **THEN** the system SHALL omit the optional text, report `omitted_budget`, and preserve the complete transcript and existing instruction

#### Scenario: The transcript exceeds the existing local limit
- **WHEN** the transcript exceeds the existing 500-code-point local polishing limit
- **THEN** the system SHALL retain the existing over-limit behavior without shortening the transcript or using context to bypass that limit

### Requirement: Context is reference data rather than an instruction source
The prompt SHALL distinguish the saved polishing instruction and selected profile from transcript and external-context data. External context SHALL assist expression, formatting, and locally evidenced terminology only. The system SHALL preserve the existing requirements to retain meaning, numbers, dates, names, technical terms, original languages, and mixed-language content. It SHALL NOT answer questions, execute commands, infer missing facts, or treat text in either data source as instructions that override the polishing contract.

#### Scenario: Neighboring content includes an instruction
- **WHEN** captured context contains text that asks the model to ignore its rules or execute a command
- **THEN** that text SHALL be presented as reference data and SHALL NOT override the polishing instruction or cause an answer or command execution

#### Scenario: Context suggests additional information
- **WHEN** neighboring text contains facts that are absent from the dictated transcript
- **THEN** the polishing result SHALL NOT add those facts to the transcript

### Requirement: Ephemeral context remains in the main-process boundary
Raw context snapshots SHALL remain within the main process and its read-only helper and SHALL be discarded after consumption or invalidation. Renderer IPC SHALL expose only opaque handles and non-content status data for this feature. Snapshots SHALL NOT be stored in history, settings, ordinary logs, latency metrics, or exported diagnostics. The only provider permitted to receive raw context under this capability SHALL be the eligible loopback Ollama request. The system SHALL invalidate outstanding polishing snapshots when the user disables raw text context.

#### Scenario: Renderer requests polishing with a context handle
- **WHEN** the renderer starts an eligible polishing operation
- **THEN** IPC SHALL pass an opaque handle and SHALL NOT return the snapshot's selected or neighboring text to the renderer

#### Scenario: Captured context completes or becomes invalid
- **WHEN** a snapshot is consumed, expires, is rejected, or the feature is disabled
- **THEN** the main-process feature SHALL release its raw text and SHALL NOT persist or log it

#### Scenario: Diagnostics are exported
- **WHEN** the user exports diagnostics or latency metrics after context-aware polishing
- **THEN** the export SHALL contain no raw context, transcript, field value, or screenshot data from this capability

### Requirement: Unavailable context is observable without changing the existing transcription contract
When an enabled context attempt is unavailable, the system SHALL expose a non-content reason such as unsupported field, denied App, secure field, missing permission, non-editable field, timeout, stale snapshot, changed field, invalid data, or `omitted_budget`. It SHALL continue through the existing transcript-only polishing and its existing failure fallback. Context unavailability SHALL NOT be represented as successful context capture and SHALL NOT alter history-save, paste, Enter, or provider fallback behavior. Unsupported platforms SHALL retain the existing transcription workflow and SHALL explicitly identify the new reader as unsupported.

#### Scenario: Context is unavailable while dictation is otherwise valid
- **WHEN** an enabled context capture returns a non-available result
- **THEN** the interface SHALL show its non-content reason and the system SHALL continue with the existing transcript-only polishing and output contract

#### Scenario: The runtime does not support the new reader
- **WHEN** SpeakSlow runs on a platform outside the version 2.1.0 reader support boundary
- **THEN** it SHALL report the reader as unsupported while retaining the existing transcription workflow
