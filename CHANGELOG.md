# Changelog

## 0.0.1

- Eyepiece panel: editable view, plain-language request box, in-panel Rust review with Apply/Reject, live Cargo output, draft history, links from view to Rust, and a language switcher for seven languages.
- Any source language: any saved file can be viewed in any supported language, with project-aware checks on Apply and a clear note when no checks ran.
- English view: a plain-English explanation of the file that can be edited or changed by request like any other view.
- Test edit gate: model edits to tests you did not ask to change are blocked until you allow them or apply without them.
- UI: activity bar panel and editor title buttons for the whole loop; Enable Copilot button; model choice remembered per session.
- Fixes: Windows drafts were rejected by Preview; proposals now quote source text instead of offsets; review notes no longer block Preview; blocked choices are shown in output.
- EYE-0: TypeScript extension, settings/commands/status, provider contracts, Rust fixture, CI and VSIX packaging.
- EYE-1: Copilot adapter, persistent editable Python drafts, bounded translation cache, structured response validation, read-only Rust diff preview, explicit Apply, source/draft conflict checks, Cargo check/test and refreshed translation.
- Integration coverage uses real VS Code/Cargo with controlled model responses; live account testing remains manual.
