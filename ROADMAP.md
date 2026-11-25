# Phase Roadmap

The reports follow the development history from the original audit to the official fork’s integrated default branch. P4 delivered the final workspace, P4.1 added editor polish on its own branch, and P4.2 brought both verified commits together for the owner’s final review.

| Phase | Scope | Suggested effort |
| --- | --- | --- |
| [P0](docs/development/P0.md) | Baseline audit and regression harness | High |
| [P1](docs/development/P1.md) | MSVC native execution | High |
| [P2](docs/development/P2.md) | Monaco migration | High |
| [P3](docs/development/P3.md) | clangd / LSP | Extra high |
| [P3.5](docs/development/P3.5.md) | Official fork, history migration and documentation | High |
| [P4](docs/development/P4.md) | Test cases, snippets, optional Power Mode, workspace UI, submission isolation and final verification | Extra high |
| [P4.1](docs/development/P4.1.md) | Editor navigation, themes, local formatting and backup | High |
| [P4.2](docs/development/P4.2.md) | Final integration, compatibility, performance, recovery and fork publication | Extra high |

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

## P3.5 — Official fork and migration

Back up and restore-check the local history, including P3. Verify GitHub's fork parent, the default branch, the original phase commits and the backup repository. Publish the verified P0–P3 history to the owner's fork with explicit branch pushes. Credit the original author in the README, show the P2/P3 captures, and verify the source-install link and offline regressions. Stop for review before P4.

## P4 — Final workspace and local verification

| Work | Acceptance at the final gate |
| --- | --- |
| Persistent test cases and tabs | Keep BOJ samples in their original order. Add, edit, delete and reorder custom cases per problem. Restore tab order and selection after reload. Run the selected case or all cases with one compile per batch. Distinguish missing expected output (run only) from an expected empty string. Retain raw output and check CRLF, multiline and Unicode diffs, stderr, output limits, timeout, stop, EOF, editing during a run and independent jobs. |
| User-defined snippets and shortcuts | Create, edit, insert and delete language-specific snippets. Verify Unicode, cursor placeholders and shortcut conflicts with Korean IME. Test upgrades, reloads and restarts with existing templates, drafts, cursor and scroll positions. If an action shortcut changes, explain the new binding. A submit shortcut may only open the official form. |
| Optional Power Mode | Ship it **disabled by default**. After opt-in, offer typing particles, combos, presets and configurable intensity. Verify the default on new and upgraded profiles, persistence of an explicit choice, ordinary editing and IME at each intensity, and cleanup of animations and timers on disable, collapse and navigation. Measure typing responsiveness with effects off and on. |
| Minimal workspace UI | Remove redundant text and decorative elements while retaining control names, errors, diagnostics, remote-execution consent and manual submission guidance. Keep the statement, terminal, test and judge panels usable. Verify keyboard and pointer resizing, tab reordering, collapse/maximize, focus mode, reset, themes and persisted layout. Inspect captures at 1280×720, 1920×1080 and a narrow or zoomed viewport. |
| Multiple submission tabs | Scope pending code, language, privacy, judge updates, focus return and cleanup to each problem tab and its managed form. Promote the existing expected failure to a passing fixture test. Open both forms, interleave results, close one early and confirm the other survives. Include two origins on the same problem. Use local fixtures for the entire sequence. |
| Installation, performance and regressions | Run the P0–P3 suites and the new P4 cases in unpacked Windows Chrome. Check MSVC, GCC, Python, clangd, the missing/old-host paths and consent for Wandbox with doubles. Exercise install, upgrade, uninstall, service-worker suspension, native crashes, navigation and sustained use. Compare startup, cache reuse, completion latency, memory and process cleanup with the recorded baselines. Verify the package, extension identity, third-party notices and reproducible assets. |

The final integration report contains the installation and recovery steps, measurements, visual evidence and remaining limitations. Authenticated BOJ submission and the external Git integration can be checked only during ordinary owner-initiated problem solving. Release publication requires separate approval.
