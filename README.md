# Eyepiece

Read Rust through an editable Python view, then review and explicitly apply the intended change to the original Rust.

EYE-0 foundation and EYE-1 first working loop are implemented. This is an experimental local VS Code extension. AI translations are approximations; the Rust source remains authoritative.

## Install and use

1. Build locally with `npm ci && npm run package`, or download the `eyepiece-vsix` artifact when available from a successful [GitHub Actions run](https://github.com/maxhightower/Eyepiece/actions). Extract the ZIP, then use **Extensions → … → Install from VSIX**.
2. Open a local Rust/Cargo project in VS Code 1.95 or later. Install Rust/Cargo. Trust the workspace only if you trust its build scripts and tests.
3. Enable GitHub Copilot in VS Code and sign in. Set `eyepiece.provider` to `copilot`. Eyepiece uses models available through your VS Code account; it does not supply a subscription or bypass model quotas.
4. Open a saved `.rs` file and run **Eyepiece: Open Python view**. Choose a model if prompted and grant VS Code's model-access consent.
5. Edit the Python draft. **Save only saves the draft**, never Rust.
6. Run **Eyepiece: Preview source change** from the Python draft. Inspect the read-only Rust diff and Eyepiece output for explanation/caveats.
7. Return to that Python draft and run **Eyepiece: Apply reviewed source change**. Confirm the source save and Cargo execution. Eyepiece runs `cargo check --locked` and `cargo test --locked`.
8. On success a fresh Python view opens. The old draft remains available through **Eyepiece: Reopen saved draft**. If checks fail, the source change remains for inspection/Undo; the draft is preserved. Undo the Rust edit and save to restore it.

For a dependency-free example, open `fixtures/rust` as the workspace. Ask the Python view to exclude zero scores, then inspect the Rust proposal. Existing tests should continue passing. Adding an active-only filter intentionally conflicts with the existing fixture tests and demonstrates the failed-check path.

**Eyepiece: Open Rust sample** opens an untitled copy for inspection only. Save it inside a Cargo project before translating.

## Current boundaries

- Rust → Python only; one saved local Rust file, maximum 100,000 characters.
- Copilot is the only implemented model adapter. ChatGPT and Claude Code settings are reserved and explicitly rejected.
- No background requests. Translation cache is bounded and lives only for this VS Code session; saved drafts and baseline metadata persist in extension global storage.
- The model sees the selected source, and for proposals the original and edited Python. No repository-wide context is sent. No telemetry or Eyepiece server.
- Drafts contain source code in plaintext in VS Code's extension storage. Delete them there when no longer needed. Uninstalling may not remove that storage.
- Structured responses are validated; invalid ranges, overlap, ambiguity, stale revisions, source drift, or changed drafts block Apply. Source mappings/caveats are stored; mappings do not yet provide navigation.
- Cargo executes in the trusted project and may run build scripts/tests or fetch dependencies. Checks run after Apply, do not prove semantic equivalence, and do not automatically revert a failed edit.
- File mutation uses VS Code's edit/Undo mechanism. External writers should remain paused during Apply; full filesystem transaction isolation is out of scope.
- Live Copilot account/authentication and model quality require a manual smoke test; automated integration tests use scripted model responses with real VS Code and Cargo.

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
