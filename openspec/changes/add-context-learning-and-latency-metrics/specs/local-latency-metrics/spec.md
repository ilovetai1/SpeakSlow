## ADDED Requirements

### Requirement: Local metrics are enabled by default and remain user-controlled
The system SHALL provide content-free local latency metrics enabled by default. The user SHALL be able to disable collection, clear retained metrics, and export retained metrics. Collection, retention, and export MUST remain local and MUST NOT post metrics to a network endpoint. Metrics controls SHALL be independent of recording, polishing, context reading, correction learning, automatic paste, and automatic Enter settings.

#### Scenario: An existing installation has no metrics setting
- **WHEN** the application starts without a saved latency-metrics setting
- **THEN** local collection is enabled without a database migration
- **AND** collection does not enable context reading or correction learning

#### Scenario: The user disables collection
- **WHEN** the user disables local latency metrics
- **THEN** metrics observers, timers, listeners, and active collectors are detached or disposed
- **AND** subsequent recording operations do not create metrics observations or records
- **AND** existing retained metrics remain available for explicit clearing or export
- **AND** recording and output continue under their existing settings

#### Scenario: Collection is disabled during a session
- **WHEN** the user disables metrics while a collector is active
- **THEN** the uncommitted collector is discarded and late callbacks cannot recreate it
- **AND** disabling measurement does not cancel the recording or label the recording as cancelled

### Requirement: Metric payloads use a strict content-free allowlist
Every stored, displayed, logged, or exported metric payload MUST contain only randomly generated opaque session identifiers, finite non-negative durations or null, fixed enums for stage, outcome, mode, provider and cold-or-warm classification, and explicitly defined non-negative integer counts. Session identifiers MUST NOT be derived from text, an application identifier, a window, a URL, a model name, a device identity, or a persistent user identity. The system MUST NOT retain transcript or prompt text, audio or audio paths, application names or bundle identifiers, window titles or field identifiers, URLs, custom provider or model values, arbitrary error messages, or raw clock readings in metric payloads. Unknown inputs SHALL map to a fixed unknown classification rather than become new labels.

#### Scenario: An event includes content or arbitrary metadata
- **WHEN** a metrics event includes transcript text, audio, a window title, a URL, a custom model name, or an arbitrary error message
- **THEN** the collector validates the event against the allowlist and rejects or removes those fields before any retention or export
- **AND** no diagnostic log reproduces the rejected values

#### Scenario: A user selects a custom remote provider or model
- **WHEN** a measured operation uses a user-configured provider endpoint or model
- **THEN** metrics classify the provider with a fixed provider enum, such as `openai_compatible`
- **AND** metrics do not store the endpoint, model value, or a hash derived from either

#### Scenario: A metric outcome is unknown
- **WHEN** an outcome, recording mode, provider, or cold-or-warm state cannot be established from observed execution
- **THEN** the record uses its fixed unknown or missing classification
- **AND** it does not infer a successful or warm state from the absence of an error

### Requirement: Retention is bounded independently of transcript history
The metrics store SHALL retain a ring of no more than 1,000 sessions and SHALL evict every session older than seven days, whichever limit removes a session first. Expiration SHALL be enforced on startup, collection, statistics reads, and export. Any local expiration bookkeeping needed for this limit MUST remain outside metric payloads and MUST NOT become a statistics dimension, diagnostic sample, or export field. Metrics MUST NOT be written into transcript history rows or audio-retention records.

#### Scenario: Session capacity is exceeded
- **WHEN** a new session would increase retained sessions above 1,000
- **THEN** the oldest retained sessions are removed until the store contains no more than 1,000 sessions
- **AND** transcript history and saved audio are unchanged

#### Scenario: The application restarts after the retention window
- **WHEN** startup or an explicit statistics or export request finds sessions older than seven days
- **THEN** those sessions are evicted before they contribute to statistics or export

### Requirement: Clearing and exporting preserve the allowlist
The system SHALL clear the metrics store and invalidate all active metrics collectors when the user requests clearing, so late observations cannot restore cleared data. Export SHALL produce a user-requested local artifact from the bounded store using the same allowlist as collection. Clearing or exporting metrics MUST NOT clear, export, or alter transcript text, recordings, learned corrections, or provider credentials. Export and storage failures SHALL be visibly reported with fixed user-facing messages without storing arbitrary error text in metrics.

#### Scenario: A session finishes after the user clears metrics
- **WHEN** the user clears metrics while an observed session is still running
- **THEN** the retained metrics and active collectors are cleared
- **AND** a later callback from that session cannot repopulate the cleared store
- **AND** a new session may collect metrics if collection remains enabled

#### Scenario: The user exports retained metrics
- **WHEN** the user requests an export
- **THEN** the system exports only retained allowlisted metrics into a local artifact
- **AND** the exported data contains no transcript, audio, application or window identity, URL, custom model value, arbitrary error message, or raw clock origin
- **AND** no network upload occurs

#### Scenario: Export cannot be written
- **WHEN** the local export operation fails
- **THEN** the system visibly reports that the export failed
- **AND** it does not report an artifact as successfully saved or include the raw failure message in a metric record

### Requirement: Each process computes durations from its own monotonic clock
Each measured span MUST use start and end observations from the same process and the same monotonic clock. Cross-process messages SHALL carry an opaque correlation identifier and already-computed durations or fixed status values; they MUST NOT carry clock origins for subtraction in another process. Correlation identifiers SHALL associate measurements only and MUST NOT introduce a general cancellation state machine or change existing output behavior.

#### Scenario: Renderer and main process clocks have different origins
- **WHEN** a renderer operation requires main-process work
- **THEN** each process computes its own span locally
- **AND** any reported main-process duration is used as a duration rather than subtracted from a renderer timestamp
- **AND** changing the relative clock origins does not change the measured durations

#### Scenario: The system wall clock changes during an operation
- **WHEN** the wall clock moves forward or backward while an operation is active
- **THEN** the operation duration remains based on its process-local monotonic clock
- **AND** a missing or invalid duration is not replaced with wall-clock subtraction

### Requirement: Stage metrics describe observable pipeline boundaries
The renderer SHALL measure fixed stages for `capture`, `asr`, `polish`, `history_save`, `paste_command`, and `context`. Capture SHALL span accepted recording preparation through microphone and capture setup readiness. ASR, polishing, history save, and paste-command spans SHALL run from their renderer invocation through the corresponding returned result or observed terminal failure and SHALL explicitly include IPC and waiting time when their operations cross processes. Context SHALL span the bounded context request through its result or terminal status. A cold-or-warm enum SHALL use observed startup or model-load evidence from normal execution; absent evidence SHALL remain unknown, and measurement MUST NOT add discovery or network requests solely to assign that enum.

#### Scenario: A recording completes with local polishing
- **WHEN** a recording proceeds through capture setup, ASR, polishing, history save, and configured paste-command output
- **THEN** the collector records those observed stages with durations computed in the renderer
- **AND** the ASR and polishing labels describe elapsed request time including IPC rather than claiming pure model-inference time
- **AND** no custom model identifier is added to the record

#### Scenario: Context reading is disabled or unsupported
- **WHEN** context reading is disabled or returns an explicit unsupported status
- **THEN** the context stage is classified as skipped rather than successful with zero duration
- **AND** it does not affect the existing transcript output contract

#### Scenario: A warm state has no supporting observation
- **WHEN** a provider responds but the application has no observed evidence that its server or model was already ready before this request
- **THEN** the cold-or-warm classification remains unknown
- **AND** the collector does not issue an additional readiness or model query

### Requirement: Hotkey readiness timing includes the acknowledgement path
The main process SHALL measure `hotkey_to_capture_ready` from receiving a recording hotkey to receiving the renderer's capture-ready acknowledgement for that session. Both endpoints MUST use the main process's monotonic clock. This metric SHALL explicitly include hotkey dispatch, IPC transit, renderer scheduling, capture initialization, and acknowledgement transit; it MUST NOT be presented as microphone initialization alone.

#### Scenario: A recording hotkey starts capture
- **WHEN** the main process receives a hotkey and subsequently receives the matching capture-ready acknowledgement
- **THEN** it records the elapsed main-process duration for that session
- **AND** the statistics explanation states that the duration includes communication between processes

#### Scenario: Capture acknowledgement never arrives
- **WHEN** a session has no matching capture-ready acknowledgement
- **THEN** the metric has a null duration and a missing, failed, or cancelled outcome justified by the observed terminal state
- **AND** the collector does not manufacture a zero duration or correlate the next session's acknowledgement

### Requirement: End-to-end timing stops at paste-command acknowledgement
The renderer SHALL measure `stop_to_paste_command_ack` from accepting stop-recording for a session to receiving the corresponding paste-command acknowledgement, using the renderer's monotonic clock for both endpoints. This duration SHALL include the intervening observed processing, saving, IPC, and configured output-command waiting. The result MUST be described as paste-command dispatch completion and MUST NOT claim that the target application or input field received or accepted text. Version 2.1.0 MUST NOT add general receipt verification, replace the paste or Enter transaction, or introduce cancellation beyond the existing behavior to obtain this metric.

#### Scenario: The paste command is acknowledged
- **WHEN** a stopped recording reaches the existing successful paste-command acknowledgement
- **THEN** the renderer records the end-to-end elapsed duration for that session
- **AND** the panel states that this boundary measures the command and does not verify target-field receipt

#### Scenario: Automatic paste is disabled
- **WHEN** automatic paste is disabled for the completed recording
- **THEN** the paste-command and stop-to-paste-command-ack stages are skipped with null durations
- **AND** displayed and saved text follow the existing output settings

#### Scenario: No successful paste-command acknowledgement is observed
- **WHEN** output fails, an existing cancellation terminates the session, or the acknowledgement is missing
- **THEN** the end-to-end metric does not claim a successful acknowledgement duration
- **AND** it retains the appropriate failed, cancelled, or missing outcome and a null duration when the required endpoint was not observed

### Requirement: Partial, failed, cancelled, skipped and missing observations remain distinct
The collector SHALL use distinct fixed outcomes `success`, `failed`, `cancelled`, `skipped`, and `missing`. A failed operation is attempted work with an observed failure; cancelled work requires an existing observed cancellation; skipped work is intentionally not attempted; missing work lacks the required observation. Missing measurements SHALL use null and their explicit status, never a fabricated zero. A partial session SHALL preserve observed stage results without inventing later stages. Repeated events or acknowledgements SHALL be idempotent per session and stage and SHALL NOT inflate counts or produce a second sample.

#### Scenario: ASR fails before polishing and output
- **WHEN** the ASR request fails after capture readiness was observed
- **THEN** the session preserves the capture sample and classifies ASR as failed
- **AND** deliberately unattempted downstream stages are skipped
- **AND** required endpoints that were not observed have null durations

#### Scenario: Existing recording cancellation occurs
- **WHEN** an existing recording-cancellation event terminates a measured session
- **THEN** the session uses cancelled where cancellation is observed and preserves already completed measurements
- **AND** it does not label the cancellation as a provider failure or create new cancellation behavior

#### Scenario: A callback or acknowledgement is duplicated
- **WHEN** the same terminal event or acknowledgement arrives more than once for a session and stage
- **THEN** only the first accepted terminal observation contributes a sample or outcome count

### Requirement: Percentiles use successful finite samples and report uncertainty
For each displayed fixed-stage, mode, provider, and cold-or-warm group, the system SHALL calculate P50 and P95 with the nearest-rank method over successful finite non-negative durations only: after ascending sort of `n` durations, percentile `p` is the one-based value at `ceil(p * n)`. The panel and export SHALL report eligible sample count `n`, distinct failed, cancelled, skipped and missing counts, and the number of unknown-classification samples excluded from any named comparison group. Null, invalid, failed, cancelled, skipped, or missing durations MUST NOT contribute to successful percentiles. Empty groups SHALL show no percentile instead of zero. Any group with fewer than 30 eligible samples SHALL display an insufficient-samples notice and MUST NOT support a superiority or speed-improvement claim.

#### Scenario: A group contains mixed outcomes and missing durations
- **WHEN** a stage group contains successful finite durations, failures, cancellations, skipped work, and missing measurements
- **THEN** P50 and P95 use only successful finite durations
- **AND** the panel reports `n` and each excluded outcome count separately
- **AND** unknown classifications are not silently counted as a known provider or warm group

#### Scenario: Nearest-rank percentiles are calculated
- **WHEN** a sorted eligible group contains 30 durations
- **THEN** P50 is the 15th value and P95 is the 29th value
- **AND** the calculation does not average adjacent ranks

#### Scenario: A comparison group is too small
- **WHEN** a group contains fewer than 30 eligible durations
- **THEN** the panel displays `樣本不足，暫不比較`
- **AND** it does not label a mode, provider, or cold-or-warm group as faster or superior

### Requirement: The statistics panel explains measurements in human terms
The system SHALL present a readable Traditional Chinese statistics panel with concrete stage labels such as `錄音準備`, `語音辨識`, `AI 潤稿`, `讀取文字情境`, `儲存歷史`, `貼上命令`, `快捷鍵至錄音就緒`, and `停止錄音至貼上命令完成`. It SHALL show sample counts, failed or unavailable observations, and clear collection, clearing, and export controls. User-facing explanations SHALL state the IPC-inclusive and command-only boundaries where relevant without exposing protocol identifiers, clock origins, raw traces, or engineering detail as product workflow steps.

#### Scenario: The user inspects output latency
- **WHEN** the user opens the statistics panel
- **THEN** stages, P50, P95, eligible counts, and failure or missing counts are readable using concrete Chinese labels
- **AND** the output metric explains `貼上命令完成不表示目標欄位已接收文字`
- **AND** insufficient samples and unknown classifications remain visible

### Requirement: Instrumentation overhead is measured before a release claim
Before release acceptance, the team MUST run at least 30 valid paired observations of the same fixture on the same physical target device with metrics on and off, preserve the off baseline and both raw duration sets in a content-free benchmark result, and report exclusions and order controls. The instrumentation-overhead release budget SHALL be P95 of paired non-negative overhead, `max(0, on_duration - off_duration)`, no greater than `max(10 ms, off_P95 * 0.02)` using nearest-rank percentiles. This is an engineering acceptance budget, not a measured result or a speed promise. Any new context-reader overhead SHALL be measured and reported separately, using paired context-off and context-on observations with the metrics setting held constant, rather than attributed to instrumentation.

#### Scenario: Instrumentation overhead is assessed
- **WHEN** at least 30 valid on/off fixture pairs have been measured on the physical acceptance target
- **THEN** the benchmark records off P95, paired overhead P95, sample counts, exclusions, execution order, and the engineering budget
- **AND** release acceptance requires paired overhead P95 to be within that budget
- **AND** missing or failed pairs do not become zero-cost pairs and do not reduce the required 30 valid pairs

#### Scenario: Measurement has not yet been performed
- **WHEN** the work remains a version 2.1.0 plan or has no completed physical-device benchmark
- **THEN** the report marks baseline and overhead results as not measured
- **AND** it makes no speed-improvement, threshold-compliance, or device-acceptance claim

#### Scenario: Context adds processing time
- **WHEN** context-on and context-off results differ under the same metrics setting
- **THEN** that difference is reported separately as context overhead
- **AND** it is not mixed into the instrumentation-overhead pass or fail decision

### Requirement: Baseline evaluation stays within version 2.1.0 scope
The latency baseline SHALL use a documented corpus of 28 to 40 controlled utterance cases covering short and long speech, Traditional Chinese and English mixtures, numbers, names, and spoken self-corrections. Repeated cases MAY provide the required paired sample counts, but the report SHALL distinguish corpus-case counts from valid observation counts. Metric payloads produced by fixtures and metric records in result artifacts MUST follow the content-free allowlist; synthetic corpus inputs are separate test material and MUST NOT be copied into those payloads. The corpus and measurement work MUST NOT change production audio retention, substitute providers or models, rewrite capture with AudioWorklet, or expand paste receipt verification or general cancellation scope.

#### Scenario: The corpus is prepared for baseline evaluation
- **WHEN** the baseline corpus is defined
- **THEN** it contains 28 to 40 controlled utterance cases with the required speech categories
- **AND** measurements associate results through opaque case or session identifiers and counts without exporting the utterance text or audio as metrics
- **AND** execution uses the existing configured provider, model, capture, output, and retention contracts

### Requirement: Automated validation uses isolated clocks and side effects
Automated metrics tests MUST inject fake process-local monotonic clocks and isolated stores. They SHALL cover distinct clock origins, partial sessions, existing cancellation, skipped and missing stages, duplicate events, allowlisted export, bounded retention, clearing with late callbacks, and disabling with no remaining observers. They MUST assert that metrics collection and export issue no network posts and MUST NOT operate the real user store, clipboard, hotkey monitor, audio capture, or provider runtime.

#### Scenario: A deterministic partial-session test runs
- **WHEN** a fixture advances independently offset fake main and renderer clocks and terminates before all stages complete
- **THEN** locally computed durations remain correct and unobserved stages remain null with explicit outcomes
- **AND** duplicate or late callbacks cannot fabricate samples or repopulate a cleared store

#### Scenario: A disabled-collection test runs
- **WHEN** a fixture disables metrics and then exercises the existing recording workflow
- **THEN** no metrics observer, timer, listener, collector, persisted sample, or network post remains active
- **AND** the fixture verifies the same recording and output behavior using isolated mocks
