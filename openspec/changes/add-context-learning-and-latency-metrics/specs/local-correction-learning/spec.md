## ADDED Requirements

### Requirement: Explicit opt-in for bounded local correction observation
Passive correction learning SHALL be disabled by default and SHALL require a separate explicit user opt-in. Enabling it SHALL NOT enable raw text context for polishing, alter the existing paste or Enter result, execute input actions, or authorize cloud learning. The feature SHALL observe only the current dictation's proven inserted span in an allowed macOS editable field. It SHALL NOT scan unrelated fields or observe ongoing general typing.

#### Scenario: Passive learning remains off by default
- **WHEN** the user has not enabled passive correction learning
- **THEN** the feature SHALL NOT take learning snapshots, start polling external fields, or generate passive learning candidates

#### Scenario: Learning is enabled without context-aware polishing
- **WHEN** the user enables passive correction learning while raw polishing context remains disabled
- **THEN** the feature SHALL use its own bounded local observation only and SHALL NOT append external text to a polishing request

### Requirement: Bounded pre-insertion evidence and post-command span proof
Before the existing paste operation, the feature SHALL capture the current native field identity, reliable insertion range, and bounded neighboring anchors. After the existing paste command completes, it SHALL take a separate read-only snapshot and prove the current dictation's uniquely located inserted span in the same field before starting observation. These snapshots SHALL each have a 250 ms deadline. The observation span SHALL be at most 500 Unicode code points with at most 50 code points of anchor text on each side. Excessive span length, an unavailable reliable range, ambiguous or multiple matches, changed identity, missing App identity, and unsupported interfaces SHALL produce typed unsupported results and SHALL NOT start learning. The read-back outcome SHALL determine learning eligibility only; it SHALL NOT redefine paste success, suppress or send Enter, retry paste, or move focus.

#### Scenario: A uniquely located insertion starts observation
- **WHEN** pre-insertion range and anchors are available and the post-command snapshot proves one matching inserted span of at most 500 code points in the same native field
- **THEN** the feature SHALL observe that span using no more than 50 code points of anchor text on each side

#### Scenario: Evidence is ambiguous or too large
- **WHEN** the inserted result exceeds the span limit, has multiple possible matches, or lacks a reliable pre-insertion range
- **THEN** the feature SHALL return a typed unsupported status and SHALL NOT scan the full field or start observation

#### Scenario: Read-back cannot prove insertion
- **WHEN** read-back times out, finds a different field, or cannot prove the inserted span
- **THEN** the feature SHALL skip learning and SHALL leave the existing paste result and Enter behavior unchanged

### Requirement: Short-lived non-overlapping observation
Observation SHALL last no more than 15 seconds from successful span proof, using a monotonic clock. Polling SHALL use a 250 ms cadence, SHALL have no overlapping snapshot requests, and SHALL skip or back off a poll rather than queue overdue reads. Each snapshot SHALL retain the 250 ms deadline and the bounded span-and-anchor limits. The feature SHALL stop and release observation text when the native field identity changes, a new recording begins, the setting is disabled, the App becomes denied, the field becomes secure or non-editable, reliable span localization is lost, or the observation deadline expires. An edit SHALL NOT extend the overall 15-second limit.

#### Scenario: A slow poll does not create concurrent reads
- **WHEN** a previous learning snapshot request is still active at the next cadence boundary
- **THEN** the feature SHALL skip or back off that poll and SHALL NOT issue an overlapping snapshot request

#### Scenario: Focus changes or another recording begins
- **WHEN** the target native field identity changes or a new recording starts
- **THEN** the feature SHALL stop the previous observation and release its bounded text without observing the new field

#### Scenario: An edit occurs near the observation deadline
- **WHEN** an edit is detected near the end of the 15-second observation window
- **THEN** the feature SHALL NOT extend that window beyond 15 seconds

### Requirement: Deterministic small word-replacement candidates
The feature SHALL use deterministic local difference analysis without an AI or network request. A candidate SHALL represent exactly one contiguous word replacement entirely inside the proven current insertion span. Both the original and replacement SHALL contain 2 to 40 Unicode code points. Changes to digits or dates, line or paragraph boundaries, multiple replacement regions, large rewrites, edits outside the span, cleared fields, and uncertain localization SHALL NOT produce candidates. The system SHALL NOT infer a replacement that the user did not make.

#### Scenario: A small in-span word correction yields a candidate
- **WHEN** the user changes one contiguous 2-to-40-code-point word to another eligible word inside the proven insertion span
- **THEN** the feature SHALL propose that observed original-to-replacement pair without applying it to future transcriptions

#### Scenario: The user rewrites or changes a number
- **WHEN** the observed change affects a digit or date, changes a paragraph boundary, contains multiple replacement regions, or is a large rewrite
- **THEN** the feature SHALL produce no learning candidate from that change

#### Scenario: Other text in the same field changes
- **WHEN** the change occurs outside the proven insertion span or span localization becomes uncertain
- **THEN** the feature SHALL produce no candidate and SHALL NOT expand observation to the entire field

### Requirement: Local bounded candidate queue with visible decisions
Candidates SHALL enter a local `pending` queue and SHALL require an explicit `approve` decision before affecting dictionary output. The interface SHALL provide `approve`, `dismiss`, and `undo` actions with visible result or error states. The pending queue SHALL contain at most 100 records and SHALL retain records for no longer than 14 days. Before adding a new record, the system SHALL prune expired records and coalesce equivalent pending pairs with the same observed App scope. If the queue is still full, it SHALL report the capacity status without silently approving a rule. Successful approval or dismissal SHALL remove the record from the pending queue; dismissal SHALL NOT write a dictionary rule. Approved rules and their required undo records SHALL be persisted separately from the pending queue. Candidate persistence SHALL contain only the eligible word pair, decision state, observation count, timestamps, App scope identifier, and decision identifiers needed for this capability; it SHALL NOT contain full-field or neighboring text.

#### Scenario: A pending candidate has no output effect
- **WHEN** a candidate is generated but has not been approved
- **THEN** it SHALL remain `pending` and SHALL NOT change dictionary entries or subsequent transcription output

#### Scenario: The user dismisses a candidate
- **WHEN** the user selects `dismiss`
- **THEN** the interface SHALL report dismissal and the system SHALL remove the pending record without creating or modifying a dictionary rule

#### Scenario: The queue remains full after pruning
- **WHEN** 100 unexpired pending records remain after expiry pruning and duplicate coalescing
- **THEN** the system SHALL report that it cannot add another candidate and SHALL NOT exceed the cap or silently approve the new pair

#### Scenario: A candidate reaches the retention limit
- **WHEN** a queued candidate record reaches 14 days of age
- **THEN** the system SHALL remove it from the pending queue without removing an already approved active rule or its required undo record

### Requirement: App-scoped approval with an explicit global choice
Approval SHALL default to the App in which the correction was observed, identified by its captured bundle identifier. The interface SHALL identify that scope and SHALL allow the user to explicitly choose a global rule. App-scoped approval SHALL require a valid bundle identifier and SHALL NOT silently create a global rule when it is unavailable. Only approved rules SHALL participate in dictionary replacement.

#### Scenario: Approval uses the observed App scope
- **WHEN** the user approves a pending candidate with a valid observed App bundle identifier and does not change the displayed scope
- **THEN** the system SHALL create an approved rule restricted to that App

#### Scenario: The user explicitly selects global scope
- **WHEN** the user selects the global option and approves the candidate
- **THEN** the system SHALL create a global rule and SHALL clearly report that future matching transcriptions can use it across Apps

#### Scenario: App scope cannot be established
- **WHEN** the user attempts App-scoped approval without a valid bundle identifier
- **THEN** approval SHALL fail with a visible scope-unavailable result and SHALL NOT create a global rule as a substitute

### Requirement: Complete scoped rules in versioned settings without schema migration
Approved App-scoped rules SHALL be stored as complete rules in the versioned settings JSON `scoped_dictionary_rules_v1`. Each rule SHALL contain `id`, `original`, `replacement`, `enabled`, `scope` with `kind: app` and a valid `bundleId`, `revision`, and `source`. App-scoped approval SHALL NOT create a row in the legacy dictionary table. Explicitly global approval SHALL reuse existing legacy dictionary CRUD. Pending candidates and approved-rule undo records SHALL use separate versioned settings data. The implementation SHALL NOT introduce a new database table, history schema change, database migration, or reserved classification marker in legacy dictionary categories. An older application that ignores the scoped JSON setting SHALL therefore have no legacy global row representing an App-scoped rule.

#### Scenario: App approval stores a complete isolated rule
- **WHEN** the user approves a candidate for its observed App
- **THEN** the system SHALL create or update a complete App-scoped rule in `scoped_dictionary_rules_v1` without creating a legacy dictionary row

#### Scenario: Global approval reuses the legacy store
- **WHEN** the user explicitly selects global scope and approves the candidate
- **THEN** the system SHALL use existing legacy dictionary CRUD and SHALL NOT store that rule as an App-scoped rule

#### Scenario: An older application ignores the new scoped store
- **WHEN** an older application uses the legacy dictionary table and does not interpret `scoped_dictionary_rules_v1`
- **THEN** approved App-scoped rules SHALL NOT appear as global legacy entries in that application

### Requirement: Atomic candidate, rule, and undo changes
For App-scoped approval or undo, the system SHALL update the pending candidate, complete JSON rule, and required undo record in one SQLite transaction. For global approval or undo, it SHALL update the pending candidate, legacy dictionary CRUD result, and approved-version undo metadata in one SQLite transaction. Relevant rule edits or deletion through the combined dictionary interface SHALL maintain rule and undo state atomically. A transaction failure SHALL leave every affected source at its previous state. Active approved rules and their required undo data SHALL remain available independently of pending-queue expiry.

#### Scenario: Approval persists its decision and rule together
- **WHEN** App-scoped or global approval succeeds
- **THEN** one SQLite transaction SHALL persist the rule in its correct source, remove its pending candidate, and persist the undo evidence

#### Scenario: A settings write fails during approval
- **WHEN** approval cannot persist a JSON rule, candidate decision, or undo record
- **THEN** the transaction SHALL roll back all affected rule and settings changes and SHALL report the failure

#### Scenario: An active rule outlives pending-candidate retention
- **WHEN** the pending queue is pruned by its 14-day retention policy
- **THEN** the system SHALL preserve active approved App rules, global rules, and their separately stored required undo evidence

### Requirement: Scope-aware dictionary filtering preserves legacy global entries
Dictionary replacement SHALL accept an optional trusted App bundle identifier from an App-context snapshot obtained after ASR when dictionary replacement is performed. It SHALL freeze that word-scope choice for the current transcription and SHALL expose the selected App or global-only context in the interface. It SHALL combine enabled legacy global entries with enabled matching rules from `scoped_dictionary_rules_v1`. A later focus change during AI processing SHALL NOT trigger another dictionary pass, a different rule selection, AI reprocessing, focus restoration, or output rerouting. The App snapshot SHALL identify the word scope for that replacement operation; it SHALL NOT represent a locked output destination. The system SHALL retain the existing current-cursor output behavior.

The system SHALL resolve scope conflicts before replacing text: a matching App rule SHALL shadow global rules with the same original term under the existing matching semantics, and selected rules SHALL be processed longest-original-first. The system SHALL NOT implement App precedence by passing App-replacement output through a second global substitution pass, and replacement text generated by an App rule SHALL NOT be reprocessed as source text by a global rule. App-scoped rules SHALL NOT be selected for a different App snapshot or when its bundle identifier is unavailable. Missing App identity or an invalid scoped store SHALL produce a visible typed status, skip scoped rules, and preserve the existing global dictionary behavior. Every legacy dictionary row SHALL remain global without requiring new metadata. A missing or invalid scoped store SHALL NOT convert any scoped rule into a legacy global rule.

#### Scenario: A new transcription selects another App snapshot
- **WHEN** a rule is scoped to App A and a new transcription's dictionary-replacement snapshot identifies App B
- **THEN** the system SHALL exclude App A's rule while retaining eligible global entries and matching App B rules

#### Scenario: Focus changes after the current transcription selected its scope
- **WHEN** the current transcription has applied App A's dictionary rules and focus moves to App B while AI processing is pending
- **THEN** the system SHALL retain that transcription's frozen App A word scope, display App A as its dictionary context, and use existing current-cursor output without restoring focus or re-running dictionary replacement or AI processing

#### Scenario: The target bundle identifier is unavailable
- **WHEN** dictionary application has no trusted target bundle identifier
- **THEN** it SHALL report the missing target identity, apply eligible global entries, and SHALL exclude App-scoped rules

#### Scenario: An existing dictionary row requires no scoped metadata
- **WHEN** the user uses a legacy dictionary entry created before this capability
- **THEN** that entry SHALL remain global and SHALL preserve its existing replacement behavior

#### Scenario: An App rule shadows the same global term
- **WHEN** a matching enabled App rule and a legacy global rule have the same original term but different replacements
- **THEN** the system SHALL select the App replacement and SHALL NOT apply the shadowed global rule as a second substitution

#### Scenario: An App replacement happens to match a global original
- **WHEN** an App rule's replacement text matches a different global rule's original term
- **THEN** that generated App replacement SHALL remain unchanged by the global rule rather than undergoing chained substitution

#### Scenario: Scoped settings data is invalid
- **WHEN** `scoped_dictionary_rules_v1` has an unsupported version or invalid rule structure or scope
- **THEN** the system SHALL report the invalid-store status, skip scoped replacement, and SHALL NOT import or apply those rules as global entries

### Requirement: Undo rejects concurrent changes rather than overwriting them
For an App-scoped rule, undo SHALL compare the current complete JSON rule's revision and values with the approved version. For a global rule, undo SHALL compare the current legacy row and its approved-version undo metadata with the approved version. If they still match, undo SHALL atomically remove a newly created rule or restore its previous state in the correct source. If the rule, revision, or required approval metadata has changed or disappeared, undo SHALL return a visible conflict and SHALL NOT overwrite, delete, or restore newer edits. The system SHALL NOT treat an undo conflict as a successful undo.

#### Scenario: An unchanged approval can be undone
- **WHEN** the user selects `undo` and the current rule values and its revision or approved-version metadata still match the approved version
- **THEN** the system SHALL atomically restore the approval's previous rule state or remove the rule created by that approval

#### Scenario: Another edit has changed the rule
- **WHEN** the scoped rule revision or values, or the global row and approval metadata, no longer match the approved version
- **THEN** undo SHALL report a conflict and SHALL leave the current rule and metadata unchanged

### Requirement: Combined rule management preserves scope in import and export
The dictionary interface SHALL present both legacy global rows and App-scoped JSON rules with explicit source and scope, and SHALL route edit, enable, disable, delete, and undo actions to the correct source. Existing categories SHALL remain display classifications without reserved persistence markers. The new versioned JSON export SHALL contain complete scoped rules, including their App scopes, in addition to the supported global dictionary data. Legacy CSV export SHALL contain only legacy global rows and SHALL explicitly inform the user that App-scoped rules are excluded. Importing an existing legacy CSV SHALL retain its global semantics. A scoped JSON import SHALL validate its version and complete rule scopes and SHALL NOT import an invalid or missing App scope as global.

#### Scenario: The interface shows both rule sources
- **WHEN** the dictionary manager displays approved rules
- **THEN** it SHALL distinguish global legacy rows from App-scoped JSON rules and SHALL send changes to the displayed rule's correct source

#### Scenario: Scoped rules are exported in the new JSON format
- **WHEN** the user exports the new versioned dictionary JSON
- **THEN** the export SHALL include complete App-scoped rules with their bundle identifiers and SHALL preserve their App scope

#### Scenario: Legacy CSV excludes scoped rules explicitly
- **WHEN** the user selects legacy CSV export
- **THEN** the export SHALL contain only legacy global rows and the interface SHALL report that App-scoped rules are excluded

#### Scenario: An existing CSV is imported
- **WHEN** the user imports a legacy dictionary CSV
- **THEN** its valid entries SHALL remain global and SHALL NOT acquire inferred App scopes

#### Scenario: A scoped JSON import has an invalid scope
- **WHEN** an imported scoped rule lacks a valid `kind: app` scope and bundle identifier
- **THEN** import SHALL report the invalid rule and SHALL NOT create a global legacy substitute

### Requirement: Learning controls do not disable approved dictionary rules
The passive-learning setting SHALL control observation and candidate generation only. Disabling passive learning SHALL stop any active observation without deleting or disabling already approved App-scoped or global rules. Approved rules SHALL remain subject to their own explicit enable, disable, edit, delete, and undo controls.

#### Scenario: Learning is disabled after approval
- **WHEN** the user disables passive learning after approving a rule
- **THEN** new passive observation SHALL stop and the approved rule SHALL remain available under its existing scope and enabled state

### Requirement: Learning data stays local and existing manual correction remains global
Observation snapshots SHALL remain ephemeral within the main process and the read-only helper. They SHALL NOT be exposed to the renderer, stored in history, written to ordinary logs, exported as diagnostics, or included in latency metrics. Only the eligible candidate word pair and its minimal decision metadata SHALL be exposed to the review interface and persisted locally. Candidate generation and approval SHALL NOT call an AI service, upload correction data, or send a personalization request. Existing panel-based manual correction and its global dictionary-memory behavior SHALL retain their current contract; the passive-learning toggle SHALL NOT silently change that behavior.

#### Scenario: Learning operates without an external service
- **WHEN** a passive observation generates a candidate and the user approves it
- **THEN** the learning feature SHALL perform only local operations and SHALL issue no AI or personalization request

#### Scenario: The review interface receives a candidate
- **WHEN** a pending candidate is displayed for approval
- **THEN** the renderer SHALL receive the eligible word pair and minimal decision metadata without the observed field snapshot or neighboring text

#### Scenario: The user makes an existing panel correction
- **WHEN** the user applies a manual correction through the existing transcription panel
- **THEN** the existing global dictionary-memory contract SHALL remain in force independently of the passive-learning setting
