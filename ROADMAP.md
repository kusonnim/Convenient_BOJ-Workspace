# Phase Roadmap

Each phase is independently reviewable. A gate is satisfied only by recorded evidence; environment-blocked checks remain open and must be carried forward. Do not start the next phase without owner approval. Model suggestions are advisory: use a capable coding model available in the Codex picker; high reasoning for ordinary phases and extra-high for integration-heavy phases if available.

| Phase | Scope | Suggested effort |
| --- | --- | --- |
| P0 | Baseline audit and regression harness | High |
| P1 | MSVC native execution | High |
| P2 | Monaco migration | High |
| P3 | clangd / LSP | Extra high |
| P4 | Tests and interactive terminal | High |
| P5 | Workspace UX | High |
| P6 | Persistence and personalization | High |
| P7 | End-to-end hardening and packaging | Extra high |

## Mandatory BOJ account safety at every gate

These rules override conflicting verification requirements in any previous, current or future phase instruction.

- Never submit code to live BOJ during automated development or testing. Never submit AI-generated solutions to BOJ.
- Use local fixtures for every submission, judging, polling and submission-lifecycle regression. Restrict live BOJ access to necessary, minimal, read-only smoke checks that follow the service's rules.
- Never automate submission button clicks, bypass CAPTCHA or circumvent rate limits. The user personally initiates final submission through the official BOJ submission page.
- Verify authenticated production submission and external Git integration only through normal, owner-initiated problem-solving activity. Carry unverified live behavior forward as a documented limitation. Automated live submission is never an acceptable way to close a gate.

## P0 — Establish the baseline
Inspect the actual checkout, license, release workflow, storage keys and native protocol, existing toolchain, current shortcuts, submission behavior and known limitations. Map CodeMirror dependencies and identify MV3 worker options. Add a minimal reproducible test harness with BOJ-like local fixtures and mocked extension/native APIs where useful; prefer actual unpacked Chrome tests. Cover split toggle/resize, draft/template/cursor restoration, C/C++/Python language paths, sample pass/fail, compile/runtime failure, interactive input/EOF/stop, submit prefill and judge state lifecycle (fixture only for submission). Capture baseline screenshots if runnable and reference the seven existing captures separately. Check multi-tab state collisions and native cleanup without implementing future features. Gate: source map, inventory, documented baseline results, runnable test commands, prioritized risks and proposed architecture/seams for P1–P3. Do not migrate editors or implement MSVC/clangd in P0.

## P1 — MSVC native execution
Add discovery, environment initialization, compiler selection/capability negotiation, standard flags, diagnostics decoding, caching and process cleanup. Preserve GCC, Python and C, current online fallback capability, native identity and legacy protocol behavior where practical. Handle GNU-only defaults for new MSVC drafts without touching saved code. Gate: real Windows cl.exe compile and run for standard headers, sample pass/fail, compile error, UTF-8, timeout, cancellation and repeated execution; verify cache hit/invalidation and legacy toolchains. Test missing/old host, missing compiler, install/uninstall and explicit remote fallback.

## P2 — Monaco migration
Implement editor adapter, local pinned assets and workers, preserve existing language/editing/storage/submit behavior. Update packaging to ship all required resources. Gate: installed Chrome with no CSP/worker errors; existing regression suite; actual drag selection/move, Tab indentation, multicursor, column selection, folding, undo/redo, search, theme and resize tests; old drafts/templates preserved. No clangd required yet.

## P3 — clangd intelligence
Add constrained native LSP transport, tool discovery, MSVC compilation configuration, per-document lifecycle and Monaco providers. Gate: real clangd + MSVC headers; STL member completion, local symbols, include suggestions, signatures, live diagnostics, UTF-16 edits, rapid typing, stale responses, multiple tabs, reconnect and absent clangd fallback. Record startup/completion latency and resource cleanup. No AI generation.

## P4 — Test workspace and terminal
Add test case management, sample/custom tabs, reorder, compare, current/all execution actions, structured diagnostics and streamed stdout/stderr. Preserve judge result panel. Gate: compile once per batch; correct outputs and raw output preservation; empty expected output versus absent expectation; CRLF, multiline, Unicode, timeouts, stop/EOF, output bounds, editing during execution, stderr exclusion and independent per-tab jobs. Do not yet replace legacy keyboard mappings unless required to avoid a conflict.

## P5 — UI/UX
Refine actual split layout using baseline captures. Implement resize, tab reorder, collapse/maximize, focus mode, reset, persistence and themes. Gate: inspected screenshots at 1280x720, 1920x1080 and narrow/zoomed viewport; pointer and keyboard operation; no obscured controls, layout overflow or broken original statement rendering. Test closing/reopening and page navigation.

## P6 — Personalization
Complete storage migration, cursor/scroll restoration, custom snippets/templates and configurable action shortcuts; resolve legacy shortcut conflicts explicitly. Gate: upgrade/reload/restart, multiple problems/languages, Unicode snippets and cursor placeholders, IME, shortcut conflicts, no data loss, and explicit submit confirmation. No duplicate Git integration.

## P7 — Integration and release readiness
Run full regressions and inspect real Windows Chrome installation with MSVC/clangd; test no-host, old-host, upgrade/uninstall, multiple tabs, service worker suspension, native crashes, large outputs and sustained sessions. Validate package contents, licenses, identity and dependency reproducibility. Measure baseline vs final startup, compile/cache time, completion responsiveness and process/memory cleanup where possible. Apply the account-safety rules above to live rendering and to any owner-provided evidence of authenticated submission or external Git compatibility. Gate: evidence-backed report, open blockers clearly stated, local installable artifact if permitted, migration/recovery instructions and no unapproved release.
