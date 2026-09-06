## ADDED Requirements

### Requirement: Explicit provider and dynamic local model selection
The system SHALL provide explicit Provider, Model, and transcript-polishing settings, and SHALL dynamically list locally available Ollama models with text-completion capability without quality certification or automatic download.

#### Scenario: Ollama provider is selected
- **WHEN** the user selects Ollama as the Provider
- **THEN** the system connects to or starts the loopback Ollama service without requiring an API key
- **AND** it lists locally available models using Ollama model APIs

#### Scenario: Local models are presented
- **WHEN** Ollama returns its available model list
- **THEN** the system presents models with completion capability and excludes embedding-only and explicit Cloud model references
- **AND** it displays each model's size, parameter size, and quantization when available

#### Scenario: Large local model is selected
- **WHEN** a listed model is larger than 2 GB
- **THEN** the system displays a resource warning without blocking selection

#### Scenario: Initial local model is chosen
- **WHEN** the user opens Ollama model selection for the first time
- **THEN** the system preselects `qwen3:1.7b` when it is present
- **AND** otherwise requires the user to select a model

#### Scenario: Model selection is revisited
- **WHEN** the user has previously selected an available local model
- **THEN** the system preserves that selection and does not silently switch models

#### Scenario: Selected model is unavailable
- **WHEN** the selected model is no longer locally available
- **THEN** the system marks it unavailable and prevents transcript polishing from being newly enabled
- **AND** it does not download or substitute another model

### Requirement: Native bounded Ollama request
The system MUST use Ollama's native loopback `/api/chat` endpoint with the selected model, `stream:false`, `keep_alive:0`, `temperature:0`, `num_ctx:2048`, and a 60-second timeout; it SHALL send `think:false` when the selected model supports thinking.

#### Scenario: Local polishing request is sent
- **WHEN** an enabled Ollama provider receives a transcript-polishing request
- **THEN** the system snapshots the selected model for that request and sends the bounded native payload to `127.0.0.1:11434/api/chat`

#### Scenario: Remote provider processes text
- **WHEN** a non-Ollama provider is selected
- **THEN** the system uses the provider's existing remote request contract without Ollama-specific fields

#### Scenario: Request exceeds the timeout
- **WHEN** a local model has not completed within 60 seconds
- **THEN** the system cancels the request and reports a polishing failure without switching provider or model

#### Scenario: Transcript exceeds the supported context budget
- **WHEN** a transcript exceeds the tested input limit for the universal prompt and `num_ctx:2048`
- **THEN** the system fails polishing before inference without truncating, splitting, or expanding context

### Requirement: Single main-process provider seam
All renderer workflows SHALL invoke AI text processing through a main-process interface, and provider credentials, model API calls, response parsing, timeout handling, and error mapping MUST remain behind that seam.

#### Scenario: Renderer requests text processing
- **WHEN** a renderer workflow requests transcript polishing
- **THEN** it invokes the main-process IPC interface and does not call provider endpoints or read API credentials directly

### Requirement: On-demand owned Ollama lifecycle
The system SHALL avoid loading an Ollama model at application startup, SHALL reuse a compatible existing Ollama server without taking ownership, and SHALL start an installed Ollama server on demand when supported.

#### Scenario: External Ollama server is running
- **WHEN** a compatible server responds on the loopback endpoint
- **THEN** the system reuses it and does not stop it when SpeakSlow exits

#### Scenario: SpeakSlow starts Ollama
- **WHEN** no server responds and a supported executable is found on macOS Apple Silicon
- **THEN** the system starts a Cloud-disabled `ollama serve`, waits for bounded readiness, and records process ownership

#### Scenario: Ollama cannot be started
- **WHEN** neither a compatible server nor a supported executable is available
- **THEN** the system reports a polishing failure and does not download a model

#### Scenario: SpeakSlow exits during processing
- **WHEN** SpeakSlow exits while a local request is in flight
- **THEN** the system cancels the request and stops only an Ollama process that SpeakSlow started
- **AND** it does not paste a late result

### Requirement: Model runner is released after each request
The system MUST request immediate unload after every successful, failed, or timed-out local request and SHALL treat unload failure as a resource issue rather than invalidating an otherwise usable result.

#### Scenario: Local request finishes
- **WHEN** a local request reaches a terminal outcome
- **THEN** the system uses `keep_alive:0` and performs a bounded running-model check

#### Scenario: Unload fails after usable output
- **WHEN** the response is technically usable but the model remains loaded
- **THEN** the system retains the final text and records a non-blocking resource issue

### Requirement: Local content remains outside application logs and external AI endpoints
The Ollama adapter MUST send transcript content only to the configured loopback endpoint and SHALL NOT log transcripts, prompts, model responses, or secrets.

#### Scenario: Local request is logged
- **WHEN** a local request succeeds or fails
- **THEN** diagnostic logs contain only non-content execution information such as stage, error code, character count, and duration

#### Scenario: Ollama network destination is inspected
- **WHEN** an integration test executes the local adapter
- **THEN** no transcript-bearing request is sent to a non-loopback AI endpoint
