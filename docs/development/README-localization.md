# Korean README and public BOJ screenshots

The public guide credits gaudium1257 for Convenient_BOJ and the v1.4.0 test and Wandbox features. The comparison uses the upstream README at `cfb8499` and the verified fork at `22192f2` (version 1.4.1). The installation heading is in Korean and retains the `#installation` target used by the extension and development documents. This update covers the public guide and its media. The prior phase reports describe their original builds and fixture evidence.

## Screenshot provenance

On 26 November 2026 (KST), installed Windows Chrome 158.0.8127.37 loaded an unpacked copy of `22192f2` into a fresh, signed-out profile. A single HTTPS document request opened problem 10818. Fourteen linked stylesheets loaded. The extension read the official sample from that page and sent the draft only to the installed local helper, MSVC and clangd. The problem statement remained intact. Only the public document and display assets were allowed over the network. [BOJ 10818](https://acmicpc.net/problem/10818)

| README visual | What was observed |
| --- | --- |
| [Workspace](../screenshots/workspace/workspace.png) | The official sample produced `7 35`. A custom case with four negative integers produced `-9 -2`. Both passed in a local C++17 MSVC run beside the public statement. |
| [IntelliSense](../screenshots/workspace/intellisense.png) | The local clangd server offered `std::vector<int>::begin()` with its iterator return type. The analysis status identified the MSVC headers. |
| [Diagnostics](../screenshots/workspace/diagnostics.png) | Editing `begin` to `begni` produced a diagnostic at line 12, column 37. Selecting it focused the affected line. The terminal retained the preceding successful run. |
| [Custom tests](../screenshots/workspace/cases.png) | The actual test panel shows the negative input, its expected output and its inclusion in the batch. |
| [Settings](../screenshots/workspace/settings.png) | The extension's packaged popup shows the installed runner, MSVC selection, theme and indentation controls. |
| [Power Mode](../screenshots/workspace/power-mode.gif) | Sixteen successive screen captures from the same draft show real typing with the Aurora preset and its combo counter. The README places this animation in an expandable section. |

The static detail images are unscaled crops. The GIF uses the original frames in order. The disposable profile contained a draft written for this guide. Visual review covered the original captures and the published crops, including the popup and animated frames, for account names, browser chrome and local filesystem paths.

## Checks and manual review

- Compared `git show cfb8499:README.md`, `git show 22192f2:manifest.json` and the packaged popup and installer with the Korean attribution, controls and setup instructions.
- Rendered the README with `ConvertFrom-Markdown -LiteralPath README.md`. All four tables have consistent columns. All six images decoded and have Korean captions and alternative text. The relative links and section targets resolved. The local Chrome preview fit widths of 390, 900 and 1200 pixels. The installation shortcut scrolled to the Korean heading and opening the Power Mode disclosure displayed the 16-frame GIF. The documentation passed `git diff --check`.
- To review, open the README in a Markdown preview. Follow the installation shortcut, compare the two shortcut profiles and expand Power Mode to see the animation. The five static images can be opened at their original size.
- The new live observation covers anonymous reading and local editing, analysis and execution. Submission, judging and polling belong to the existing offline fixture suite. Authenticated BOJ submission and external Git integration remain unverified here. [Integrated platform checks and limitations](P4.2.md#scope-and-limitations)
