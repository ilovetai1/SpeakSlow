## MODIFIED Requirements

### Requirement: One persisted and user-editable polishing prompt
The system SHALL present one persisted polishing prompt in the AI text-optimization settings, SHALL use it for all selected providers and models, and SHALL append transcript content as a separate data block without requiring a user-managed placeholder. The system SHALL preserve that instruction when adding an explicitly selected writing profile or an eligible optional local context data block; neutral profile with context disabled MUST preserve the existing prompt/request contract.

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

#### Scenario: Neutral profile and context disabled
- **WHEN** polishing uses neutral profile and optional context is disabled
- **THEN** the system assembles the same instruction and transcript messages as the existing workflow
- **AND** it does not capture external field text

#### Scenario: A writing profile is explicitly selected
- **WHEN** polishing uses message, email, or note profile
- **THEN** the main process adds the fixed profile policy without rewriting the stored user instruction
- **AND** the policy permits only style and formatting while preserving meaning, numbers, names, negation, and language mixture

#### Scenario: Eligible local context is included
- **WHEN** an automatic offline Ollama polishing request has optional context enabled and a valid bounded context snapshot with verified remaining input budget
- **THEN** the main process adds the escaped snapshot as a separate untrusted data block
- **AND** context cannot override instructions, introduce missing facts, execute commands, or trigger a provider/model switch

#### Scenario: Re-polishing a history item
- **WHEN** the user explicitly re-polishes an existing history item
- **THEN** the request uses its stored baseline and the current saved instruction with any explicitly chosen profile
- **AND** it does not capture or reuse external field context
- **AND** the existing preview and confirmation contract remains in effect
