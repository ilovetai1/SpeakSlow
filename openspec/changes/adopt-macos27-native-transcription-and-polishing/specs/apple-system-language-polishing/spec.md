## ADDED Requirements

### Requirement: Apple polishing uses an owned native system-model helper
The macOS product SHALL expose `apple_on_device` as a main-process polishing provider implemented by a bundled, signed Swift executable using the public Foundation Models `SystemLanguageModel` API. The helper MUST select the system on-device model explicitly and MUST NOT use `fm serve`, a loopback HTTP compatibility server, Private Cloud Compute, or a third-party model as its production implementation.

#### Scenario: Renderer requests Apple polishing
- **WHEN** an eligible workflow requests polishing with `apple_on_device` selected
- **THEN** the renderer invokes the shared main-process text-processing interface
- **AND** the main process dispatches the request to the bundled Swift helper
- **AND** provider calls, request lifecycle, response validation, and error mapping remain behind that interface

#### Scenario: Packaged application resolves the helper
- **WHEN** the packaged macOS application starts an Apple polishing request
- **THEN** it uses the helper inside that application's resources with the expected protocol version
- **AND** a missing executable, incompatible protocol, or execution failure produces a visible provider failure without invoking `fm`, Ollama, or an external endpoint

### Requirement: Helper messages have bounded and correlated outcomes
The host and helper MUST exchange versioned JSONL messages over owned stdin/stdout pipes with request identifiers, bounded message sizes, capability responses, cancellation, and structured terminal outcomes. Each accepted request SHALL have exactly one host-visible terminal outcome. Protocol errors and helper stderr MUST NOT be interpreted as successful generated text.

#### Scenario: Helper returns a successful response
- **WHEN** a response has the expected protocol version and identifier for an active request
- **THEN** the host accepts only the defined success fields after response validation
- **AND** it settles that request once

#### Scenario: Response is malformed or belongs to another request
- **WHEN** a message exceeds the protocol size limit, is malformed, uses an incompatible version, or has an unknown request identifier
- **THEN** the host reports a structured protocol failure for affected active work
- **AND** it does not use message fragments as polished text

#### Scenario: Duplicate or late terminal response arrives
- **WHEN** a response arrives after its request completed, failed, timed out, or was cancelled
- **THEN** the host ignores that response
- **AND** it does not save, paste, or replace any text with that response

### Requirement: Model readiness and metadata are observed at runtime
The provider SHALL query the actual system model's availability, model variant, supported target locale, context size, and token-count capability rather than deriving them from the OS version alone. It SHALL use Taiwan Traditional Chinese as the product target locale. Availability SHALL be refreshed when the user requests a status check and before inference. Unavailable or unreported metadata MUST be represented explicitly without inventing a model identity or capacity.

#### Scenario: System model is ready
- **WHEN** the installed system model reports available and supports the requested `zh-TW` locale or its framework-declared equivalent
- **THEN** the provider returns its observed variant, effective locale, context size, and token-count capability to the main process
- **AND** settings display the observed readiness and model information without treating a successful probe as a quality certification

#### Scenario: Device or Apple Intelligence is not ready
- **WHEN** the framework reports unsupported hardware, Apple Intelligence disabled, model assets not ready, or another unavailable reason
- **THEN** the provider reports the corresponding structured unavailable reason
- **AND** it does not run inference, automatically download assets, change system settings, or select another provider

#### Scenario: Locale is unsupported
- **WHEN** the model does not support the target locale
- **THEN** the request fails with an explicit locale error
- **AND** the provider does not silently translate the transcript or choose another locale

#### Scenario: Required budget metadata cannot be obtained
- **WHEN** the provider cannot obtain a valid positive context size or perform the required token-budget calculation
- **THEN** it reports a structured capability or budget failure before inference
- **AND** it does not assume a 4096-token or 8192-token capacity

### Requirement: Every polishing request has an independent session
The helper MUST create a new language-model session for each request using the request's snapshot of the persisted polishing instruction, target locale, bounded generation options, and transcript data. It SHALL use the system model's normal guardrails and SHALL NOT carry conversation history, prior transcripts, or prior generated text into another request. Transcript content MUST remain a separate data block and MUST NOT become executable application instructions.

#### Scenario: Two transcripts are processed successively
- **WHEN** two requests use the same provider and helper process
- **THEN** each request receives a distinct session containing only its own instruction and permitted input
- **AND** the second request does not inherit the first request's transcript or response

#### Scenario: Settings change during inference
- **WHEN** the user changes the polishing instruction or generation configuration while a request is active
- **THEN** the active request retains its original snapshot
- **AND** a subsequent request uses the newly persisted configuration

#### Scenario: Transcript contains commands or mixed languages
- **WHEN** transcript data contains instructions, a question, Traditional Chinese, English, or literal code
- **THEN** the default instruction treats that content as text to edit and preserves the language mixture
- **AND** the application does not execute transcript commands or interpret the model response as an application action

### Requirement: Context accounting covers the complete request
Before inference, the provider MUST calculate the token budget for the actual session instructions, locale instruction, transcript wrapper, transcript, and any other permitted input using the runtime-supported token-count API. It SHALL reserve a bounded maximum output allowance and any documented framing allowance within the observed context capacity. Apple requests MUST NOT inherit Ollama's fixed 500-code-point input rule as a substitute for token accounting.

#### Scenario: Complete request fits the budget
- **WHEN** the calculated input cost plus reserved output and framing allowances fits the actual context capacity
- **THEN** inference uses that validated request and the reserved bounded output limit
- **AND** no prior session history consumes unaccounted context

#### Scenario: Complete request exceeds the budget
- **WHEN** the assembled request exceeds the observed context budget
- **THEN** polishing fails before inference with an explicit over-limit reason
- **AND** it does not silently truncate, split, summarize, discard input, or enlarge an assumed context capacity
- **AND** the invoking workflow retains its pre-polish transcript according to the shared failure contract

#### Scenario: Additional context is proposed
- **WHEN** a workflow supplies cursor context or another optional input that is not part of this provider's defined request contract
- **THEN** the provider rejects that unsupported input rather than inheriting Ollama-specific context behavior
- **AND** any future supported context input must participate in the same complete token budget

### Requirement: Inference has a cancellable bounded lifetime
Each Apple polishing request MUST have a finite 60-second host deadline covering helper startup, readiness, budget validation, and inference. The host SHALL support cancellation during every phase, cancel the framework task, release the request session, and ignore late responses. Cancelling one request MUST NOT cancel another owner's work or terminate Apple's shared model services.

#### Scenario: Request reaches its deadline
- **WHEN** a request has not reached a terminal outcome within 60 seconds
- **THEN** the host reports a structured timeout and cancels the owned request
- **AND** the invoking workflow applies its defined polishing-failure behavior without retrying another model or provider

#### Scenario: User disables polishing during active work
- **WHEN** polishing is disabled during startup, readiness, budgeting, or inference
- **THEN** the host cancels the outstanding request and prevents its result from being applied even if polishing is immediately enabled again
- **AND** the workflow keeps the original transcript without a polishing-failure warning for that explicit disable

#### Scenario: Request owner closes or application exits
- **WHEN** the renderer owning a request closes or SpeakSlow exits
- **THEN** the main process cancels that owner's pending work
- **AND** application shutdown terminates only the Swift helper processes owned by SpeakSlow
- **AND** no late result is pasted or committed to history

#### Scenario: Helper does not acknowledge cancellation
- **WHEN** the helper remains unresponsive after the protocol's finite cancellation grace period
- **THEN** the host settles the request and terminates only its owned helper
- **AND** a subsequent request can start a fresh helper without accepting the old request's response

### Requirement: Model and transport failures remain observable
The provider SHALL distinguish unavailable model, unsupported locale, budget failure, guardrail refusal, context overflow, generation truncation, unusable output, cancellation, timeout, protocol failure, and helper crash through structured error codes. It MUST NOT treat an empty, whitespace-only, malformed, refused, or known incomplete response as usable final text. This technical response contract SHALL NOT be represented as runtime semantic-consistency validation.

#### Scenario: Framework refuses or cannot complete generation
- **WHEN** the framework reports a guardrail refusal, context overflow, output-limit truncation, or another incomplete-generation failure
- **THEN** the provider returns the corresponding failure rather than partial generated text
- **AND** the shared workflow preserves its original transcript or current history text as applicable

#### Scenario: Helper crashes while a request is active
- **WHEN** the owned helper exits unexpectedly or its pipe closes before a valid terminal result
- **THEN** the host settles affected requests with a helper failure
- **AND** it releases the busy state without silently retrying inference

#### Scenario: Valid text may still contain a semantic error
- **WHEN** a technically valid non-empty response is returned
- **THEN** it remains subject to the user's selected polishing workflow and the separately defined release quality gate
- **AND** a transport success is not counted as proof that numbers, facts, names, or negation were preserved

### Requirement: Apple content stays on the selected on-device path
The Apple provider MUST send text only through its owned native helper to the explicitly selected on-device system model. It MUST NOT send transcripts, instructions, cursor context, or responses to a network endpoint, PCC, a remote model, Ollama, or telemetry. Asset readiness and explicit system asset installation SHALL be treated separately from inference and SHALL NOT carry transcript content.

#### Scenario: Ready model is used without network access
- **WHEN** a controlled integration test disables network access after required system assets are ready
- **THEN** Apple polishing completes through the native on-device path for supported test inputs
- **AND** the test records any failure rather than enabling a network fallback

#### Scenario: Apple model is unavailable or request fails
- **WHEN** availability, token counting, inference, timeout, or helper communication fails
- **THEN** no transcript-bearing request is sent to another provider or network destination
- **AND** the failure remains visible through the shared workflow's original-text fallback or preview-failure behavior

#### Scenario: Network activity is inspected
- **WHEN** the provider's integration tests inspect process execution and outbound request hooks
- **THEN** no `fm serve`, PCC model, third-party endpoint, or transcript-bearing HTTP request is invoked
- **AND** offline test results are scoped to ready assets rather than presented as first-install download evidence

### Requirement: Logs exclude model content and secrets
Application and helper diagnostics MUST exclude transcripts, full prompts, generated responses, cursor text, raw content-bearing stderr, secrets, and audio or document paths. Structured diagnostics SHALL contain only non-content execution fields such as request identifier, stage, error code, character or token counts, and duration. Dedicated consented evaluation artifacts SHALL remain separate from product logs and normal user history.

#### Scenario: Request succeeds or fails
- **WHEN** an Apple request produces diagnostic records
- **THEN** logs contain bounded non-content metadata only
- **AND** errors are mapped without copying raw framework descriptions that include input or output text

#### Scenario: Privacy regression exercises every terminal outcome
- **WHEN** integration tests use unique sentinel strings in instructions, transcripts, and generated content across success and failure cases
- **THEN** those sentinels are absent from application logs, helper diagnostics, crash handling output, and metrics exports
- **AND** the test does not classify deliberately saved isolated evaluation inputs and outputs as product logs

### Requirement: Settings expose Apple readiness without an API key
The AI settings SHALL provide an explicit Apple on-device provider with dynamic model readiness and SHALL NOT require, store, or synthesize an API key for it. New macOS installations SHALL preselect `apple_on_device` while keeping polishing disabled. Existing installations MUST retain their chosen provider and polishing preference; adding Apple support MUST NOT silently replace an existing provider or newly enable polishing.

#### Scenario: Fresh macOS installation opens AI settings
- **WHEN** no provider or polishing preference has previously been saved
- **THEN** Apple on-device is the selected provider and polishing remains disabled
- **AND** the UI shows model readiness without an API-key input

#### Scenario: Existing user has another provider selected
- **WHEN** an existing installation upgrades with Ollama or another valid provider selected
- **THEN** that provider and its independent polishing preference remain selected
- **AND** availability of Apple does not change the saved provider

#### Scenario: User explicitly selects Apple
- **WHEN** the user selects Apple and saves settings
- **THEN** saving requires no API key or arbitrary local placeholder
- **AND** enabling polishing requires a current available target-locale model and valid capabilities
- **AND** unavailable readiness is explained without silently selecting another provider

### Requirement: Quality evaluation separates recognition from text editing
Apple model adoption MUST be evaluated with a fixed, reproducible protocol that separates ASR raw quality from polishing and narrowly scoped spelling correction. The evaluation SHALL retain identical input hashes, baseline text, generated text, prompt and generation configuration, complete outcome counts, and independently defined scoring rules in isolated evaluation artifacts. It SHALL use held-out real utterances or transcripts in addition to existing synthetic fixtures and SHALL NOT reuse prompt-tuning examples as independent acceptance evidence.

#### Scenario: ASR quality is compared
- **WHEN** recognition results are evaluated across system versions or engines
- **THEN** each configuration receives the same hashed audio without AI polishing, dictionary replacement, or output normalization that hides the raw result
- **AND** the report separately gives strict Traditional Chinese CER, declared script-normalized CER, insertions, deletions, substitutions, key entity and numeric errors, and independently annotated sentence-boundary quality

#### Scenario: Polishing quality is compared
- **WHEN** Apple and Ollama polishing are evaluated
- **THEN** both receive the same fixed pre-polish transcript rather than independently generated ASR text
- **AND** the no-polishing transcript is retained as a baseline
- **AND** scoring separately measures numeric, date, name, negation, self-correction, omission, unintended addition, and meaning-preservation errors
- **AND** transport success and keyword retention are not substituted for meaning preservation

#### Scenario: Spelling correction is evaluated
- **WHEN** a candidate changes only selected homophone positions or returns edited full text
- **THEN** the report distinguishes those methods and measures false corrections, missed corrections, protected literal changes, and unauthorized edits outside allowed positions
- **AND** correct cooking uses of `下麵`, literal strings, and ambiguous context remain explicit counterexamples

### Requirement: Cross-version conclusions require a paired environment matrix
The evaluation protocol SHALL compare fixed macOS 26, macOS 26.4, and macOS 27 runtime builds with the observed native system models, plus a fixed-digest local Ollama model and no-polishing baseline. macOS 26 and 26.4 are research baselines and SHALL NOT become supported targets for the new macOS product. Reports MUST disclose unavailable combinations and SHALL NOT claim that macOS 27 can select an older system model through the public API.

#### Scenario: Cross-version run is prepared
- **WHEN** the evaluation matrix is recorded before results are collected
- **THEN** it fixes source commit, application and helper hashes, audio and text hashes, prompt, sampling mode, output budget, locale, and execution order policy
- **AND** it records full OS build, hardware, RAM, available system-model variant and context capabilities, asset readiness, and Ollama version, digest, quantization, and context configuration
- **AND** it uses the same hardware where both OS builds are supported or explicitly reports hardware as a confounding variable

#### Scenario: Earlier OS lacks a measurement API
- **WHEN** an older runtime cannot expose variant, token counting, context metadata, or another measured capability through its supported public APIs
- **THEN** the corresponding field or test combination is marked unavailable with its reason
- **AND** the harness does not fabricate metadata, use an unguarded newer API, or treat the missing combination as a passing comparison

#### Scenario: macOS 27-specific integration is tested
- **WHEN** a test uses `fm` CLI or another macOS 27-only facility
- **THEN** it is labeled a separate diagnostic experiment
- **AND** native common-API comparisons are not replaced by a comparison of different transport paths

#### Scenario: Model or asset version changes
- **WHEN** an OS update or observed system-model change alters an evaluated configuration
- **THEN** the fixed corpus and acceptance protocol are rerun for that configuration
- **AND** previous scores are not presented as proof for the new model or attributed solely to the framework or OS name

### Requirement: Performance reports distinguish pipeline stages and observable resources
The evaluation SHALL separate first-use and warmed requests, preparation, inference, recognition finalization, and complete product output. It SHALL predeclare warm-up exclusions, alternate or counterbalance configuration order, retain failures in the outcome denominator, and collect at least 30 valid paired trials before presenting stable P50 or P95 comparisons. Smaller samples SHALL be labeled exploratory with their actual values and counts.

#### Scenario: Latency comparison is published
- **WHEN** latency results are summarized
- **THEN** ASR preparation, first text, audio-end-to-final, polishing completion, and stop-to-paste-command acknowledgement are reported under distinct definitions
- **AND** actual target-field receipt is separately verified by bounded read-back
- **AND** file-submit-to-final and paste-command acknowledgement are not called microphone-stop-to-received-text latency

#### Scenario: Resource comparison is published
- **WHEN** memory, CPU, GPU, ANE, or energy results are summarized
- **THEN** application-owned processes and shared model services are separately identified with measurement units and sampling boundaries
- **AND** inaccessible services, driver allocations, cache state, background load, and hardware differences are disclosed
- **AND** CPU time, footprint, or ANE activity counts are not described as power consumption, battery life, or ANE utilization without direct measurements

#### Scenario: End-to-end product gate is executed
- **WHEN** the installed macOS application is accepted for the Apple polishing workflow
- **THEN** tests cover physical microphone input, disabled and enabled polishing, real target-app receipt, cancellation, repeated stop, unavailable model, and owned helper failure
- **AND** the report retains the separate raw ASR and final text outcomes
- **AND** successful helper requests or software audio fixtures alone do not satisfy this product gate

### Requirement: Known semantic reversal blocks automatic enablement
Polishing SHALL remain disabled by default and MUST NOT be automatically enabled by installation, upgrade, a successful capability probe, or benchmark transport success. Before any later change proposes automatic enablement or an unqualified quality-improvement claim, a versioned quality gate MUST declare its corpus, scoring rules, acceptance thresholds, and regression cases before inspecting held-out results. The gate SHALL require zero observed critical meaning reversals in the acceptance set and SHALL retain any critical failure as a blocker rather than average it away.

#### Scenario: Existing monetary self-correction regression is tested
- **WHEN** the input is `這個費用是三萬不是不是是三千五百元我們不要上線等測試通過再說`
- **THEN** a passing meaning-preservation judgment requires the corrected amount to remain 3500 and preserves the instruction not to launch before tests pass
- **AND** output affirming 30000 while denying 3500 is a critical failure even when the API request succeeds

#### Scenario: A held-out critical error is observed
- **WHEN** any acceptance output reverses a material amount, negation, correction, or condition
- **THEN** the quality gate remains failed and the report identifies that failure
- **AND** aggregate CER, average preference, speed, or lower resource use cannot override the blocker for automatic enablement

#### Scenario: User explicitly chooses optional polishing
- **WHEN** a user explicitly selects an available Apple provider and enables optional polishing
- **THEN** the existing opt-in polishing workflow remains available with its technical response and visible failure contracts
- **AND** this action does not certify model semantics or change the disabled default for other installations

#### Scenario: Evaluation is incomplete
- **WHEN** macOS 26 or 26.4 runtime data, paired Ollama results, held-out quality, offline checks, or end-to-end receipt evidence is missing
- **THEN** the report marks the affected conclusions unverified
- **AND** it does not claim macOS 27 is more accurate, faster, more private, or a validated replacement on the basis of API availability alone
