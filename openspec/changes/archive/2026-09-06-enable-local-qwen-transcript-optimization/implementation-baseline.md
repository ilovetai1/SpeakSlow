# Implementation Baseline

Recorded: 2026-09-06 (Asia/Taipei)

## Source state

- Milestone commit: `fd1082c76f305d3ca1e3c0fe600cba9812595519`
- Milestone version: `2.0.0`
- Implementation branch: `codex/enable-local-ollama-transcript-polishing`
- Implementation worktree: `/Users/chunghan/AI/SpeakSlow-worktrees/enable-local-ollama-transcript-polishing`
- Main checkout remains at the milestone and retains these unrelated untracked files: `.codex/`, `assets/logo-build/speakslow-logo-v2-chroma.png`, and `windowManager.js`.

## Installed and live state

- Installed `/Applications/SpeakSlow.app`: version/build `1.0.20`; `codesign --verify --deep --strict` passed.
- Installed SpeakSlow was running during inventory with its Sherpa backend.
- Live AI settings: `enable_ai_optimization=false`, base URL `https://api.deepseek.com`, model `deepseek-v4-flash`, no explicit `ai_provider`.
- Ollama client: `0.21.2`; server was not running.
- Local Ollama manifest: `qwen3:1.7b` only.

## Verification baseline

- Node tests: 27 passed, 0 failed.
- Python Sherpa memory tests: 4 passed, 0 failed.
- Renderer build: passed for `speakslow@2.0.0`.
- OpenSpec strict validation: passed.

## Implementation boundaries

- In scope: main-process AI provider seam and IPC, Ollama runtime/model discovery, settings UI, recording output orchestration, clipboard decision logic, history re-polishing, database access semantics, translations, tests, and this OpenSpec change.
- Out of scope: Sherpa ASR/VAD/punctuation behavior, model files, generated logo assets, unrelated window-manager copies, existing installed app replacement until packaging acceptance, remote push, and OpenSpec archive.
- Existing remote provider behavior must remain compatible.
- No cleanup or mutation of the main checkout's unrelated files is authorized.

## `num_ctx:2048` input-boundary measurement

- Runtime: Ollama 0.21.2, `qwen3:1.7b`, `think:false`, `temperature:0`, `keep_alive:0`.
- Universal prompt with a 500-character Traditional Chinese stress transcript completed in 6.477 seconds (`prompt_eval_count=711`, `eval_count=385`, `done_reason=stop`).
- The equivalent 600-character repetitive stress transcript exceeded the fixed 60-second request budget; the 700-character case did as well.
- Product limit is therefore fixed at 500 Unicode characters. Over-limit transcripts fail polishing before inference and are not truncated, split, or sent with a larger context.

## Local Ollama verification

- Model discovery returned only `qwen3:1.7b` (`2.0B`, `Q4_K_M`, 1,359,293,444-byte model file) and excluded non-completion or explicit Cloud entries by contract tests.
- A live 500-character request through `AITextProcessor` returned non-empty text in 2.346 seconds. A longer 80-item stress request completed in 18.000 seconds; wording quality was observed but was not used as a release gate.
- A missing-model request returned failure and `finalizeTranscript` preserved `原始文字` with the inline issue `潤稿失敗，已使用原始文字`.
- A live request with a deliberately 1 ms budget ended with `TimeoutError`; no alternate model or provider was attempted.
- While the 80-item request was active, Ollama `/api/ps` reported model allocation `1,644,836,896` bytes and context `2048`. The runner reached a sampled maximum RSS of `1,629,280 KB`; `vmmap` observed physical footprint and peak physical footprint of `1.1G` during inference.
- Each live request used `keep_alive:0`; bounded post-request `/api/ps` checks returned an empty model list.
- Ollama requests are fixed to `http://127.0.0.1:11434/api/chat`; source and contract tests found no external AI fallback in the Ollama path.

## Packaged and installed acceptance

- Final verification: Node `64` tests (`63` passed, `1` Electron-ABI-only skip), packaged Electron DB test `1/1`, Python Sherpa memory tests `4/4`, renderer build passed, and strict OpenSpec validation passed.
- Renderer-first macOS arm64 packaging completed. Both the worktree artifact and `/Applications/SpeakSlow.app` report version `2.0.0` and pass `codesign --verify --deep --strict`.
- The previous installed app was preserved at `/Applications/SpeakSlow.app.backup-1.0.20-20260906-1845`.
- The installed settings UI discovered and selected `qwen3:1.7b · 1.27 GB · 2.0B · Q4_K_M`; the provider is `ollama` and polishing is enabled.
- Installed UI connection testing returned `AI設定測試成功` with a non-empty response from `qwen3:1.7b`.
- A real right-Alt hold-to-record acceptance run created history row 827, completed local polishing, and pasted the exact final text into the current TextEdit cursor while TextEdit remained the frontmost app throughout.
- A non-AI right-Alt run with polishing disabled created history row 828 and pasted the exact raw transcript; the AI request counter did not change. Polishing was then restored to enabled without changing provider or model.
- History re-polishing produced the current/candidate preview; cancelling preserved the existing result.
- Failure fallback, inline issue, DB-save continuity, and external/owned runtime boundaries are covered by the finalized contract tests. The packaged Electron runtime separately passed the native `better-sqlite3` history contract.
- Post-request `/api/ps` returned an empty model list. The existing Ollama server process remained running through the disable/enable rollback check.

## Ten-minute Sliding Idle Lifetime Acceptance (2026-09-06)

- The installed 2.0.0 application's packaged `AITextProcessor` sent `keep_alive:"10m"`, `model:"qwen3:1.7b"`, `num_ctx:2048`, and `think:false` through the native loopback `/api/chat` path.
- The controlled cold request completed in `1724.8 ms`; an identical warm request completed in `462.2 ms`, reducing observed request latency by about `1262.6 ms` (`73%`).
- `/api/ps` reported `expires_at` exactly `600.0` seconds after each request. The second request advanced the expiry and reset the remaining lifetime to `600.0` seconds, confirming sliding idle behavior.
- The retained model allocation was `1,644,836,896` bytes (`1.53 GiB`) at context `2048`. The runner sampled RSS was `1,477,504 KB` (`1.41 GiB`), while `vmmap` reported current and peak physical footprint of `1.6G` immediately after inference.
- The controlled external Ollama server was stopped after measurement. The installed App remained running and retained its saved `ollama` / `qwen3:1.7b` / polishing-enabled settings.
- Final verification remained: Node `64` tests (`63` passed, `1` Electron-ABI-only skip), packaged Electron DB test `1/1`, Python Sherpa memory tests `4/4`, renderer build passed, strict OpenSpec validation passed, and the installed app's Apple Development signature passed deep strict verification. This local build is not a notarized distribution artifact.

## User-editable Polishing Prompt Acceptance (2026-09-06)

- The installed 2.0.0 settings renderer exposes a 10-row editable `潤稿提示詞` textarea on the `AI 文字優化` page. A new installation or existing database without `transcript_polishing_prompt` displays the 359-character built-in instruction; the transcript marker is not exposed in the editable value because the main process appends the transcript separately.
- Installed-renderer DOM checks confirmed live editing updates the character count and whitespace-only content disables `儲存設定`. The editability check did not click Save, and the live database still had no `transcript_polishing_prompt` row afterward.
- A live request through the installed packaged `AITextProcessor` sent the exact custom instruction, omitted the built-in instruction, retained `keep_alive:"10m"`, completed in approximately `1370 ms`, and reset Ollama's model expiry to exactly `600.0` seconds.
- The `qwen3:1.7b` response did not remove the filler word requested by that custom instruction. Exact Prompt delivery is verified; semantic compliance is not guaranteed by exposing the field or by this model size.
- Final verification: Node `67` tests (`66` passed, `1` Electron-ABI-only skip), packaged Electron DB test `1/1`, Python Sherpa memory tests `4/4`, renderer build passed, strict OpenSpec validation passed, `git diff --check` passed, and `/Applications/SpeakSlow.app` passed deep strict signature verification.
- The immediately previous installed 2.0.0 app was preserved at `/Applications/SpeakSlow.app.backup-2.0.0-pre-editable-prompt-20260906-2027`.
