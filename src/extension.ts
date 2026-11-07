import * as vscode from 'vscode';
import { Workflow } from './workflow';
import { EyepiecePanel } from './panel';
import { EyepieceSidebar } from './sidebar';
import { ProviderSelector } from './providers/select';
import { describeStatus, LanguageOption, normalizeSettings, pickModel, ProviderId, providerLabels } from './config';
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Eyepiece');
  const badge = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  const settings = () => {
    const config = vscode.workspace.getConfiguration('eyepiece');
    return normalizeSettings(config.get('provider'), config.get('targetLanguage'));
  };
  const refresh = () => {
    badge.text = '$(eye) Eyepiece';
    badge.tooltip = describeStatus(settings());
    badge.command = 'eyepiece.showStatus';
  };
  const setLanguage = async (id: string) => { await vscode.workspace.getConfiguration('eyepiece').update('targetLanguage', id, vscode.ConfigurationTarget.Global); };
  // Workflow and check output also streams into the panel, which replaces the output tab as the place to look.
  const channel = new Proxy(output, { get(target, key: keyof vscode.OutputChannel) {
    if (key === 'append' || key === 'appendLine') return (value: string) => { target[key](value); panel.log(key === 'append' ? value : value + '\n'); };
    if (key === 'show') return () => undefined;
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const selector = new ProviderSelector(context);
  // The sidebar sets the lasting default. The panel can override it until the provider or default changes.
  let models: LanguageOption[] = [], panelModel: string | undefined, modelError = '';
  const ids = () => models.map(item => item.id);
  const defaultModel = () => pickModel(ids(), selector.savedModel(settings().provider)) ?? '';
  const refreshModels = async () => {
    try { models = await selector.models(settings().provider); modelError = ''; }
    catch (error) { models = []; modelError = error instanceof Error ? error.message : String(error); }
    sidebar.update(); panel.refresh();
  };
  const setProvider = async (id: string) => {
    await vscode.workspace.getConfiguration('eyepiece').update('provider', id, vscode.ConfigurationTarget.Global);
    try { await selector.ensureKey(id as ProviderId); } catch (error) { if (!(error instanceof vscode.CancellationError)) throw error; }
    await refreshModels();
  };
  const setDefaultModel = async (id: string) => { panelModel = undefined; await selector.saveModel(settings().provider, id); sidebar.update(); panel.refresh(); };
  const workflow = new Workflow(vscode.Uri.joinPath(context.globalStorageUri, 'drafts'), channel, async () => selector.select(settings().provider, panelModel));
  const updateButtons = () => {
    sidebar.update();
  };
  const panel: EyepiecePanel = new EyepiecePanel(context.extensionUri, workflow, () => settings().targetLanguage, setLanguage, updateButtons, () => providerLabels[settings().provider], () => ({ models, model: pickModel(ids(), selector.savedModel(settings().provider), panelModel) ?? '' }), id => { panelModel = id; panel.refresh(); });
  const sidebar: EyepieceSidebar = new EyepieceSidebar(context.extensionUri, () => ({ provider: settings().provider as ProviderId, language: settings().targetLanguage, panelOpen: panel.isOpen, previewReady: panel.hasReview && !panel.needsTestDecision, models, model: defaultModel(), modelError }), setLanguage, setProvider, setDefaultModel, refreshModels);
  const isSource = (doc: vscode.TextDocument) => doc.uri.scheme === 'file';
  context.subscriptions.push(output, badge, workflow, panel,
    vscode.window.registerWebviewViewProvider('eyepiece.actions', sidebar),
    vscode.commands.registerCommand('eyepiece.openWelcome', async () => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(context.extensionUri, 'docs', 'welcome.md'));
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('eyepiece.openSample', async () => {
      // Copy into an untitled buffer, so editing cannot modify packaged resources.
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'fixtures', 'rust', 'src', 'lib.rs'));
      const doc = await vscode.workspace.openTextDocument({ language: 'rust', content: Buffer.from(bytes).toString('utf8') });
      await vscode.window.showTextDocument(doc, { preview: false });
      return doc.uri.toString();
    }),
    vscode.commands.registerCommand('eyepiece.showStatus', () => {
      const status = describeStatus(settings());
      output.clear(); output.appendLine(status); output.show(true);
      return status;
    }),
    vscode.commands.registerCommand('eyepiece.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:maxhightower.eyepiece')),
    vscode.commands.registerCommand('eyepiece.enableCopilot', () => vscode.workspace.getConfiguration('eyepiece').update('provider', 'copilot', vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('eyepiece.setApiKey', async () => {
      const provider = settings().provider;
      try { if (provider === 'anthropic' || provider === 'openai') { await selector.askForKey(provider); await refreshModels(); } }
      catch (error) { if (!(error instanceof vscode.CancellationError)) throw error; }
    }),
    vscode.commands.registerCommand('eyepiece.translate', async () => {
      const active = vscode.window.activeTextEditor?.document;
      const doc = active && isSource(active) ? active : vscode.window.visibleTextEditors.map(editor => editor.document).find(isSource);
      if (!doc) { await vscode.window.showErrorMessage('Open a saved file first.'); return; }
      void refreshModels();
      await panel.open(doc);
    }),
    vscode.commands.registerCommand('eyepiece.preview', () => panel.preview()),
    vscode.commands.registerCommand('eyepiece.apply', () => panel.apply()),
    vscode.commands.registerCommand('eyepiece.reopenDraft', () => panel.openDrafts()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('eyepiece')) return;
      refresh();
      if (event.affectsConfiguration('eyepiece.provider')) { panelModel = undefined; void refreshModels(); } else { sidebar.update(); panel.refresh(); }
      if (event.affectsConfiguration('eyepiece.targetLanguage')) void panel.languageChanged();
    }),
  );
  refresh(); updateButtons(); badge.show();
}
export function deactivate(): void { /* All resources are owned by context.subscriptions. */ }
