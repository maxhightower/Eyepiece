# Architecture

`extension.ts` owns commands, progress/cancellation, settings, status, and resource disposal. `Workflow` coordinates snapshots, drafts, immutable previews, explicit application, checks, and refresh. `core.ts` validates structured output and applies bounded UTF-16 replacements without VS Code dependencies.

`ModelProvider` has translation and edit-proposal methods. `CopilotProvider` selects a model via the stable VS Code Language Model API during user commands. Requests are bounded by input tokens, a 120-second timeout, and a 1 MB response limit. Providers cannot execute commands or write files. Unknown/malformed JSON and ambiguous proposals fail closed; no automatic repair requests occur.

## State flow

Saved Rust → SHA-256 snapshot → translation → editable Python file + JSON baseline in global storage → edited draft → validated proposal → read-only before/after diff → explicit confirmation → source edit/save → Cargo check/test → new translation draft.

Source text, on-disk text, and draft contents are rechecked around asynchronous operations. Dirty source documents cannot be applied. A preview is invalid if its draft changes. Failed proposals never mutate source. Failed post-apply checks retain the change for visible review and Undo; old drafts are preserved. Concurrent Eyepiece commands are serialized. Full isolation from external processes is not promised.

The cache key includes provider/model ID, URI, source SHA-256, and target language. Cache capacity is 20 and is session-local. Every draft has persistent source identity, snapshot, baseline translation, mappings, caveats, and provider ID. Proposals are deliberately not persisted: restart requires a new preview. Reopen lists stored drafts; there is no automatic cleanup yet.

## Validation boundary

Cargo discovery stays within the source workspace folder. Apply confirmation names the check/test execution and failure behavior. Only trusted local workspaces can translate, apply, or execute Cargo. Cargo uses fixed arguments and no shell, but project build scripts/tests retain normal project privileges. Two-minute timeouts bound each Cargo command.

Tests inject a scripted ModelProvider and confirmation callback into the same Workflow loaded from the installed package. They use real VS Code documents, diff editors, workspace edits, saved files, and Cargo subprocesses. These prove orchestration and failure behavior, not live Copilot quality or semantic equivalence.

## Next work

Live Copilot acceptance on a signed-in machine, stronger validation/isolation, draft lifecycle UI, mapping navigation, additional providers, and broader language/project support. EYE-0/EYE-1 do not authorize a public Marketplace release.
