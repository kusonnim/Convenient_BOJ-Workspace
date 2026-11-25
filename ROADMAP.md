# Workspace roadmap

Development takes place on `workspace`. P3.5 is the fork migration and review gate. The full roadmap and the P0–P3 reports are on that branch. [Workspace roadmap](https://github.com/kusonnim/Convenient_BOJ-Workspace/blob/workspace/ROADMAP.md) · [P3.5 report](https://github.com/kusonnim/Convenient_BOJ-Workspace/blob/workspace/docs/development/P3.5.md)

## Final P4 (planned)

P4 brings together persistent custom test cases and tab management, user-defined snippets, optional Power Mode with particles, combos, presets and configurable intensity, a minimal workspace UI, and independent submission tabs. Power Mode defaults to off. The final gate covers performance, lifecycle, installation, upgrades and regression verification. P4 requires separate owner approval.

## Mandatory BOJ account safety at every gate

These rules override conflicting verification requirements in any previous, current or future phase instruction.

- Never submit code to live BOJ during automated development or testing. Never submit AI-generated solutions to BOJ.
- Use local fixtures for every submission, judging, polling and submission-lifecycle regression. Restrict live BOJ access to necessary, minimal, read-only smoke checks that follow the service's rules.
- Never automate submission button clicks, bypass CAPTCHA or circumvent rate limits. The user personally initiates final submission through the official BOJ submission page.
- Verify authenticated production submission and external Git integration only through normal, owner-initiated problem-solving activity. Carry unverified live behavior forward as a documented limitation. Automated live submission is never an acceptable way to close a gate.
