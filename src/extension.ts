import * as vscode from 'vscode';
import { STATUS_ORDER, statusDisplayName } from './core/status';
import { countByStatus } from './core/summary';
import { registerCommands } from './ui/commands';
import { AdrDiagnostics } from './ui/diagnostics';
import { registerLanguageFeatures } from './ui/language';
import { AdrStore } from './ui/store';
import { AdrTreeProvider, ViewMode } from './ui/tree';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('ADR Companion');
  const store = new AdrStore();
  const mode = vscode.workspace.getConfiguration('adrCompanion').get<ViewMode>('view.mode', 'status');
  const tree = new AdrTreeProvider(store, mode);
  const view = vscode.window.createTreeView('adrCompanion.adrs', { treeDataProvider: tree, showCollapseAll: true });
  const diagnostics = new AdrDiagnostics(store);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'adrCompanion.adrs.focus';
  const updateStatus = () => {
    const records = store.allRecords();
    const enabled = vscode.workspace.getConfiguration('adrCompanion').get<boolean>('statusBar.enabled', true);
    if (!enabled || records.length === 0) {
      status.hide();
      return;
    }
    const counts = countByStatus(records);
    status.text = `$(law) ADR: ${records.length}`;
    status.tooltip = `Architecture decision records\n${STATUS_ORDER.filter((s) => counts.get(s))
      .map((s) => `${statusDisplayName(s)}: ${counts.get(s)}`)
      .join('\n')}`;
    view.description = `${records.length}`;
    status.show();
  };

  context.subscriptions.push(
    output,
    store,
    tree,
    view,
    diagnostics,
    status,
    store.onDidChange(updateStatus),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('adrCompanion.view.mode')) {
        tree.setMode(vscode.workspace.getConfiguration('adrCompanion').get<ViewMode>('view.mode', 'status'));
      }
      if (e.affectsConfiguration('adrCompanion.statusBar.enabled')) updateStatus();
      if (e.affectsConfiguration('adrCompanion.lint') || e.affectsConfiguration('adrCompanion.referenceCheck')) diagnostics.refreshAll();
    }),
    ...registerLanguageFeatures(store),
    ...registerCommands({ store, tree, diagnostics, output, version: String(context.extension.packageJSON.version ?? '1.0.0') }),
  );

  void store.refresh();
}

export function deactivate(): void {
  // disposables are released through context.subscriptions
}
