# Eyepiece

Read Rust through an editable view in a language you know, then review and explicitly apply the intended change to the original Rust.

EYE-0 foundation and EYE-1 first working loop are implemented. This is an experimental local VS Code extension. AI translations are approximations; the Rust source remains authoritative.

## Install and use

1. Build locally with `npm ci && npm run package`, or download the `eyepiece-vsix` artifact when available from a successful [GitHub Actions run](https://github.com/maxhightower/Eyepiece/actions). Extract the ZIP, then use **Extensions → … → Install from VSIX**.
2. Open a local Rust/Cargo project in VS Code 1.95 or later. Install Rust/Cargo. Trust the workspace only if you trust its build scripts and tests.
3. Click the **Eyepiece** eye icon in the activity bar, then **Enable Copilot**. Sign in to GitHub Copilot in VS Code if you have not already. Eyepiece uses models available through your VS Code account; it does not supply a subscription or bypass model quotas.
4. Open a saved `.rs` file and click the **eye button** in the editor title bar, or **Open Eyepiece** in the sidebar. The Eyepiece panel opens to the right. Choose a model the first time (it is remembered until VS Code restarts) and grant VS Code's model-access consent.
5. Pick a language from the searchable **Language** dropdown in the panel or the sidebar. Switching retranslates from the Rust; earlier drafts stay available.
6. Make your change either way: type directly in the panel editor and click **Preview Rust Change**, or describe it in the box at the bottom and click **Send**. Neither changes Rust.
7. Review the proposed Rust change in the panel, then click **Apply and Run Checks** and confirm, or **Reject**. Eyepiece runs `cargo check --locked` and `cargo test --locked` and streams the output under **Notes and Cargo output**.
8. On success a fresh view loads. Earlier drafts remain available through **Drafts**. If checks fail, the source change remains for inspection/Undo; the draft is preserved. Undo the Rust edit and save to restore it.

For a dependency-free example, open `fixtures/rust` as the workspace. Ask the Python view to exclude zero scores, then inspect the Rust proposal. Existing tests should continue passing. Adding an active-only filter intentionally conflicts with the existing fixture tests and demonstrates the failed-check path.

**Eyepiece: Open Rust sample** opens an untitled copy for inspection only. Save it inside a Cargo project before translating.

## Current boundaries

- Rust source only, viewed as a plain-English explanation or as Python, TypeScript, JavaScript, Go, Java, C#, or C++; one saved local Rust file, maximum 100,000 characters.
- Copilot is the only implemented model adapter. ChatGPT and Claude Code settings are reserved and explicitly rejected.
- No background requests. Translation cache is bounded and lives only for this VS Code session; saved drafts and baseline metadata persist in extension global storage.
- The model sees the selected source, and for proposals the original and edited Python. No repository-wide context is sent. No telemetry or Eyepiece server.
- Drafts contain source code in plaintext in VS Code's extension storage. Delete them there when no longer needed. Uninstalling may not remove that storage.
- Structured responses are validated; invalid ranges, overlap, ambiguity, stale revisions, source drift, or changed drafts block Apply. Clicking a linked declaration in an unedited view jumps to its Rust; links stop working once the view is edited.
- Proposals that edit `#[cfg(test)]` or `#[test]` code in the file need a decision unless you edited tests in the view or mentioned tests in your request. Tests elsewhere, such as a `tests/` folder, are outside the single file Eyepiece edits. Recognising your own test edits is a word-based check, so an unrecognised one simply asks you to decide.
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
