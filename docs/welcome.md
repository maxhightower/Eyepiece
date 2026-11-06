# Eyepiece — EYE-0 + EYE-1

The Rust file remains authoritative. Python is an editable AI-generated view.

Click the Eyepiece icon in the activity bar and choose an AI provider. Open a saved Rust file in a trusted Cargo workspace and click the eye button at the top of the editor. VS Code handles model selection and access consent.

Edit and save the Python draft, then **Preview source change**. Inspect the Rust diff, return to the Python draft, and **Apply reviewed source change**. Confirmation saves Rust and runs Cargo check/test. Successful checks open a refreshed Python view. Failed checks leave the Rust edit for review or Undo; your draft is preserved.

Use **Reopen saved draft** after restarting VS Code. Caveats and check results appear in the Eyepiece output channel. Saving Python never applies Rust changes. Source/draft drift requires a fresh preview or translation.

Any saved file can be viewed in plain English or another programming language. Choose your AI provider in the sidebar. No AI account is included. No telemetry. Source/drafts are sent to the selected Copilot model on request. Drafts and source snapshots are saved locally in extension storage.
