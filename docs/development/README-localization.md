# Korean README and screenshot verification

## Version 1.5.0

The guide now describes the extension at `82fc09c5f4350207191f4db958fca60a757b742b` and Windows helper 2.1.0. The feature comparison credits gaudium1257 for the original Java runner, problem stopwatch, GCC stack reserve and Wandbox retry behavior. It identifies the fork's Monaco and clangd integration, Java release targeting, adjustable MSVC/GCC reserve, shared request limit and backups. The P5 report remains the source for the 53 Chrome and 35 native test results. [P5 behavior and tests](P5.md) · [Upstream credit](../../NOTICE)

### What each capture shows

| README visual | Version and source | What was verified |
| --- | --- | --- |
| [Java workspace and stopwatch](../screenshots/workspace/v1.5.0/java-stopwatch.png) | 1.5.0, new capture of the saved public BOJ 10818 page | Installed Chrome opened the upstream Java template. After editing, saving, switching to C++ and returning to Java 11, the editor restored the same `Main.java` text. The running clock read `00:02`. The lower panel shows the official sample and its expected output. |
| [Local JDK run](evidence/p5/java-dracula.png) and [accepted stopwatch](evidence/p5/accepted-timer.png) | 1.5.0, existing P5 Chrome captures on local BOJ fixtures | The first shows a real local `javac` run targeting Java 11 and two passing cases after a cache hit. The second shows the elapsed time on both the toolbar and the simulated accepted-result card. |
| [Execution settings](../screenshots/workspace/v1.5.0/settings.png) | 1.5.0, new capture of the installed popup | The initial reserve was 256 MiB and automatic timer start was off. After changing the reserve to 128 MiB, enabling automatic start and reloading the popup, both selections persisted. |
| [Wandbox error](../screenshots/workspace/v1.5.0/wandbox-error.png) | 1.5.0, new terminal capture with simulated provider responses | The extension made three compile attempts against a local HTTP 503 fixture and then displayed the photographed message. |
| [C++ workspace](../screenshots/workspace/workspace.png), [completion](../screenshots/workspace/intellisense.png), [diagnostic](../screenshots/workspace/diagnostics.png), [custom case](../screenshots/workspace/cases.png), [popup](../screenshots/workspace/settings.png) and [typing animation](../screenshots/workspace/power-mode.gif) | 1.4.1, original signed-out public BOJ session | All six original files are still accessible from the guide. The current overview and settings images show the restored controls. The original C++ overview and upper popup are linked with their capture version. |

The three new PNGs came directly from installed Windows Chrome 158.0.8127.37 on 26 November 2026 (KST) with the unpacked direct-install ZIP, a temporary profile and external DNS resolution disabled. The page and styles were replayed from the original anonymous capture. The saved HTML SHA-256 was `4f19b94c49af947b5d9b19a9a10ef752721b217ce0240ba7994cba163d8a2e0f`. The browser verified the page title, sample, signed-out state and unchanged problem description. No program or input reached BOJ or Wandbox. The same session confirmed that pausing the stopwatch held its displayed value.

### Documentation checks

- Compared the README with the manifests, Windows installer, settings and backup allowlists, compiler selection and retry code. Running `python tools/package.py --ref 82fc09c --output <temporary-directory>` reproduced both recorded P5 SHA-256 digests. Only the direct-install ZIP contains the fixed key and Windows helper. [Package evidence](evidence/p5/packages.json)
- Reran `python -X utf8 -B tests/p0/native_p5_test.py` with the installed Windows toolchains. All five tests passed. They exercised Java batch and terminal execution, missing-JDK handling, compatibility with the upstream helper and the stack reserve in executables produced by MSVC C++, GCC C++ and GCC C.
- Recomputed the first-open and reopen medians from the three 400-line editor profiles (431 and 97 ms). The separate STL completion workload recorded 3,105 ms cold and a five-sample median of 120 ms warm. [Editor samples](evidence/p5/editor-performance.json) · [Completion samples](evidence/p5/latency.json)
- All six public README destinations returned HTTP 200 to read-only HEAD requests, including the source ZIP after its GitHub redirect. The source ZIP and the two package variants have distinct installation instructions. The published scope for P5 covers installed Windows Chrome, local toolchains and fixture-based submission and judging. [P5 verification limits](P5.md#verification-results)
- Rendered both Markdown files with `ConvertFrom-Markdown` and checked relative paths with their Git filename casing and fragments against the rendered targets. The Korean guide has eight embedded visuals with versioned captions and Korean alternative text. Three further images open from versioned links. In Chrome all eleven decoded, the installation shortcut scrolled to its heading, the Power Mode disclosure opened and the preview fit 390, 900 and 1200 px widths.
- Reviewed the visible content of the ten PNGs and all sixteen frames of the GIF for personal information. The media show demonstration code, public problem text, product settings or fixture results. The PNG files contain only image header, raster data and end chunks. The GIF contains no comment or EXIF metadata. The three new files match the browser captures byte for byte. The remaining eight match their previously verified Git blobs.

To reproduce the visual checks, open the guide in a Markdown preview, follow the installation shortcut, expand the typing animation and open the original C++ example. In a disposable Chrome profile, load the extracted direct package, open a saved copy of the public problem, save a Java draft, switch languages and return. Enable automatic timer start and set the stack to 128 MiB, then reopen settings to compare the displayed values. [Korean README](../../README.md)

## Version 1.4.1

The original localization compared the upstream README at `cfb8499` with fork revision `22192f2`. It retained gaudium1257's attribution and the `#installation` target used by the extension and development documents.

### Screenshot provenance

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

### Original checks and manual review

- Compared `git show cfb8499:README.md`, `git show 22192f2:manifest.json` and the packaged popup and installer with the Korean attribution, controls and setup instructions.
- Rendered the README with `ConvertFrom-Markdown -LiteralPath README.md`. All four tables have consistent columns. All six images decoded and have Korean captions and alternative text. The relative links and section targets resolved. The local Chrome preview fit widths of 390, 900 and 1200 pixels. The installation shortcut scrolled to the Korean heading and opening the Power Mode disclosure displayed the 16-frame GIF. The documentation passed `git diff --check`.
- To review, open the README in a Markdown preview. Follow the installation shortcut, compare the two shortcut profiles and expand Power Mode to see the animation. The five static images can be opened at their original size.
- The new live observation covers anonymous reading and local editing, analysis and execution. Submission, judging and polling belong to the existing offline fixture suite. Authenticated BOJ submission and external Git integration remain unverified here. [Integrated platform checks and limitations](P4.2.md#scope-and-limitations)
