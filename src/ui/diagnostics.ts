import * as vscode from 'vscode';
import { checkReference, findAnnotations } from '../core/references';
import { todayIso } from '../core/templates';
import { Issue, lintAll } from '../core/validator';
import { AdrStore } from './store';

const MAX_SCAN = 1024 * 1024;

function toSeverity(s: Issue['severity']): vscode.DiagnosticSeverity {
  return s === 'error' ? vscode.DiagnosticSeverity.Error : s === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
}

/**
 * Two diagnostic sources: lint findings on the decision records themselves,
 * and `@adr:NNN` annotations in code that point at a missing or outdated ADR.
 */
export class AdrDiagnostics implements vscode.Disposable {
  private readonly lint = vscode.languages.createDiagnosticCollection('adr-lint');
  private readonly refs = vscode.languages.createDiagnosticCollection('adr-references');
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly pendingDocs = new Set<vscode.TextDocument>();
  private docTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly store: AdrStore) {
    this.disposables.push(
      this.lint,
      this.refs,
      store.onDidChange(() => this.refreshAll()),
      vscode.workspace.onDidChangeTextDocument((e) => this.onEdit(e.document)),
      vscode.workspace.onDidOpenTextDocument((d) => this.onEdit(d)),
      vscode.workspace.onDidCloseTextDocument((d) => {
        if (!this.store.isAdrFile(d.uri)) this.refs.delete(d.uri);
      }),
    );
  }

  private enabled(key: 'lint' | 'references'): boolean {
    return vscode.workspace.getConfiguration('adrCompanion').get<boolean>(key === 'lint' ? 'lint.enabled' : 'referenceCheck.enabled', true);
  }

  refreshAll(): void {
    this.runLint();
    for (const doc of vscode.workspace.textDocuments) this.checkReferences(doc);
  }

  private onEdit(doc: vscode.TextDocument): void {
    if (this.store.isAdrFile(doc.uri)) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.runLint(), 400);
    } else {
      this.pendingDocs.add(doc);
      if (this.docTimer) clearTimeout(this.docTimer);
      this.docTimer = setTimeout(() => {
        for (const d of this.pendingDocs) this.checkReferences(d);
        this.pendingDocs.clear();
      }, 400);
    }
  }

  /** Lint every folder's decision log; returns the issues for the Problems summary. */
  runLint(): Issue[] {
    this.lint.clear();
    if (!this.enabled('lint')) return [];
    const all: Issue[] = [];
    const today = todayIso();
    for (const state of this.store.folders) {
      if (!state.dirExists) continue;
      const records = this.store.liveRecords(state);
      const issues = lintAll(records, {
        today,
        maxProposedAgeDays: state.settings.maxProposedAgeDays,
        stalenessThresholdDays: state.settings.stalenessThresholdDays,
      });
      all.push(...issues);
      const byFile = new Map<string, vscode.Diagnostic[]>();
      for (const r of records) byFile.set(r.filePath, []);
      for (const issue of issues) {
        const range = new vscode.Range(issue.line, 0, issue.line, Number.MAX_SAFE_INTEGER);
        const d = new vscode.Diagnostic(range, issue.message, toSeverity(issue.severity));
        d.source = 'ADR Companion';
        d.code = issue.code;
        byFile.get(issue.filePath)?.push(d);
      }
      for (const [file, diags] of byFile) this.lint.set(vscode.Uri.file(file), diags);
      if (state.config?.warnings.length && state.configFile) {
        this.lint.set(
          vscode.Uri.file(state.configFile),
          state.config.warnings.map((w) => {
            const line = Math.max(0, Number(/^Line (\d+)/.exec(w)?.[1] ?? 1) - 1);
            const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), w, vscode.DiagnosticSeverity.Warning);
            d.source = 'ADR Companion';
            return d;
          }),
        );
      }
    }
    return all;
  }

  checkReferences(doc: vscode.TextDocument): void {
    if (!this.enabled('references') || (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled')) return;
    if (this.store.isAdrFile(doc.uri) || doc.getText().length > MAX_SCAN) return;
    const state = this.store.stateFor(doc.uri) ?? this.store.folders[0];
    if (!state || state.records.length === 0) {
      this.refs.delete(doc.uri);
      return;
    }
    const index = this.store.index(doc.uri);
    const diags: vscode.Diagnostic[] = [];
    for (const ref of findAnnotations(doc.getText())) {
      const problem = checkReference(ref.id, index);
      if (!problem) continue;
      const d = new vscode.Diagnostic(
        new vscode.Range(ref.line, ref.start, ref.line, ref.end),
        problem.message,
        problem.kind === 'missing' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
      );
      d.source = 'ADR Companion';
      d.code = problem.kind === 'missing' ? 'missing-adr' : 'outdated-adr';
      if (problem.kind === 'inactive') d.tags = [vscode.DiagnosticTag.Deprecated];
      diags.push(d);
    }
    this.refs.set(doc.uri, diags);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.docTimer) clearTimeout(this.docTimer);
    for (const d of this.disposables) d.dispose();
  }
}
