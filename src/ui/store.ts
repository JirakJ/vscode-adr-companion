import * as path from 'node:path';
import * as vscode from 'vscode';
import { EffectiveSettings, ProjectConfig, UserSettings, resolveSettings } from '../core/config';
import { AdrRecord, parseAdr } from '../core/parser';
import { parseFormat } from '../core/templates';
import { detectAdrDirectory, loadRecords, readProjectConfig } from '../node/workspace';

export interface FolderState {
  folder: vscode.WorkspaceFolder;
  root: string;
  /** ADR directory relative to the folder root ('' when none could be found). */
  adrDir: string;
  dirExists: boolean;
  config: ProjectConfig | null;
  configFile: string | null;
  settings: EffectiveSettings;
  records: AdrRecord[];
}

export function readUserSettings(scope?: vscode.Uri): UserSettings {
  const c = vscode.workspace.getConfiguration('adrCompanion', scope);
  return {
    directory: c.get<string>('directory', '').trim(),
    defaultFormat: parseFormat(c.get<string>('defaultFormat', 'nygard')) ?? 'nygard',
    maxProposedAgeDays: Math.max(1, c.get<number>('maxProposedAgeDays', 30)),
    stalenessThresholdDays: Math.max(0, c.get<number>('stalenessThresholdDays', 0)),
    customTemplatePath: c.get<string>('customTemplatePath', '').trim(),
    requireAdrForPaths: c.get<string[]>('requireAdrForPaths', []).filter((p) => typeof p === 'string' && p.trim()),
  };
}

function samePath(a: string, b: string): boolean {
  const n = (p: string) => path.normalize(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' || process.platform === 'darwin'
    ? n(a).toLowerCase() === n(b).toLowerCase()
    : n(a) === n(b);
}

export class AdrStore implements vscode.Disposable {
  private states: FolderState[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private watchers: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private loaded = false;

  constructor() {
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/.adr-config.{yaml,yml}');
    this.disposables.push(
      configWatcher,
      configWatcher.onDidChange(() => this.scheduleRefresh()),
      configWatcher.onDidCreate(() => this.scheduleRefresh()),
      configWatcher.onDidDelete(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('adrCompanion')) this.scheduleRefresh();
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (this.isAdrFile(doc.uri)) this.scheduleRefresh();
      }),
      this.emitter,
    );
  }

  get folders(): readonly FolderState[] {
    return this.states;
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  allRecords(): AdrRecord[] {
    return this.states.flatMap((s) => s.records);
  }

  scheduleRefresh(delay = 300): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  async refresh(): Promise<void> {
    if (this.running) {
      await this.running;
    }
    this.running = this.load().finally(() => {
      this.running = undefined;
    });
    await this.running;
  }

  private async load(): Promise<void> {
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file');
    const states: FolderState[] = [];
    for (const folder of folders) {
      const root = folder.uri.fsPath;
      const team = await readProjectConfig(root);
      const settings = resolveSettings(readUserSettings(folder.uri), team?.config ?? null);
      const located = await detectAdrDirectory(root, settings.directory);
      const adrDir = located?.dir ?? '';
      const dirExists = located?.exists ?? false;
      const records = dirExists ? await loadRecords(path.join(root, adrDir)) : [];
      states.push({ folder, root, adrDir, dirExists, config: team?.config ?? null, configFile: team?.file ?? null, settings, records });
    }
    this.states = states;
    this.loaded = true;
    this.rewatch();
    void vscode.commands.executeCommand('setContext', 'adrCompanion.hasAdrs', this.allRecords().length > 0);
    this.emitter.fire();
  }

  private rewatch(): void {
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
    for (const s of this.states) {
      if (!s.dirExists) continue;
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.join(s.root, s.adrDir)), '*.md'));
      this.watchers.push(w, w.onDidCreate(() => this.scheduleRefresh()), w.onDidDelete(() => this.scheduleRefresh()), w.onDidChange(() => this.scheduleRefresh()));
    }
  }

  stateFor(uri: vscode.Uri | undefined): FolderState | undefined {
    if (!uri) return undefined;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? this.states.find((s) => s.folder.uri.toString() === folder.uri.toString()) : undefined;
  }

  adrDirectoryOf(state: FolderState): string {
    return path.join(state.root, state.adrDir || 'docs/adr');
  }

  isAdrFile(uri: vscode.Uri): boolean {
    if (uri.scheme !== 'file' || !uri.fsPath.toLowerCase().endsWith('.md')) return false;
    const state = this.stateFor(uri);
    if (!state || !state.adrDir) return false;
    return samePath(path.dirname(uri.fsPath), path.join(state.root, state.adrDir));
  }

  recordFor(uri: vscode.Uri): AdrRecord | undefined {
    return this.allRecords().find((r) => samePath(r.filePath, uri.fsPath));
  }

  /** Number → record for the folder containing `uri` (or the first folder). */
  index(uri?: vscode.Uri): Map<number, AdrRecord> {
    const state = this.stateFor(uri) ?? this.states[0];
    return byId(state ? this.liveRecords(state) : []);
  }

  /** Records with unsaved editor content substituted in, for live diagnostics. */
  liveRecords(state: FolderState): AdrRecord[] {
    const dirty = new Map<string, vscode.TextDocument>();
    for (const doc of vscode.workspace.textDocuments) if (doc.isDirty && doc.uri.scheme === 'file') dirty.set(path.normalize(doc.uri.fsPath), doc);
    const records = state.records.map((r) => {
      const doc = dirty.get(path.normalize(r.filePath));
      return doc ? parseAdr(doc.getText(), r.filePath) : r;
    });
    // New, never-saved-to-disk-yet records open in an editor.
    for (const doc of dirty.values()) {
      if (this.isAdrFile(doc.uri) && this.stateFor(doc.uri) === state && !records.some((r) => samePath(r.filePath, doc.uri.fsPath))) {
        records.push(parseAdr(doc.getText(), doc.uri.fsPath));
      }
    }
    return records;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const w of this.watchers) w.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

export function byId(records: AdrRecord[]): Map<number, AdrRecord> {
  const map = new Map<number, AdrRecord>();
  for (const r of [...records].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
    if (r.id != null && !map.has(r.id)) map.set(r.id, r);
  }
  return map;
}
