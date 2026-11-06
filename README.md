# Eyepiece

Read any source file through an editable view in a language you know, or in plain English, then review and explicitly apply the intended change to the original file.

EYE-0 foundation and EYE-1 first working loop are implemented. This is an experimental local VS Code extension. AI translations are approximations; the Rust source remains authoritative.

## Install and use

1. Build locally with `npm ci && npm run package`, or download the `eyepiece-vsix` artifact when available from a successful [GitHub Actions run](https://github.com/maxhightower/Eyepiece/actions). Extract the ZIP, then use **Extensions → … → Install from VSIX**.
2. Open a local Rust/Cargo project in VS Code 1.95 or later. Install Rust/Cargo. Trust the workspace only if you trust its build scripts and tests.
3. Click the **Eyepiece** eye icon in the activity bar and pick an **AI provider**: GitHub Copilot, an Anthropic or OpenAI API key (stored in VS Code secret storage, billed by the provider), Codex with your ChatGPT plan, or Claude Code (personal use). Eyepiece does not supply a subscription or bypass model quotas.
4. Open a saved file and click the **eye button** in the editor title bar, or **Open Eyepiece** in the sidebar. The Eyepiece panel opens to the right, using the **Default model** from the sidebar. To use a different model for this session, change the model dropdown at the bottom of the panel. Grant VS Code's model-access consent if asked.
5. Pick a language from the searchable **Language** dropdown in the panel or the sidebar. Switching retranslates from the Rust; earlier drafts stay available.
6. Make your change either way: type directly in the panel editor and click **Preview Rust Change**, or describe it in the box at the bottom and click **Send**. Neither changes Rust.
7. Review the proposed Rust change in the panel, then click **Apply and Run Checks** and confirm, or **Reject**. Eyepiece runs `cargo check --locked` and `cargo test --locked` and streams the output under **Notes and Cargo output**.
8. On success a fresh view loads. Earlier drafts remain available through **Drafts**. If checks fail, the source change remains for inspection/Undo; the draft is preserved. Undo the Rust edit and save to restore it.

For a dependency-free example, open `fixtures/rust` as the workspace. Ask the Python view to exclude zero scores, then inspect the Rust proposal. Existing tests should continue passing. Adding an active-only filter intentionally conflicts with the existing fixture tests and demonstrates the failed-check path.

**Eyepiece: Open Rust sample** opens an untitled copy for inspection only. Save it inside a Cargo project before translating.

## Current boundaries

- Any saved local text file, up to 100,000 characters, viewed as a plain-English explanation or in Python, Rust, TypeScript, JavaScript, Go, Java, C#, C++, C, Ruby, PHP, Swift, or Kotlin. A file set to its own language shows English.
- Apply runs Cargo for Rust, `go test` for Go, `npm test` for JavaScript and TypeScript with a test script, and `pytest` for Python with a `pyproject.toml`, `pytest.ini`, or `setup.cfg`. Anything else applies with no checks, and Eyepiece says so. Translations can be inaccurate, especially between very different languages.
- Codex and Claude Code run your own installed program with your own sign-in, in an empty temporary folder. Claude Code has all tools off. Codex runs in a read-only sandbox. Check each provider's terms before depending on subscription access, especially in anything you distribute.
- No background requests. Translation cache is bounded and lives only for this VS Code session; saved drafts and baseline metadata persist in extension global storage.
- The selected provider sees the source file, and for proposals the original and edited view. No repository-wide context is sent. No telemetry or Eyepiece server.
- Drafts contain source code in plaintext in VS Code's extension storage. Delete them there when no longer needed. Uninstalling may not remove that storage.
- Structured responses are validated; invalid ranges, overlap, ambiguity, stale revisions, source drift, or changed drafts block Apply. Clicking a linked declaration in an unedited view jumps to its Rust; links stop working once the view is edited.
- Proposals that edit tests need a decision: `#[cfg(test)]` or `#[test]` code in Rust, and any edit mentioning test, assert, or expect in other languages. The exception is editing tests in the view yourself or mentioning tests in your request. Tests elsewhere, such as a `tests/` folder, are outside the single file Eyepiece edits. Recognising your own test edits is a word-based check, so an unrecognised one simply asks you to decide.
- Cargo executes in the trusted project and may run build scripts/tests or fetch dependencies. Checks run after Apply, do not prove semantic equivalence, and do not automatically revert a failed edit.
- File mutation uses VS Code's edit/Undo mechanism. External writers should remain paused during Apply; full filesystem transaction isolation is out of scope.
- Automated integration tests use scripted model responses with real VS Code and Cargo. `npm run test:live` runs the loop against the signed-in Copilot account in the running VS Code, on a temporary fixture copy, and spends quota. It stops before the Apply confirmation dialog when driving the extension commands.

## Development

Node 22+, npm, Rust/Cargo, Python 3; Linux host tests also need Xvfb and VS Code desktop libraries.

```sh
npm ci
npm run check
xvfb-run -a npm run test:host
npm run package
xvfb-run -a npm run verify:package
```

On macOS/Windows, omit `xvfb-run -a`. Press F5 for an Extension Development Host. Host tests use VS Code 1.95.3 (minimum supported line); set `VSCODE_VERSION=stable` to check the current stable version. The suite copies the Rust fixture to a temporary workspace, leaving the repository fixture unchanged. Packaged tests load implementation code from the extracted VSIX.

The headless simulation (`npm run test:headless`, included in `check`) exercises the workflow with simulated VS Code APIs and real files/Cargo; it is not desktop acceptance.

CI checks TypeScript, protocol/config tests, the Rust fixture, real extension-host workflows, and the packaged VSIX, then uploads the installable artifact. See [architecture](docs/architecture.md) and [milestone report](docs/EYE-0-1.md).

## Project status

No Marketplace release or publisher registration has been performed. `maxhightower` is the proposed publisher ID. The repository remains private; licensing is `UNLICENSED` until a public open-source license is chosen. The intended product is a free extension.
