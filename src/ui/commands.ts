import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ciWorkflow } from '../core/ciWorkflow';
import { configTemplate } from '../core/config';
import { evaluateGovernance } from '../core/governance';
import { buildGraph, renderDot, renderMermaid } from '../core/graph';
import { addSupersedesBacklink, setStatus } from '../core/lifecycle';
import {
  analyzeNumbering,
  countReferences,
  renamedFileName,
  rewriteAdrDocument,
  rewriteReferences,
  validateRenumber,
} from '../core/numbering';
import { AdrRecord, formatId } from '../core/parser';
import { extractDecision } from '../core/pullRequest';
import { annotationLine, findMentions } from '../core/references';
import { AdrStatus, SETTABLE_STATUSES, isTransitionAllowed, statusDisplayName } from '../core/status';
import { IndexGrouping, renderIndex, renderSummary } from '../core/summary';
import {
  AdrFormat,
  CUSTOM_TEMPLATE_NAMES,
  FORMATS,
  adrFileName,
  renderFilled,
  renderTemplate,
  substitutePlaceholders,
  todayIso,
} from '../core/templates';
import { changedFilesIncludingWorkingTree, defaultBaseRef, readMergeCommits, repoRoot } from '../node/git';
import { AdrDiagnostics } from './diagnostics';
import { AdrStore, FolderState } from './store';
import { AdrTreeProvider, ViewMode, excerpt, recordLabel } from './tree';

const SCAN_EXCLUDE = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/target/**,**/.next/**,**/coverage/**,**/vendor/**,**/*.vsix}';
const MAX_SCAN_FILES = 10_000;
const MAX_SCAN_BYTES = 1024 * 1024;

export interface Context {
  store: AdrStore;
  tree: AdrTreeProvider;
  diagnostics: AdrDiagnostics;
  output: vscode.OutputChannel;
  version: string;
}

// ---------------------------------------------------------------- helpers --

async function pickState(store: AdrStore, preferUri?: vscode.Uri): Promise<FolderState | undefined> {
  await ensureLoaded(store);
  const fromUri = store.stateFor(preferUri ?? vscode.window.activeTextEditor?.document.uri);
  if (fromUri) return fromUri;
  const states = store.folders;
  if (states.length === 0) {
    void vscode.window.showWarningMessage('ADR Companion needs an open folder or workspace.');
    return undefined;
  }
  if (states.length === 1) return states[0];
  const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Which workspace folder?' });
  return folder ? states.find((s) => s.folder.uri.toString() === folder.uri.toString()) : undefined;
}

async function ensureLoaded(store: AdrStore): Promise<void> {
  if (!store.isLoaded) await store.refresh();
}

function argUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  const node = arg as { record?: AdrRecord } | undefined;
  if (node?.record) return vscode.Uri.file(node.record.filePath);
  return undefined;
}

async function pickRecord(store: AdrStore, arg: unknown, placeHolder: string, filter?: (r: AdrRecord) => boolean): Promise<AdrRecord | undefined> {
  await ensureLoaded(store);
  const uri = argUri(arg) ?? (store.isAdrFile(vscode.window.activeTextEditor?.document.uri ?? vscode.Uri.parse('x:')) ? vscode.window.activeTextEditor!.document.uri : undefined);
  if (uri && !arg && vscode.window.activeTextEditor?.document.isDirty) await vscode.window.activeTextEditor.document.save();
  if (uri) {
    const found = store.recordFor(uri);
    if (found) return found;
  }
  return chooseRecord(store.allRecords().filter(filter ?? (() => true)), placeHolder);
}

async function chooseRecord(records: AdrRecord[], placeHolder: string): Promise<AdrRecord | undefined> {
  if (records.length === 0) {
    void vscode.window.showInformationMessage('No architecture decision records found. Run "ADR: Create New ADR" to start the log.');
    return undefined;
  }
  const items = [...records]
    .sort((a, b) => (a.id ?? 1e9) - (b.id ?? 1e9))
    .map((r) => ({
      label: recordLabel(r),
      description: `${statusDisplayName(r.status)}${r.date ? ` · ${r.date}` : ''}`,
      detail: r.context ? excerpt(r.context, 140) : undefined,
      record: r,
    }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true, matchOnDetail: true });
  return picked?.record;
}

async function writeNewFile(file: string, content: string): Promise<boolean> {
  try {
    await fs.access(file);
    void vscode.window.showErrorMessage(`${path.basename(file)} already exists.`);
    return false;
  } catch {
    // does not exist — good
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, { encoding: 'utf8', flag: 'wx' });
  return true;
}

async function openFile(file: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc, { preview: false });
}

function numberWidth(records: AdrRecord[]): number {
  const widths = records
    .map((r) => /^(\d+)[-_]/.exec(r.fileName)?.[1]?.length)
    .filter((w): w is number => w !== undefined);
  return widths.length ? Math.max(...widths) : 4;
}

function requireTrust(action: string): boolean {
  if (vscode.workspace.isTrusted) return true;
  void vscode.window.showWarningMessage(`${action} runs git and is only available in a trusted workspace.`);
  return false;
}

async function resolveCustomTemplate(state: FolderState): Promise<string | null> {
  const candidates: string[] = [];
  const configured = state.settings.customTemplatePath;
  if (configured) candidates.push(path.isAbsolute(configured) ? configured : path.join(state.root, configured));
  for (const n of CUSTOM_TEMPLATE_NAMES) candidates.push(path.join(state.root, state.adrDir || 'docs/adr', n));
  for (const c of candidates) {
    try {
      return await fs.readFile(c, 'utf8');
    } catch {
      // keep looking
    }
  }
  void vscode.window.showErrorMessage(
    `No custom ADR template found. Looked in: ${candidates.map((c) => path.relative(state.root, c)).join(', ')}. ` +
      'Placeholders: {{number}}, {{number:0000}}, {{title}}, {{date}}, {{status}}.',
  );
  return null;
}

function fullRange(text: string): vscode.Range {
  const lines = text.split(/\r\n|\r|\n/);
  return new vscode.Range(0, 0, lines.length - 1, lines[lines.length - 1]!.length);
}

async function currentText(file: string): Promise<string> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && path.normalize(d.uri.fsPath) === path.normalize(file));
  return open ? open.getText() : fs.readFile(file, 'utf8');
}

async function saveIfOpen(uris: vscode.Uri[]): Promise<void> {
  for (const uri of uris) {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (doc?.isDirty) await doc.save();
  }
}

/** Text files under the folder (excluding vendored/build output), read lazily. */
async function* scanFolder(state: FolderState, token: vscode.CancellationToken): AsyncGenerator<{ file: string; text: string }> {
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(state.folder, '**/*'), SCAN_EXCLUDE, MAX_SCAN_FILES, token);
  for (const uri of uris) {
    if (token.isCancellationRequested) return;
    try {
      const stat = await fs.stat(uri.fsPath);
      if (stat.size > MAX_SCAN_BYTES) continue;
      const buf = await fs.readFile(uri.fsPath);
      if (buf.subarray(0, 8000).includes(0)) continue; // binary
      yield { file: uri.fsPath, text: buf.toString('utf8') };
    } catch {
      // vanished or unreadable
    }
  }
}

// --------------------------------------------------------------- commands --

async function createAdr(ctx: Context, preset?: { title?: string; content?: (n: number, title: string, format: AdrFormat) => string }): Promise<void> {
  const state = await pickState(ctx.store);
  if (!state) return;
  const title = (
    await vscode.window.showInputBox({
      title: 'New Architecture Decision Record',
      prompt: 'Short title of the decision, e.g. "Use PostgreSQL for persistence"',
      value: preset?.title,
      validateInput: (v) => (v.trim() ? undefined : 'A title is required.'),
    })
  )?.trim();
  if (!title) return;
  const defaultFormat = state.settings.defaultFormat;
  let format: AdrFormat = defaultFormat;
  if (!preset?.content) {
    const ordered = [...FORMATS].sort((a, b) => (a.id === defaultFormat ? -1 : b.id === defaultFormat ? 1 : 0));
    const pick = await vscode.window.showQuickPick(
      ordered.map((f) => ({ label: f.label, description: f.id === defaultFormat ? 'default' : undefined, detail: f.detail, id: f.id })),
      { placeHolder: 'Template' },
    );
    if (!pick) return;
    format = pick.id;
  }
  const number = analyzeNumbering(state.records.map((r) => ({ fileName: r.fileName, id: r.id }))).next;
  const date = todayIso();
  let content: string;
  if (preset?.content) {
    content = preset.content(number, title, format);
  } else if (format === 'custom') {
    const template = await resolveCustomTemplate(state);
    if (template === null) return;
    content = substitutePlaceholders(template, { number, title, date });
  } else {
    content = renderTemplate(format, { number, title, date });
  }
  const dir = path.join(state.root, state.adrDir || 'docs/adr');
  const file = path.join(dir, adrFileName(number, title, numberWidth(state.records)));
  if (!(await writeNewFile(file, content))) return;
  await ctx.store.refresh();
  await openFile(file);
}

async function createAdrFromPr(ctx: Context): Promise<void> {
  if (!requireTrust('Create ADR from Merged PR')) return;
  const state = await pickState(ctx.store);
  if (!state) return;
  type Item = vscode.QuickPickItem & { action: 'merge' | 'clipboard'; subject?: string; body?: string; hash?: string; author?: string };
  const items: Item[] = [];
  try {
    const merges = await readMergeCommits(state.root, 50);
    for (const m of merges) {
      items.push({
        label: m.subject,
        description: `${m.hash.slice(0, 7)} · ${m.author} · ${m.date.slice(0, 10)}`,
        detail: m.body ? excerpt(m.body, 120) : undefined,
        action: 'merge',
        subject: m.subject,
        body: m.body,
        hash: m.hash,
        author: m.author,
      });
    }
  } catch (e) {
    ctx.output.appendLine(`git log --merges failed: ${(e as Error).message}`);
  }
  items.push({ label: '$(clippy) Use the clipboard as the PR description', description: 'For squash merges or descriptions copied from GitHub/GitLab', action: 'clipboard' });
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: items.length > 1 ? 'Pick a merged pull request to turn into a decision record' : 'No merge commits found — use a copied PR description instead',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!pick) return;
  let subject = pick.subject ?? '';
  let body = pick.body ?? '';
  if (pick.action === 'clipboard') {
    body = (await vscode.env.clipboard.readText()).trim();
    if (!body) {
      void vscode.window.showWarningMessage('The clipboard is empty — copy the pull-request description first.');
      return;
    }
    subject = body.split(/\r?\n/)[0]!.replace(/^#+\s*/, '');
  }
  const extract = extractDecision(body, subject);
  const source = [
    extract.prNumber != null ? `PR #${extract.prNumber}` : null,
    pick.hash ? `merge ${pick.hash.slice(0, 7)}` : null,
    pick.author ? `by ${pick.author}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  await createAdr(ctx, {
    title: extract.title,
    content: (number, title, format) =>
      renderFilled(format, { number, title, date: todayIso() }, { ...extract, source: source ? `Source: ${source}` : undefined }),
  });
}

async function changeStatus(ctx: Context, arg: unknown): Promise<void> {
  const record = await pickRecord(ctx.store, arg, 'Change the status of which ADR?');
  if (!record) return;
  const items = SETTABLE_STATUSES.map((s) => ({
    label: statusDisplayName(s),
    description: s === record.status ? 'current' : isTransitionAllowed(record.status, s) ? '' : 'not a standard lifecycle transition',
    status: s as AdrStatus,
  })).sort((a, b) => Number(a.description !== '') - Number(b.description !== ''));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: `ADR-${formatId(record.id ?? 0)} is ${statusDisplayName(record.status)} — new status` });
  if (!pick) return;
  let successor: AdrRecord | undefined;
  if (pick.status === 'superseded') {
    successor = await chooseRecord(
      ctx.store.allRecords().filter((r) => r.filePath !== record.filePath && r.id != null),
      'Superseded by which ADR?',
    );
    if (!successor) return;
  }
  const edit = new vscode.WorkspaceEdit();
  const uri = vscode.Uri.file(record.filePath);
  const text = await currentText(record.filePath);
  const target = successor ? { id: successor.id!, fileName: relativeLink(record.filePath, successor.filePath), title: successor.title } : undefined;
  edit.replace(uri, fullRange(text), setStatus(text, pick.status, target));
  const touched = [uri];
  if (successor) {
    const sUri = vscode.Uri.file(successor.filePath);
    const sText = await currentText(successor.filePath);
    const updated = addSupersedesBacklink(sText, { id: record.id!, fileName: relativeLink(successor.filePath, record.filePath), title: record.title });
    if (updated !== sText) {
      edit.replace(sUri, fullRange(sText), updated);
      touched.push(sUri);
    }
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage('Could not update the decision record.');
    return;
  }
  await saveIfOpen(touched);
  await ctx.store.refresh();
  void vscode.window.showInformationMessage(
    `ADR-${formatId(record.id ?? 0)} is now ${statusDisplayName(pick.status)}${successor ? `, superseded by ADR-${formatId(successor.id!)} (backlink added)` : ''}.`,
  );
}

function relativeLink(from: string, to: string): string {
  return path.relative(path.dirname(from), to).replace(/\\/g, '/');
}

async function renumber(ctx: Context, arg: unknown): Promise<void> {
  const record = await pickRecord(ctx.store, arg, 'Renumber which ADR?');
  if (!record || record.id == null) {
    if (record) void vscode.window.showWarningMessage('This record has no number to change.');
    return;
  }
  const state = ctx.store.stateFor(vscode.Uri.file(record.filePath));
  if (!state) return;
  const oldId = record.id;
  const taken = new Set(state.records.filter((r) => r.filePath !== record.filePath).map((r) => r.id).filter((n): n is number => n != null));
  const next = analyzeNumbering(state.records.map((r) => ({ fileName: r.fileName, id: r.id }))).next;
  const input = await vscode.window.showInputBox({
    title: `Renumber ADR-${formatId(oldId)} "${record.title}"`,
    prompt: 'New number. The file name, heading, front matter and every reference across the folder are rewritten.',
    value: String(next),
    validateInput: (v) => (/^\d+$/.test(v.trim()) ? validateRenumber(oldId, Number(v), taken) ?? undefined : 'Enter a whole number.'),
  });
  if (!input) return;
  const newId = Number(input.trim());
  const oldName = record.fileName;
  const newName = renamedFileName(oldName, newId);
  const adrDirAbs = path.dirname(record.filePath);
  const twins = new Set(state.records.filter((r) => r.id === oldId && r.filePath !== record.filePath).map((r) => path.normalize(r.filePath)));

  const changes = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Finding references to ADR-${formatId(oldId)}…`, cancellable: true },
    async (_p, token) => {
      const out = new Map<string, { before: string; after: string; refs: number }>();
      out.set(record.filePath, { before: await currentText(record.filePath), after: '', refs: 0 });
      for await (const { file, text } of scanFolder(state, token)) {
        if (path.normalize(file) === path.normalize(record.filePath)) continue;
        // Only files that reference the number or link the file name are rewritten.
        const refs = countReferences(text, oldId);
        if (refs === 0 && !text.includes(oldName)) continue;
        const live = await currentText(file);
        if (twins.has(path.normalize(file))) {
          // The other record claiming the same number keeps its own references.
          out.set(file, { before: live, after: live.split(oldName).join(newName), refs: 0 });
          continue;
        }
        out.set(file, { before: live, after: rewriteReferences(live, oldId, newId, oldName, newName), refs });
      }
      const self = out.get(record.filePath)!;
      self.after = rewriteAdrDocument(self.before, oldId, newId);
      self.refs = countReferences(self.before, oldId);
      return token.isCancellationRequested ? undefined : out;
    },
  );
  if (!changes) return;
  const changed = [...changes.entries()].filter(([, c]) => c.after !== c.before);
  const refTotal = changed.reduce((n, [, c]) => n + c.refs, 0);
  const confirm = await vscode.window.showWarningMessage(
    `Renumber ADR-${formatId(oldId)} → ADR-${formatId(newId)}?`,
    {
      modal: true,
      detail: `Rename ${oldName} → ${newName}\nRewrite ${refTotal} reference(s) in ${changed.length} file(s):\n${changed
        .slice(0, 12)
        .map(([f]) => `  ${path.relative(state.root, f)}`)
        .join('\n')}${changed.length > 12 ? `\n  …and ${changed.length - 12} more` : ''}`,
    },
    'Renumber',
  );
  if (confirm !== 'Renumber') return;
  const edit = new vscode.WorkspaceEdit();
  for (const [file, c] of changed) edit.replace(vscode.Uri.file(file), fullRange(c.before), c.after);
  const newPath = path.join(adrDirAbs, newName);
  if (newName !== oldName) edit.renameFile(vscode.Uri.file(record.filePath), vscode.Uri.file(newPath), { overwrite: false });
  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showErrorMessage('Renumbering failed — nothing was changed.');
    return;
  }
  await saveIfOpen([...changed.map(([f]) => vscode.Uri.file(f === record.filePath ? newPath : f)), vscode.Uri.file(newPath)]);
  await ctx.store.refresh();
  void vscode.window.showInformationMessage(`ADR-${formatId(oldId)} is now ADR-${formatId(newId)} (${refTotal} reference(s) in ${changed.length} file(s) updated). Undo with Edit → Undo in each file if needed.`);
}

async function copySummary(ctx: Context): Promise<void> {
  const state = await pickState(ctx.store);
  if (!state) return;
  await vscode.env.clipboard.writeText(renderSummary(state.records));
  void vscode.window.showInformationMessage(`Copied the status summary of ${state.records.length} ADR(s) as Markdown.`);
}

async function generateIndex(ctx: Context): Promise<void> {
  const state = await pickState(ctx.store);
  if (!state) return;
  if (!state.dirExists) {
    void vscode.window.showWarningMessage('No ADR directory yet — create your first ADR.');
    return;
  }
  const grouping = await vscode.window.showQuickPick(
    [
      { label: 'Single table', id: 'none' as IndexGrouping },
      { label: 'Grouped by status', id: 'status' as IndexGrouping },
      { label: 'Grouped by year', id: 'year' as IndexGrouping },
    ],
    { placeHolder: 'Index layout' },
  );
  if (!grouping) return;
  const file = path.join(state.root, state.adrDir, 'index.md');
  let existing: string | null = null;
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    // new file
  }
  if (existing !== null && !existing.includes('Generated by ADR Companion')) {
    const ok = await vscode.window.showWarningMessage(`${state.adrDir}/index.md exists and was not generated by ADR Companion. Overwrite it?`, { modal: true }, 'Overwrite');
    if (ok !== 'Overwrite') return;
  }
  await fs.writeFile(file, renderIndex(state.records, grouping.id, todayIso()), 'utf8');
  await openFile(file);
}

async function exportGraph(ctx: Context): Promise<void> {
  const state = await pickState(ctx.store);
  if (!state) return;
  const format = await vscode.window.showQuickPick(
    [
      { label: 'Mermaid', description: 'flowchart — renders on GitHub, GitLab, Confluence, Backstage', id: 'mermaid' },
      { label: 'Graphviz DOT', description: 'digraph — render with `dot -Tsvg`', id: 'dot' },
    ],
    { placeHolder: 'Graph format' },
  );
  if (!format) return;
  const layout = await vscode.window.showQuickPick(
    [
      { label: 'Top-down', id: 'TD' as const, cluster: false },
      { label: 'Left-to-right', id: 'LR' as const, cluster: false },
      { label: 'Top-down, clustered by status', id: 'TD' as const, cluster: true },
    ],
    { placeHolder: 'Layout' },
  );
  if (!layout) return;
  const model = buildGraph(state.records);
  const opts = { direction: layout.id, clusterByStatus: layout.cluster };
  const text = format.id === 'dot' ? renderDot(model, opts) : renderMermaid(model, opts);
  const dest = await vscode.window.showQuickPick(
    [
      { label: '$(clippy) Copy to clipboard', id: 'clip' },
      { label: '$(save) Save to file…', id: 'save' },
      { label: '$(file) Open in editor', id: 'open' },
    ],
    { placeHolder: `${model.nodes.length} decisions, ${model.edges.length} relationships` },
  );
  if (!dest) return;
  if (dest.id === 'clip') {
    await vscode.env.clipboard.writeText(format.id === 'mermaid' ? `\`\`\`mermaid\n${text}\`\`\`\n` : text);
    void vscode.window.showInformationMessage('ADR graph copied to the clipboard.');
  } else if (dest.id === 'open') {
    const doc = await vscode.workspace.openTextDocument({ content: format.id === 'mermaid' ? `\`\`\`mermaid\n${text}\`\`\`\n` : text, language: format.id === 'mermaid' ? 'markdown' : 'dot' });
    await vscode.window.showTextDocument(doc);
  } else {
    const ext = format.id === 'dot' ? 'dot' : 'md';
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(state.root, state.adrDir || '.', `adr-graph.${ext}`)),
      filters: format.id === 'dot' ? { 'Graphviz DOT': ['dot', 'gv'] } : { Markdown: ['md'], Mermaid: ['mmd'] },
    });
    if (!target) return;
    const body = target.fsPath.endsWith('.md') ? `# ADR relationship graph\n\n\`\`\`mermaid\n${text}\`\`\`\n` : text;
    await fs.writeFile(target.fsPath, body, 'utf8');
    await openFile(target.fsPath);
  }
}

async function createConfig(ctx: Context): Promise<void> {
  const state = await pickState(ctx.store);
  if (!state) return;
  if (state.configFile) {
    await openFile(state.configFile);
    return;
  }
  const file = path.join(state.root, '.adr-config.yaml');
  const settings = { ...state.settings, directory: state.adrDir || state.settings.directory || 'docs/adr' };
  if (await writeNewFile(file, configTemplate(settings))) {
    await ctx.store.refresh();
    await openFile(file);
  }
}

async function validate(ctx: Context): Promise<void> {
  await ctx.store.refresh();
  const issues = ctx.diagnostics.runLint();
  const records = ctx.store.allRecords().length;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  if (issues.length === 0) {
    void vscode.window.showInformationMessage(`All ${records} decision record(s) pass validation.`);
    return;
  }
  void vscode.commands.executeCommand('workbench.actions.view.problems');
  void vscode.window.showWarningMessage(`${records} ADR(s) checked: ${errors} error(s), ${warnings} warning(s), ${issues.length - errors - warnings} info — see the Problems panel.`);
}

async function checkGovernance(ctx: Context): Promise<void> {
  if (!requireTrust('ADR governance check')) return;
  const state = await pickState(ctx.store);
  if (!state) return;
  const patterns = state.settings.requireAdrForPaths;
  if (patterns.length === 0) {
    const act = await vscode.window.showInformationMessage(
      'No architecturally significant paths are configured. List globs under `requireAdrForPaths` in .adr-config.yaml.',
      'Open .adr-config.yaml',
    );
    if (act) await createConfig(ctx);
    return;
  }
  try {
    const configured = vscode.workspace.getConfiguration('adrCompanion', state.folder.uri).get<string>('governance.baseRef', '').trim();
    const base = configured || (await defaultBaseRef(state.root));
    if (!base) {
      void vscode.window.showWarningMessage('Could not find a base branch — set "adrCompanion.governance.baseRef".');
      return;
    }
    const gitRoot = await repoRoot(state.root);
    const changed = (await changedFilesIncludingWorkingTree(state.root, base))
      .map((p) => path.relative(state.root, path.join(gitRoot, p)).replace(/\\/g, '/'))
      .filter((p) => !p.startsWith('..'));
    const verdict = evaluateGovernance(changed, patterns, state.adrDir || 'docs/adr');
    ctx.output.appendLine(`[governance] base ${base}, ${changed.length} changed file(s)\n${verdict.message}\n`);
    if (verdict.triggered) {
      const act = await vscode.window.showWarningMessage(
        `ADR required: ${verdict.matchedPaths.length} architecturally significant file(s) changed since ${base} with no decision record.`,
        'Create ADR',
        'Show Files',
      );
      if (act === 'Create ADR') await createAdr(ctx);
      if (act === 'Show Files') ctx.output.show(true);
    } else {
      void vscode.window.showInformationMessage(`ADR governance OK (vs ${base}): ${verdict.message}`);
    }
  } catch (e) {
    void vscode.window.showErrorMessage(`ADR governance check failed: ${(e as Error).message}`);
  }
}

async function linkCode(ctx: Context): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open the code you want to link to a decision.');
    return;
  }
  await ensureLoaded(ctx.store);
  const state = ctx.store.stateFor(editor.document.uri) ?? ctx.store.folders[0];
  const order: Record<string, number> = { accepted: 0, proposed: 1, draft: 2 };
  const records = (state?.records ?? []).filter((r) => r.id != null).sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.id! - b.id!);
  const record = await chooseRecord(records, 'Link this code to which decision?');
  if (!record) return;
  const line = editor.selection.active.line;
  const indent = /^\s*/.exec(editor.document.lineAt(line).text)?.[0] ?? '';
  await editor.edit((b) => b.insert(new vscode.Position(line, 0), `${annotationLine(editor.document.languageId, record.id!, record.title, indent)}\n`));
}

async function findReferences(ctx: Context, arg: unknown): Promise<void> {
  const record = await pickRecord(ctx.store, arg, 'Find code references to which ADR?');
  if (!record || record.id == null) return;
  const state = ctx.store.stateFor(vscode.Uri.file(record.filePath));
  if (!state) return;
  const hits = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Searching for ADR-${formatId(record.id)}…`, cancellable: true },
    async (_p, token) => {
      const out: { file: string; line: number; start: number; end: number; text: string }[] = [];
      for await (const { file, text } of scanFolder(state, token)) {
        if (path.normalize(file) === path.normalize(record.filePath)) continue;
        const lines = text.split(/\r?\n/);
        for (const m of findMentions(text)) {
          if (m.id === record.id) out.push({ file, line: m.line, start: m.start, end: m.end, text: lines[m.line]!.trim() });
        }
      }
      return out;
    },
  );
  if (hits.length === 0) {
    void vscode.window.showInformationMessage(`No references to ADR-${formatId(record.id)} found — it is an orphan decision.`);
    return;
  }
  const pick = await vscode.window.showQuickPick(
    hits.map((h) => ({ label: `${path.relative(state.root, h.file)}:${h.line + 1}`, detail: excerpt(h.text, 160), hit: h })),
    { placeHolder: `${hits.length} reference(s) to ADR-${formatId(record.id)} "${record.title}"`, matchOnDetail: true },
  );
  if (!pick) return;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(pick.hit.file));
  const range = new vscode.Range(pick.hit.line, pick.hit.start, pick.hit.line, pick.hit.end);
  await vscode.window.showTextDocument(doc, { selection: range });
}

async function goToAdr(ctx: Context): Promise<void> {
  await ensureLoaded(ctx.store);
  const record = await chooseRecord(ctx.store.allRecords(), 'Go to ADR — type a number, title or words from the context');
  if (record) await openFile(record.filePath);
}

async function setViewMode(ctx: Context): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(list-tree) Group by status', id: 'status' as ViewMode },
      { label: '$(calendar) Timeline (by date)', id: 'timeline' as ViewMode },
      { label: '$(list-flat) Flat list by number', id: 'flat' as ViewMode },
    ],
    { placeHolder: 'ADR view layout' },
  );
  if (!pick) return;
  await vscode.workspace.getConfiguration('adrCompanion').update('view.mode', pick.id, vscode.ConfigurationTarget.Global);
  ctx.tree.setMode(pick.id);
}

async function createCiWorkflow(ctx: Context): Promise<void> {
  const state = await pickState(ctx.store);
  if (!state) return;
  const file = path.join(state.root, '.github', 'workflows', 'adr-governance.yml');
  try {
    await fs.access(file);
    await openFile(file);
    return;
  } catch {
    // create it
  }
  if (await writeNewFile(file, ciWorkflow(ctx.version))) await openFile(file);
}

export function registerCommands(ctx: Context): vscode.Disposable[] {
  const wrap =
    (name: string, fn: (...args: unknown[]) => Promise<void>) =>
    async (...args: unknown[]) => {
      try {
        await fn(...args);
      } catch (e) {
        ctx.output.appendLine(`[${name}] ${(e as Error).stack ?? String(e)}`);
        void vscode.window.showErrorMessage(`ADR Companion: ${(e as Error).message}`);
      }
    };
  const table: Record<string, (...args: unknown[]) => Promise<void>> = {
    'adrCompanion.createAdr': () => createAdr(ctx),
    'adrCompanion.createAdrFromPr': () => createAdrFromPr(ctx),
    'adrCompanion.changeStatus': (arg) => changeStatus(ctx, arg),
    'adrCompanion.renumber': (arg) => renumber(ctx, arg),
    'adrCompanion.copySummary': () => copySummary(ctx),
    'adrCompanion.generateIndex': () => generateIndex(ctx),
    'adrCompanion.exportGraph': () => exportGraph(ctx),
    'adrCompanion.createConfig': () => createConfig(ctx),
    'adrCompanion.validate': () => validate(ctx),
    'adrCompanion.checkGovernance': () => checkGovernance(ctx),
    'adrCompanion.linkCode': () => linkCode(ctx),
    'adrCompanion.findReferences': (arg) => findReferences(ctx, arg),
    'adrCompanion.goToAdr': () => goToAdr(ctx),
    'adrCompanion.setViewMode': () => setViewMode(ctx),
    'adrCompanion.createCiWorkflow': () => createCiWorkflow(ctx),
    'adrCompanion.refresh': () => ctx.store.refresh(),
  };
  return Object.entries(table).map(([id, fn]) => vscode.commands.registerCommand(id, wrap(id, fn)));
}
