# Eyepiece

**See code in a language you understand. Make changes with confidence.**

Eyepiece is an experimental VS Code extension that lets you open a source file as an editable view in another programming language—or as a plain-English explanation. Edit the view or describe the change you want, inspect the proposed modification to the original source, and explicitly approve it before anything is applied.

> **Early development · v0.0.1** — Available to build and install locally. Not yet published to the VS Code Marketplace. AI-generated translations and edits require careful review.

## Why Eyepiece?

You shouldn't need to be fluent in every language in a repository to understand or contribute to it.

Eyepiece gives you a familiar perspective on unfamiliar code while keeping the **original source file authoritative**. It is a translation and change-review workflow, not a promise of exact cross-language equivalence or an automatic repository migration.

## Features

- **Read in your language:** View a saved local source file as Python, Rust, TypeScript, JavaScript, Go, Java, C#, C++, C, Ruby, PHP, Swift, Kotlin, or plain English.
- **Edit the translated view:** Work directly in the familiar representation, or request an edit in natural language.
- **Preview before applying:** Review the proposed change to the actual source and choose whether to apply or reject it.
- **Navigate corresponding code:** Linked blocks help you move between the original file and the translated view.
- **Keep drafts:** Revisit earlier drafts during your VS Code session and reopen saved drafts.
- **Bring your own AI:** Use GitHub Copilot, OpenAI or Anthropic API keys, or supported local Codex and Claude Code installations. Provider availability and billing depend on your own account.
- **Run project checks:** After applying, Eyepiece can run supported project tests or checks and display their output.

## How it works

1. **Open** a saved file in a trusted local VS Code workspace.
2. **Choose** an AI provider and the language you want to work in.
3. **Explore** the translated view alongside your original file.
4. **Edit** the view or describe the intended change.
5. **Preview** the proposed source edit and explicitly approve or reject it.
6. **Check** the result using available project-specific commands.

**Your original file is not changed by translating, editing the view, or generating a preview.** It changes only when you approve Apply. Checks run *after* Apply; a failed check does not automatically roll back the change. Use VS Code Undo if necessary.

## Get started

### Requirements

- VS Code **1.95+**
- A trusted **local** workspace and a saved source file
- Your own configured AI provider
- Relevant project tooling if you want automated checks (for example, Rust/Cargo)

### Install from source

```bash
git clone https://github.com/maxhightower/Eyepiece.git
cd Eyepiece
npm ci
npm run package
```

In VS Code, open **Extensions → … → Install from VSIX**, select `eyepiece-0.0.1.vsix`, and reload if prompted.

Alternatively, download an `eyepiece-vsix` artifact from a successful [GitHub Actions run](https://github.com/maxhightower/Eyepiece/actions), extract it, and install the included VSIX.

### First translation

1. Open the **Eyepiece** activity-bar icon.
2. Select a provider and default model. API keys are stored using VS Code secret storage where applicable.
3. Open a saved file and click the **eye icon** in the editor title bar (or choose **Open Eyepiece** in the sidebar).
4. Select a language in the panel, then edit its contents or send an instruction.
5. Click **Preview Rust Change** / **Preview Source Change** as offered by the UI. Inspect the result and choose **Apply and Run Checks** or **Reject**.

For a self-contained example, open `fixtures/rust` as your workspace, translate its Rust source to Python, and try asking for a small behavioral change. The fixture is designed to exercise both passing and failing check paths.

## Supported checks

| Source project | After-Apply command |
| --- | --- |
| Rust / Cargo | `cargo check --locked`, then `cargo test --locked` |
| Go | `go test` |
| JavaScript / TypeScript | `npm test` when a test script exists |
| Python | `pytest` when a supported project configuration exists |
| Other or unconfigured projects | No automatic checks; Eyepiece indicates this |

These checks are safeguards, **not proof that a translation preserves behavior**. Review the proposed diff and use your project's own tests.

## Privacy and safety

- Eyepiece does **not** make background model requests. Requests are initiated through extension actions.
- Your selected provider receives the source file and, when preparing edits, the original and edited view. No repository-wide context is sent.
- There is no Eyepiece-operated backend or telemetry.
- Translation cache is session-bounded; drafts and baseline metadata are stored by VS Code. **Saved drafts can contain source code in plaintext** in extension storage.
- Codex and Claude Code integrations use your installed CLI and sign-in, subject to provider terms and quotas.
- Running project checks may execute build scripts, tests, or dependency downloads. Only trust projects whose code you are willing to execute.

See [Architecture](docs/architecture.md) for implementation details and the [EYE-0/EYE-1 report](docs/EYE-0-1.md) for the initial milestone.

## Development

Prerequisites: Node.js **22+**, npm, Rust/Cargo, and Python 3. Linux extension-host testing additionally needs Xvfb and VS Code desktop dependencies.

```bash
npm ci
npm run check
npm run test:host
npm run package
npm run verify:package
```

On a headless Linux machine, run host and package-verification commands under `xvfb-run -a`. Press **F5** in VS Code to launch an Extension Development Host.

- `npm run check`: unit tests, Rust fixture tests, and headless workflow simulation.
- `npm run test:host`: real VS Code extension-host integration tests.
- `npm run verify:package`: tests the packaged VSIX.
- `npm run test:live`: optional live provider test that consumes account quota.

CI runs the extension and packaging checks and publishes a VSIX build artifact when successful.

## Status and roadmap

The first working extension workflow is implemented, but Eyepiece remains experimental. Current limitations include approximate model translations, single-file source changes, local-file-only workspaces, and project checks that do not automatically revert failures.

Near-term priorities are improving translation fidelity, review ergonomics, reliability across languages, and the installation/onboarding experience. Issues and focused pull requests are welcome.

## Contributing

Found a translation mismatch, confusing review flow, or unsupported project layout? [Open an issue](https://github.com/maxhightower/Eyepiece/issues) with a minimal reproducible example, VS Code version, language pair, provider type, and expected versus actual behavior. **Remove secrets and proprietary code before sharing logs or examples.**

For a code contribution, open an issue for larger changes, keep pull requests focused, and run `npm run check` before submitting.

## License

**Source-available, not yet open-source licensed.** The package currently declares `UNLICENSED`; no open-source license has been selected. Public GitHub visibility does not grant permission to redistribute or reuse the code beyond applicable law. A license must be added before describing Eyepiece as open source.
