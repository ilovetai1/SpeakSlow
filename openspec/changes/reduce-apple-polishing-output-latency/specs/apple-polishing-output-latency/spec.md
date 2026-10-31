## ADDED Requirements

### Requirement: Apple automatic recording exposes an explicit output timing mode
The system SHALL persist an Apple polishing output mode with only `fast` and `wait_for_polished` as valid values. A missing value SHALL resolve to `fast`. The mode SHALL affect only automatic recording when polishing is enabled, `apple_on_device` is selected, and operation mode is inactive.

#### Scenario: Apple output mode has not been saved
- **WHEN** an eligible Apple automatic recording completes final ASR without a stored output mode
- **THEN** the system uses `fast`
- **AND** settings displays fast output as the selected mode

#### Scenario: User selects wait mode
- **WHEN** the user saves `wait_for_polished` in Apple settings
- **THEN** subsequent eligible Apple automatic recordings wait for the latest final text before configured output
- **AND** the setting does not enable or disable polishing

#### Scenario: Another workflow or provider runs
- **WHEN** the selected provider is not `apple_on_device`, the operation is a command, history is being re-polished, a TXT preview is requested, or SRT is being produced
- **THEN** the system ignores the Apple output timing mode
- **AND** the workflow keeps its existing output and confirmation contract

#### Scenario: Invalid mode is submitted
- **WHEN** a renderer attempts to persist any other Apple output mode value
- **THEN** the main process rejects the write
- **AND** it preserves the prior valid value

### Requirement: Fast Apple output separates cursor output from the later candidate
In Apple fast mode, the system MUST attempt to insert the deterministic pre-polish transcript as the baseline history row before cursor output, SHALL apply configured paste and Enter actions to that baseline at most once, and SHALL continue Apple polishing under the same recording owner. A later valid candidate SHALL be presented without another clipboard or Enter action.

#### Scenario: Fast output succeeds before polishing completes
- **WHEN** final ASR and deterministic transformations produce a non-empty baseline in Apple fast mode
- **THEN** the system attempts one history insert and then emits the baseline for configured output before awaiting Apple generation
- **AND** a successful paste sends Enter exactly once only when automatic Enter is enabled

#### Scenario: Automatic paste is disabled in fast mode
- **WHEN** Apple fast mode produces a baseline and automatic paste is disabled
- **THEN** the system saves and displays the baseline without invoking paste or Enter
- **AND** Apple polishing can still produce a later candidate

#### Scenario: Apple candidate succeeds
- **WHEN** Apple generation returns a technically usable candidate for a baseline that was saved successfully and remains unchanged
- **THEN** the system conditionally updates the latest final text of that same history row while preserving its baseline
- **AND** it displays the candidate in the processed-text panel
- **AND** it does not insert a second history row, paste again, or send Enter again

#### Scenario: Initial history insert fails
- **WHEN** the baseline history insert fails in Apple fast mode
- **THEN** configured baseline output continues and the main window shows a history-save issue
- **AND** a later candidate may be displayed in the current panel but MUST NOT be inserted as a replacement history row

#### Scenario: Saved row changed before candidate completion
- **WHEN** the saved row identifier no longer contains both the expected baseline and unchanged latest text
- **THEN** the conditional candidate update does not overwrite the row
- **AND** the current panel may display the candidate with a history-save issue
- **AND** no additional history row or clipboard action occurs

#### Scenario: Fast polishing fails
- **WHEN** Apple polishing fails, times out, is refused, or returns unusable content after baseline output
- **THEN** the baseline remains the history final text and any already completed external output remains unchanged
- **AND** the system reports the polishing issue without pasting or sending Enter again

#### Scenario: Owner is cancelled while candidate is pending
- **WHEN** polishing is disabled, the recording owner is cancelled or destroyed, or the application begins shutdown after baseline output
- **THEN** the system cancels or ignores the late Apple result and performs no candidate history update or candidate UI event
- **AND** it does not reverse or repeat an already completed baseline output

#### Scenario: Another recording is requested while candidate is pending
- **WHEN** fast-mode baseline output completed but Apple candidate processing has not reached a terminal state
- **THEN** the existing single-flight gate rejects or reports busy for the new recording
- **AND** the candidate remains owned by the original recording

### Requirement: Apple generation performs one inference-time readiness check
The Apple manager MUST NOT issue a separate capability probe immediately before a generation request. The native generation handler SHALL still validate current model availability, target locale, context metadata, complete token budget, and generation completeness before returning usable text. The system SHALL retain an explicit status probe for settings and diagnostics.

#### Scenario: Generation is requested
- **WHEN** the host starts a valid Apple generation operation
- **THEN** it sends one generation request without a preceding host probe request
- **AND** the native handler performs the required request-time readiness and budget checks

#### Scenario: Model becomes unavailable after a settings probe
- **WHEN** a prior settings probe succeeded but the native model is unavailable at generation time
- **THEN** the generation request returns the current structured unavailable reason
- **AND** the system does not use cached readiness to invoke another provider or accept text

#### Scenario: User refreshes Apple readiness
- **WHEN** the user requests a status refresh in settings
- **THEN** the system executes the explicit probe and displays the current observed capability result

### Requirement: Native Apple latency telemetry excludes model content
Each successful native Apple generation SHALL return finite non-negative durations for capability work, token counting, and complete response generation, together with bounded input and output token counts. Product metrics SHALL accept only whitelisted numeric fields and MUST NOT contain transcript, prompt, generated response, file or audio path, secret, raw stderr, or content-bearing framework errors.

#### Scenario: Native generation completes
- **WHEN** a native generation returns usable final text
- **THEN** the helper reports `capabilityMs`, `tokenCountMs`, and `responseCompleteMs` measured within that request
- **AND** the host associates those durations and token counts with the current internal latency session

#### Scenario: Non-streaming generation is measured
- **WHEN** the native helper uses a complete non-streaming response API
- **THEN** the system does not invent or infer a first-token duration

#### Scenario: Supplementary timing is unavailable or malformed
- **WHEN** otherwise valid generated text lacks a valid supplementary timing field
- **THEN** the host omits or marks that metric unavailable without treating the generated text as failed
- **AND** it does not substitute an invented duration

#### Scenario: Metrics privacy regression runs
- **WHEN** unique sentinel strings appear in the instruction, transcript, and generated response across success and failure outcomes
- **THEN** those strings are absent from application logs, helper diagnostics, and exported latency metrics
- **AND** exported metrics contain only the whitelisted non-content fields
