# Convenient BOJ — C++ Workspace Upgrade

## Goal and scope
Extend the existing Convenient BOJ Chrome Manifest V3 extension, not a new desktop app or a replacement for BOJ. Keep the original problem page on the left and a practical VS Code-like workspace on the right. Optimize for the owner's Windows C++ workflow using the existing Visual Studio `cl.exe` toolchain. Preserve C, Python, GCC and Wandbox behavior. UI copy remains Korean where the existing product uses Korean; specification files are English.

## Mandatory BOJ account safety

These requirements apply to all current and future phases and take precedence over conflicting verification requirements.

- Automated development and testing must never submit code to live BOJ. Never submit an AI-generated solution to BOJ.
- Use local fixtures for every regression involving submission, judging, polling or the submission lifecycle. Limit necessary live smoke checks to minimal read-only access consistent with BOJ's rules.
- The user personally initiates final submission on the official BOJ submission page. Never automate the submission button, bypass CAPTCHA or circumvent rate limits.
- Verify authenticated production submission and the external Git integration only through normal, owner-initiated problem-solving activity. If that evidence is unavailable, document the limitation. An unverified result never permits automated live submission.

## Baseline and source of truth
The supplied `Convenient_BOJ.zip` contains manifest version 1.3.3 and Git HEAD `840b0f5b5aa9376b530fdd5de017a5654746d71c`. The archive's apparent working-tree changes disappeared in an end-of-line-insensitive diff. The original extension is by `gaudium1257/Convenient_BOJ`. The owner confirmed the original author's permission for the P3.5 GitHub fork. Upstream has no root license at the inspected revisions. The bundled libraries retain their respective notices.

- `manifest.json`: fixed public extension key, MV3, BOJ content scripts, storage/nativeMessaging and Wandbox host permission.
- `content/split.js`, `content/split.css`: split UI, CodeMirror 5, sample runner, terminal, drafts, layout and judge display.
- `shared/defaults.js`, `shared/boj.js`, `popup/`: templates, settings and judge parsing. The current C++ default uses `bits/stdc++.h` and `$0` cursor placement.
- `background.js`: Wandbox, `cboj-runner` port to `com.convenient_boj.runner`, submission tab lifecycle.
- `host/cboj_host.py`, `host/install.*`, `host/uninstall.*`: Python native host, gcc/g++ discovery, batch and interactive execution, Windows installation. Current GCC-specific constructor and flags are not MSVC-compatible.
- `content/submit.js`, `content/submit-main.js`, `content/status.js`: fill actual BOJ submit page, human confirmation, track judge result and restore focus.
- `docs/screenshots/`: seven existing reference captures; `.github/workflows/release.yml`: explicit packaging allowlist.

## Product requirements
### Local compiler and runner
Detect existing MSVC installations via trusted Visual Studio discovery (including Build Tools and `vswhere` where available), initialize an x64 developer environment without changing global PATH or VS Code settings, and probe real compilation. Select compiler independently of BOJ submission language. Prefer MSVC for C++ on the owner's machine when available; retain explicit GCC and existing Wandbox choices. Support C++17/20 with appropriate MSVC flags, UTF-8 source, optimization and existing judge macros where compatible. Report unsupported standard or compiler-specific constructs accurately. For fresh MSVC drafts offer a standard-header template preserving fast I/O and `$0`; never silently rewrite existing drafts or user templates. Explain that GNU-specific `bits/stdc++.h`, `__int128` and extensions may not compile under MSVC and that local timings are not judge timings.

Keep native host installation user-scoped and opt-in; do not install toolchains without consent. No manual server or terminal should be needed after setup. Detect old host versions, show actionable repair guidance, and preserve uninstall behavior. Use structured versioned messages, request/job IDs, bounded inputs and outputs, isolated temporary directories, argument arrays, timeouts, cancellation and process-tree cleanup on Windows. Never execute arbitrary host shell commands supplied by web content. Native execution is not a security sandbox. Do not silently send source/input to Wandbox on local failure; clearly disclose remote execution and obtain user choice for fallback while preserving availability.

Compile once for a batch and reuse successful artifacts for unchanged source and effective compiler identity/version, flags, standard, environment and interactive mode. Bound and clean cache; avoid stale results after edits, failed compilation or toolchain changes. Separate job state across tabs; support disconnect/reconnect and cancellation without duplicate execution. Preserve Python/C behavior.

### Editor and intelligence
Replace CodeMirror with locally bundled Monaco via an editor adapter; preserve storage, view state, language choices, themes, indentation and submission data. Use an MV3-compatible packaged worker architecture; no remotely hosted scripts, eval-based shortcuts or unnecessarily relaxed CSP. Validate worker loading in installed Chrome. Keep C/Python syntax editing functional. Support brackets, indentation, keyword completion, drag-selected code, multi-cursor, column selection, line selection, Tab/Shift+Tab, folding, search/replace, optional minimap, undo/redo and familiar VS Code keybindings.

Use clangd through the native host for non-AI C++ completion, member/variable/function suggestions, standard library and header completion, signature help and diagnostics. Discover existing clangd or provide explicit installation guidance; editor and execution still work without it. Configure compile commands/target and actual MSVC include paths; prove standard library resolution on the real toolchain. LSP messages must have correct framing, request correlation, document versions, UTF-16 position conversion, cancellation and lifecycle handling. Isolate documents per problem/tab; discard stale diagnostics and suggestions. MSVC is the compiler; clangd is analysis and may disagree, so distinguish diagnostics from actual compiler errors. Do not promise full VS Code extension compatibility.

### Testing, terminal and diagnostics
Provide separate lower-panel tabs for test cases, terminal, problems/diagnostics and existing judge results. Extract BOJ sample inputs and outputs without changing the original problem DOM; preserve whitespace. Show sample and user test tabs, add/edit/delete/reorder custom tests, and save them per problem. Run current or all tests; compile once, isolate each process, show pass/fail, actual and expected output and meaningful diff. Define normalization explicitly (e.g. normalize CRLF and trailing whitespace consistently with baseline, retain raw output); do not imply sample pass guarantees acceptance. Tests without expected output are run-only. Distinguish compile error, runtime error, timeout, cancellation, output limit and mismatch. Display measured local elapsed time; memory only if reliably measured, otherwise unavailable.

Interactive terminal must stream stdout and stderr separately, support input, EOF and stop, and preserve logs within bounds. Do not inject GNU-only stubs in MSVC. Explain buffering limitations; do not mutate submitted code to force flushing. `cout` is stdout; `cerr` is diagnostic output excluded from expected-output comparison. Map compiler diagnostics to editor locations where trustworthy; retain raw diagnostic text. No breakpoint debugger or algorithm visualizer in this scope.

### Layout and personalization
Preserve BOJ original statement, math, images and tables, and native navigation. Reuse the existing split toggle and resize behavior; enhance pointer/keyboard resizing, drag reorder of custom test tabs, collapse/maximize lower panel, editor focus mode, double-click reset and persisted layout/active tab. Support light, dark and mixed (light problem / dark editor) themes; mixed is a proposed default for fresh installs only, pending visual verification; respect existing settings. Avoid unnecessary decoration, oversized cards and rounded controls. Match VS Code editing density without cloning irrelevant IDE chrome. Verify common desktop widths, narrow fallback, zoom, keyboard focus, contrast and cleanup when closing/reopening the workspace.

Keep problem/language-specific drafts, cursor and scroll restoration, templates, user snippets and test settings. Never overwrite existing data. Migrate storage idempotently and keep compatibility or rollback path. Do not add submission snapshots, code history or Git integration: the owner already has a separate submission-to-Git workflow.

P4 implements the compact lower panel, keyboard resizing, persisted size and panel tab, custom case tabs, local per-language snippets and optional typing effects. Power Mode defaults to off on fresh and existing profiles. Its three presets share a bounded drawing surface and combo thresholds. Reduced motion disables drawing and shake. The BOJ statement retains the site's theme. The editor keeps the user's existing theme and the fresh-install light default. [P4 implementation and evidence](docs/development/P4.md)

### Keyboard behavior
Preserve Alt+C toggle, Ctrl+S save, and the existing Ctrl+Enter / Ctrl+Shift+Enter behavior through P3.5. P4 retains the classic profile and adds an opt-in test-first profile for the current test (Ctrl+Enter), all tests (Ctrl+Shift+Enter), opening the official form (Ctrl+Shift+S) and stopping a run (Ctrl+Shift+X). Ctrl+Alt+Enter runs the selected test in either profile. The user personally initiates final submission on the official page. Keep Monaco editing shortcuts and Ctrl+Space completion. Test actual Chrome for reserved keys, alternatives, focus and IME composition.

### Submission and external integration
Preserve the official BOJ submission tab, code/language prefilling, manual final submission and CAPTCHA, privacy choice, judge tracking, result links, focus return and tab cleanup. Keep external Git integration untouched. Apply the account-safety requirements above to compatibility claims and never collect credentials. Test the existing `cbojPending`, `cbojJudge` and submission session state in local multi-tab fixtures when addressing cross-talk.

## Exclusions
No solved.ac integration in this roadmap, no independent application, no AI-generated code, no breakpoint debugger, no new Git integration or submission history, no mandatory stress-test/algorithm visualization feature. Future advanced testing can be considered separately.

## Acceptance principles
Every phase must retain existing usable features, run relevant automated checks, and verify actual browser interactions when available. Use local fixtures for deterministic BOJ and native-host simulation, plus real Chrome/Windows smoke tests for platform claims. Distinguish fixture results from live results and report blocked checks. Preserve the extension ID, native-host allowlist and packaging. Pushes and releases require explicit owner authorization. See ROADMAP.md for phase gates.

## P4 integration contract

The extension key, native-host name, permission set, runner protocol 2, and analysis protocol 1 are retained. The new settings are additive. Existing draft, template and runner selection formats are read in place. The local P4 review gate precedes the separately developed P4.1. Integration into the fork's default branch and remote publication are deferred to the owner-approved combined integration. [Adapter, settings, native and CSS boundaries](docs/development/P4.md#integration-points-for-p41)
