# DoDrag

<p align="center"><img src="frontend/src/assets/app-icon.png" alt="DoDrag logo" width="220"></p>

**A small-task manager built around one question: what can I work on now?**

DoDrag keeps everyday TODO management lightweight. Its compact working view shows only tasks you can actually start; use the full list, network, and Gantt views when you need to plan ahead. In the focused view, work with open prerequisites stays out of the way until those prerequisites are done. When something cannot be done yet, drag it to a quick resubmission target and get back to the task at hand.

> **The idea:** managing small TODOs should take as little time as possible. Show the user only tasks they can work on right now, and let them defer a task with one drag.

## See it in action

### A focused task list

The date-layered list keeps actionable work easy to scan. Select a task to trace its upstream prerequisites and downstream effects.

<p align="center"><img src="docs/screenshots/task-list.png" alt="DoDrag task list with actionable tasks and dependency highlighting" width="900"></p>

### Reschedule without planning a new date

Drag a task onto a quick-resubmission target: **+1 day**, **next week**, **+7 days**, or **next month**. A task with open prerequisites still becomes actionable only when those prerequisites are complete.

<p align="center"><img src="docs/screenshots/quick-resubmit.png" alt="DoDrag quick-resubmission targets in the sidebar" width="760"></p>

### See dependencies as a network

Switch from the list to a dependency network or a Gantt timeline. Add a prerequisite by dragging the dependent task onto its prerequisite; drag with **Alt** to remove the relevant dependency edges.

<p align="center"><img src="docs/screenshots/network-plan.png" alt="DoDrag dependency network view" width="900"></p>

### Keep the next tasks in a corner

The compact, corner-docked view stays out of the way and shows only work that can be started, prioritizing tasks you marked active.

<p align="center"><img src="docs/screenshots/mini-view.png" alt="DoDrag compact corner view with currently actionable tasks" width="420"></p>

## Features

- **Actionable work first:** the compact view filters out tasks blocked by unfinished prerequisites. It prefers tasks due today and falls back to other unblocked tasks when there is no work due today; the full views remain available for planning ahead.
- **One-drag rescheduling:** defer a task by dragging it to a relative date target instead of opening a date picker.
- **Dependencies at a glance:** list, network-plan, and Gantt views share task interactions and highlight upstream and downstream tasks.
- **Drag-and-drop planning:** move tasks between dates, connect prerequisites, or remove selected dependency edges with Alt-drag.
- **Small, traceable edits:** edit titles and dates in place, mark a task active, complete or reopen tasks, and undo or redo changes.
- **Rich task descriptions:** a TipTap 3 editor with Markdown, checklists, GitHub-style note boxes, Mermaid diagrams, KaTeX mathematics, and Unicode shortcuts. The task log remains plain text.
- **Native Windows desktop app:** the app stores task history in SQLite and can manage multiple database files. Browser fallback code is an internal development aid, not a supported product target.
- **Compact corner view:** dock a small always-on-top task window to a screen corner and restore the main window when needed.

## Task descriptions and Markdown

Select a task and expand its detail panel to edit the description. The editor menus cover paragraph styles, formatting, lists, blocks, characters, and Mermaid diagrams. Menu tooltips show the corresponding syntax. Undo and redo buttons sit beside the dates above the editor; **Ctrl+Z**, **Ctrl+Y**, and **Ctrl+Shift+Z** also work while editing.

The main window starts at **1440 × 820 logical outer-window pixels**, limited to the current monitor's available work area. The detail panel starts at 560 pixels wide and can be resized independently of the task log. On sufficiently large screens, this leaves room for a single row of editor menus and a readable task list. Smaller screens, high display scaling, and additional dependency chips can reduce the available title space.

### Supported syntax

- Headings (`#` through `######`), paragraphs, **bold** (`**text**`), *italic* (`*text*`), strikethrough (`~~text~~`), and inline code (`` `code` ``).
- Bullet lists (`- text`), numbered lists (`1. text`), and checklists (`- [ ] text` / `- [x] text`).
- Quotes (`> text`), fenced code blocks, links, images, and tables.
- GitHub-style **Note**, **Important**, **Warning**, **Tip**, and **Caution** boxes with Unicode icons:

  ```markdown
  > [!TIP]
  > Keep the next action small.
  ```

- Inline mathematics (`$E = mc^2$`) and display mathematics (`$$` delimiters on separate lines), rendered with KaTeX. Click a formula or focus it with the keyboard to edit its LaTeX source.
- Mermaid fenced blocks, rendered as diagrams:

  ````markdown
  ```mermaid
  flowchart LR
    A --> B
  ```
  ````

The **Mermaid** menu inserts small templates for 30 bundled diagram families. Diagram previews are displayed at 75% scale. Selecting and copying a whole diagram copies its source, not its preview controls; pasting it into the description creates another diagram block.

The question-mark button beside the expanded detail panel's collapse button opens **syntax help**. Syntax help and keyboard-shortcut help link to each other. The syntax page includes expandable rendered Mermaid examples and a link to the [official Mermaid syntax documentation](https://mermaid.js.org/intro/syntax-reference.html), opened in your default browser. The external documentation may describe features newer than the bundled Mermaid version.

### Unicode and fraction shortcuts

The **Characters** menu groups shortcuts in three-column grids. Each entry shows its rendered symbol and literal input spelling.

| Group | Input → result |
| --- | --- |
| Arrows | `->` → →, `<-` → ←, `<->` → ↔, `=>` → ⇒, `<=>` → ⇔ |
| Typography | `...` → …; ` -- ` → a spaced em dash |
| Mathematics | `!=` → ≠, `<=` → ≤, `>=` → ≥, `~=` → ≈, `+/-` → ±, `:micro:` → µ |
| Unicode fractions | `1/2` → ½, `1/4` → ¼, `3/4` → ¾ |
| Other fractions | Integer `N/D` → inline LaTeX, for example `2/3` → `$\frac{2}{3}$` |

The editor also recognizes all 23 Confluence-style emoticon shortcuts: `:)`, `:(`, `:P`, `:D`, `;)`, `(y)`, `(n)`, `(on)`, `(off)`, `(!)`, `(*)`, `(*r)`, `(*g)`, `(*b)`, `(*y)`, `(/)`, `(x)`, `(i)`, `(+)`, `(-)`, `(?)`, `<3`, and `</3`. These use Unicode symbols rather than image assets; colored stars and status symbols retain their styling.

Symbol and fraction conversions wait for a safe input boundary, so typing `1/23` does not prematurely produce `½3`. They also apply to newly pasted content, but not to code, Mermaid source, mathematics, links, URLs, file paths, or chained dates. Loading an existing description does not rewrite its shortcuts. Fraction parts are limited to 12 digits each; a zero denominator is left unchanged. Backspace immediately after an input-rule conversion restores the typed spelling, and editor undo/redo remains available.

## Languages and translations

Choose the interface language in **Settings**. On first launch, DoDrag uses the Windows user's display language, falling back to English if it is unsupported. The choice is saved and can be changed without restarting. Existing task titles and database names are user data and are not translated when switching languages.

| Language | Code | Verification |
| --- | --- | --- |
| German | `de` | Verified |
| English | `en` | Verified |
| French | `fr` | Not verified |
| Spanish | `es` | Not verified |
| Simplified Chinese | `zh-CN` | Not verified |
| Ukrainian | `uk` | Not verified |
| Brazilian Portuguese | `pt-BR` | Not verified |
| Japanese | `ja` | Not verified |
| Traditional Chinese | `zh-TW` | Not verified |
| Korean | `ko` | Not verified |
| Italian | `it` | Not verified |
| Polish | `pl` | Not verified |
| Turkish | `tr` | Not verified |
| Esperanto | `eo` | Not verified |
| Toki Pona | `tok` | Not verified |

The translations are **AI-generated**; only **English and German have been verified**. The other languages may contain linguistic or contextual mistakes. Automated tests check catalog completeness, interpolation parameters, and untranslated app-owned UI text; they do not establish linguistic correctness. Technical error details from Windows or third-party libraries may remain in their original language. Some Mermaid diagram types generate English standard labels independently of the selected app language.

## Getting started

DoDrag is a Windows desktop application built with [Wails](https://wails.io/), Go, and React. You can either run a prebuilt executable or build it from source.

#### Download a release

Download the executable for your Windows processor from the [latest DoDrag release](https://github.com/sulimma/dodrag/releases/latest):

- **Most Windows PCs (Intel/AMD, 64-bit):** [`dodrag-windows-amd64.exe`](https://github.com/sulimma/dodrag/releases/latest/download/dodrag-windows-amd64.exe)
- **Windows on ARM (ARM64):** [`dodrag-windows-arm64.exe`](https://github.com/sulimma/dodrag/releases/latest/download/dodrag-windows-arm64.exe)

Save the matching `.exe` and open it to run DoDrag; no installer is required. The settings dialog can copy the program to `%LOCALAPPDATA%\Programs\DoDrag` and create desktop or Start menu shortcuts later.

#### Build from source

Install Go, Node.js/npm, and the Wails prerequisites for Windows, then run this repository's PowerShell build script:

```powershell
./build.ps1
```

The script installs frontend dependencies in a local cache, runs the frontend and Go tests, builds the frontend, and packages `dodrag.exe` into both `build/bin` and the repository root. It does not start the application. The source build currently reports version **0.2.1**; builds get their version and build timestamp from `build.ps1`. Without build-time values the binary reports `dev` and no build time. See [Architecture](ARCHITECTURE.md) for the code layout and runtime boundaries.

Standard validation uses frontend unit/DOM tests, TypeScript checking, Go tests, and native Wails packaging. Targeted Chromium checks are optional aids for SVG geometry or text layout; they do not verify Windows clipboard, WebView2, multi-monitor, or DPI integration.

## Author and affiliation

Created by **Kolja Sulimma**, who is affiliated with [cronologic GmbH & Co. KG](https://www.cronologic.de/). cronologic manufactures [time-to-digital converters (TDCs)](https://www.cronologic.de/products/products-overview#tdcdata) and [analog-to-digital converters (ADCs)](https://www.cronologic.de/products/products-overview#adcdata) for applications including time-of-flight mass spectrometry (TOF-MS), quantum key distribution (QKD), and quantum computing.

## License

DoDrag is licensed under the [Apache License, Version 2.0](LICENSE).
