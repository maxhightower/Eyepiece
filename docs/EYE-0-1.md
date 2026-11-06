# EYE-0 / EYE-1 implementation report

## Delivered

EYE-0: TypeScript extension scaffold, eight registered commands, settings/status, model-provider contract, Rust fixture, CI, and VSIX packaging.

EYE-1: Copilot Language Model API adapter, Rust → editable Python views, persistent drafts/baselines, bounded translation cache, structured response validation, immutable Rust diff preview, explicit Apply, stale source/draft checks, Cargo check/test, and refreshed translation after successful checks. Original drafts remain recoverable.

## Validation

- TypeScript strict compilation: passed locally.
- Eight unit tests: passed locally (config, cancellation, unavailable providers, schema/ranges/overlap/Unicode/stale revisions/ambiguity).
- Three Rust fixture tests: passed locally.
- Desktop integration suite: covers activation/commands/sample isolation, Copilot adapter streaming/error handling with controlled responses, draft save isolation, cache, diff preview, declined Apply, source/draft conflicts, cancellation, real Cargo failure, real successful Cargo check/test, and refresh.
- The local sandbox cannot start VS Code Electron (SIGSEGV before extension activation), even with a working virtual display. GitHub Actions is the desktop/packaged acceptance gate; consult its result for this commit.
- No signed-in Copilot session is available in the build environment. Live authentication, quota behavior, and actual model translation quality remain a manual acceptance gate. Automated tests never claim a live AI request.

## Manual live acceptance

Install the VSIX in VS Code with Copilot access. Open fixtures/rust as a trusted workspace; set eyepiece.provider=copilot. Open src/lib.rs, translate, add a nonzero-score filter in Python, save, preview the Rust diff, return to the draft and Apply. Confirm Cargo check/test passes and a refreshed view appears. Verify the original draft can reopen. Repeat with an active-only filter to exercise existing-test failure and Undo.

No public repository change, Marketplace publication, or extra model-provider integration has been performed.
