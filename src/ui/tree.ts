import * as vscode from 'vscode';
import { AdrRecord, formatId } from '../core/parser';
import { AdrStatus, STATUS_ORDER, statusDisplayName } from '../core/status';
import { timeline } from '../core/summary';
import { AdrStore, FolderState } from './store';

export type ViewMode = 'status' | 'timeline' | 'flat';

type Node =
  | { kind: 'folder'; state: FolderState }
  | { kind: 'group'; label: string; records: AdrRecord[]; icon: vscode.ThemeIcon }
  | { kind: 'record'; record: AdrRecord };

const ICONS: Record<AdrStatus, [string, string | undefined]> = {
  accepted: ['pass-filled', 'testing.iconPassed'],
  proposed: ['circle-large-outline', 'charts.blue'],
  draft: ['edit', undefined],
  deprecated: ['warning', 'list.warningForeground'],
  superseded: ['arrow-swap', 'disabledForeground'],
  rejected: ['circle-slash', 'errorForeground'],
  unknown: ['question', undefined],
};

export function statusIcon(status: AdrStatus): vscode.ThemeIcon {
  const [id, color] = ICONS[status];
  return new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);
}

export function recordLabel(r: AdrRecord): string {
  return `${r.id != null ? formatId(r.id) : '????'} · ${r.title || r.fileName}`;
}

export class AdrTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly sub: vscode.Disposable;

  constructor(
    private readonly store: AdrStore,
    private mode: ViewMode,
  ) {
    this.sub = store.onDidChange(() => this.emitter.fire(undefined));
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    this.emitter.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const withRecords = this.store.folders.filter((s) => s.records.length > 0);
      if (withRecords.length > 1) return withRecords.map((state) => ({ kind: 'folder', state }));
      return withRecords.length === 1 ? this.groups(withRecords[0]!.records) : [];
    }
    if (node.kind === 'folder') return this.groups(node.state.records);
    if (node.kind === 'group') return node.records.map((record) => ({ kind: 'record', record }));
    return [];
  }

  private groups(records: AdrRecord[]): Node[] {
    const sorted = [...records].sort((a, b) => (a.id ?? 1e9) - (b.id ?? 1e9) || a.fileName.localeCompare(b.fileName));
    if (this.mode === 'flat') return sorted.map((record) => ({ kind: 'record', record }));
    if (this.mode === 'timeline') {
      return timeline(records).map((g) => ({
        kind: 'group',
        label: g.period === 'Undated' ? 'Undated' : monthLabel(g.period),
        records: g.records,
        icon: new vscode.ThemeIcon('calendar'),
      }));
    }
    return STATUS_ORDER.map((s) => ({ s, rs: sorted.filter((r) => r.status === s) }))
      .filter((g) => g.rs.length > 0)
      .map((g) => ({ kind: 'group', label: statusDisplayName(g.s), records: g.rs, icon: statusIcon(g.s) }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'folder') {
      const item = new vscode.TreeItem(node.state.folder.name, vscode.TreeItemCollapsibleState.Expanded);
      item.description = node.state.adrDir;
      item.iconPath = new vscode.ThemeIcon('root-folder');
      return item;
    }
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(node.records.length);
      item.iconPath = node.icon;
      item.contextValue = 'adrGroup';
      return item;
    }
    const r = node.record;
    const item = new vscode.TreeItem(recordLabel(r), vscode.TreeItemCollapsibleState.None);
    item.resourceUri = vscode.Uri.file(r.filePath);
    item.description = [this.mode === 'status' ? '' : statusDisplayName(r.status), r.date ?? ''].filter(Boolean).join(' · ');
    item.iconPath = statusIcon(r.status);
    item.contextValue = 'adr';
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**ADR-${r.id != null ? formatId(r.id) : '?'}** ${escapeMd(r.title)}\n\n`);
    md.appendMarkdown(`${statusDisplayName(r.status)}${r.date ? ` · ${r.date}` : ''}`);
    if (r.supersededBy.length) md.appendMarkdown(` · superseded by ${r.supersededBy.map((s) => `ADR-${formatId(s)}`).join(', ')}`);
    if (r.context) md.appendMarkdown(`\n\n${escapeMd(excerpt(r.context, 280))}`);
    item.tooltip = md;
    item.command = { command: 'vscode.open', title: 'Open ADR', arguments: [vscode.Uri.file(r.filePath)] };
    return item;
  }

  dispose(): void {
    this.sub.dispose();
    this.emitter.dispose();
  }
}

function monthLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[(m ?? 1) - 1]} ${y}`;
}

export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function escapeMd(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
