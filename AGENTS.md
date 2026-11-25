# Agent Instructions

Read PROJECT_SPEC.md and ROADMAP.md before editing. Work only on the explicitly requested phase. Existing code and user data are the starting point, not disposable scaffolding. If implementation and specification differ, investigate and document before changing behavior. Do not silently expand scope.

1. Inspect Git status, current branch, existing diffs, tools and baseline. Never reset, clean, overwrite or commit unrelated user changes. Treat archived line-ending differences carefully. Keep the extension identity and upstream attribution; verify license before redistribution.
2. Analyze, implement, run, observe, fix and re-run within the requested phase. Prefer small separable changes, adapters and testable modules over large rewrites. Preserve original BOJ DOM and manual submission flow.
3. Use local dependencies pinned with licenses and reproducible builds. MV3 CSP and worker compliance are mandatory. Do not add broad host permissions or remote executable code. Validate sender/message schemas and keep native-host commands constrained. Protect drafts, credentials and local paths; never send code to external services without informed choice.
4. Test representative positive and negative cases, old storage and host compatibility, tab isolation, keyboard/IME and lifecycle as applicable. Capture and inspect actual screenshots for visual changes and compare them against the baseline. Use real Chrome with the unpacked extension and Windows toolchains for platform claims. Apply the BOJ fixture requirements below to every submission-related check. Mark unavailable checks explicitly. Never fabricate screenshots or test results.
5. Update phase report in docs/development/ with changes, commands/results, screenshot paths, regressions, limitations and manual verification steps. Distinguish completed, failed and unverified items. Record any decisions not covered by the specification.
6. After verifying each completed phase, commit its isolated changes and push the phase branch to the owner's `origin` remote. Confirm that the remote branch points to the local commit, then stop for review. If the changes cannot be safely isolated, report the blocker. Starting the next phase, publishing or tagging a release, installing system tools and modifying user-wide configuration each require separate owner approval.

All new Markdown specifications and development reports must be in English. Keep existing Korean UI copy and upstream README content unless a change is required by the phase.

## Mandatory BOJ account safety

These rules govern the current phase and every future phase. They override any conflicting verification instruction or phase gate.

- Never submit code to live BOJ during automated development or testing. Never submit AI-generated solutions to BOJ.
- Run every submission, judging, polling and submission-lifecycle regression against local fixtures. Limit live access to the minimum necessary read-only smoke check permitted by BOJ's rules.
- Never automate submission button clicks, bypass CAPTCHA or circumvent rate limits. The user must personally initiate final submission on the official BOJ submission page.
- Verify authenticated production submission and the external Git integration only through normal, owner-initiated problem-solving activity. Record any unverified live behavior as a limitation. It never authorizes an automated live submission.
