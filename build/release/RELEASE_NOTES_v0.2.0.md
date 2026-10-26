## Changes
- Task descriptions now use a TipTap 3 editor with Markdown round-tripping: headings, lists, checklists, quotes, tables, links, images and fenced code blocks.
- GitHub-style **Note**, **Important**, **Warning**, **Tip** and **Caution** boxes with Unicode icons.
- Inline and display mathematics rendered with KaTeX; clicking a formula edits its LaTeX source.
- Mermaid fenced blocks render as diagrams, with a template menu covering 30 bundled diagram families and copy-source behaviour for whole diagrams.
- Unicode input shortcuts for arrows, typography, mathematics, fractions and all 23 Confluence-style emoticons, applied at safe input boundaries and limited to newly typed or pasted text.
- Syntax help page with rendered Mermaid examples, linked from keyboard-shortcut help and from the detail panel.
- The main window now starts at 1440 x 820 logical outer-window pixels, centred and capped to the current monitor work area; the native minimum window size no longer exceeds a small or high-DPI work area.
- Description content is not rewritten when loading existing tasks or switching languages; the activity log stays plain text.

## Windows downloads
- dodrag-windows-amd64.exe: x86-64 Windows (Intel/AMD).
- dodrag-windows-arm64.exe: Windows on ARM64.
No installer is required; download the matching executable.

## Validation
Frontend unit/DOM tests, TypeScript production build and Go tests passed via `build.ps1`. Both executables were packaged with Wails 2.9.2 from this release commit, and their PE machine type was verified as amd64 and arm64. Native WebView2, multi-monitor/DPI, shell integration, and ARM64 hardware execution were not tested.
