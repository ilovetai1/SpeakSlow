## MODIFIED Requirements

### Requirement: Final output respects independent paste settings
The system SHALL use the latest final text for output except when eligible Apple fast output explicitly selects the stable pre-polish baseline for its single cursor output. It SHALL paste only when automatic paste is enabled, and SHALL send Enter only when automatic Enter is independently enabled and that paste succeeded. A later Apple fast-mode candidate MUST NOT trigger another paste or Enter.

#### Scenario: Polished text is automatically pasted
- **WHEN** polishing succeeds outside Apple fast mode and automatic paste is enabled
- **THEN** the system pastes the polished text into the current cursor of the foreground application at completion time
- **AND** it does not restore the application that was active when recording started

#### Scenario: Apple fast baseline is automatically pasted
- **WHEN** eligible Apple fast mode has attempted baseline persistence and automatic paste is enabled
- **THEN** the system pastes the stable pre-polish baseline into the current cursor of the foreground application without awaiting the Apple candidate
- **AND** it does not restore the application that was active when recording started

#### Scenario: Apple fast candidate completes after output
- **WHEN** a valid Apple fast-mode candidate completes after the baseline output decision
- **THEN** the system may update the current panel and unchanged history row
- **AND** it does not invoke paste or Enter for that candidate

#### Scenario: Apple wait mode completes
- **WHEN** `wait_for_polished` is selected and Apple polishing reaches a usable final result
- **THEN** the system saves and applies configured output to that polished result through the existing final-output workflow

#### Scenario: Automatic paste is disabled
- **WHEN** the selected output text is ready and automatic paste is disabled
- **THEN** the system saves and displays the text without invoking clipboard paste

#### Scenario: Automatic Enter is enabled
- **WHEN** automatic paste succeeds and automatic Enter is enabled
- **THEN** the system sends Enter after the successful paste

#### Scenario: Paste does not occur
- **WHEN** automatic paste is disabled or paste fails
- **THEN** the system does not send Enter

### Requirement: Polishing failure does not interrupt transcription output
The system SHALL preserve the pre-polish transcript after any polishing failure, SHALL NOT retry another model or provider, and SHALL record the latest issue inside the SpeakSlow main window without displaying a toast, modal, or operating-system notification. Outside Apple fast mode it SHALL use that baseline as final configured output. When Apple fast-mode baseline output already occurred, it MUST NOT repeat the output or Enter action.

#### Scenario: Automatic polishing fails before output
- **WHEN** the provider is unavailable, the model is missing, the request times out, input is over-limit, or the response is technically unusable outside Apple fast mode
- **THEN** the system uses the pre-polish transcript as final text
- **AND** it pastes that text only when automatic paste is enabled
- **AND** the main window shows `潤稿失敗，已使用原始文字`

#### Scenario: Apple fast polishing fails after baseline output
- **WHEN** Apple fast mode has completed its baseline output decision and later polishing fails
- **THEN** the system preserves the baseline as the latest saved final text
- **AND** it does not paste or send Enter again
- **AND** the main window shows `潤稿失敗，已使用原始文字`

#### Scenario: Polishing is explicitly disabled during a request
- **WHEN** the user disables polishing while a candidate is pending
- **THEN** the system cancels or ignores the late result without a polishing-failure warning
- **AND** it does not change history or perform another clipboard action

#### Scenario: A later polishing request succeeds
- **WHEN** the main window contains a polishing issue and a later polishing request succeeds
- **THEN** the system clears the prior polishing issue
