import * as vscode from 'vscode';
import { AdrRecord, formatId } from '../core/parser';
import { findAnnotations, findMentions } from '../core/references';
import { statusDisplayName } from '../core/status';
import { AdrStore } from './store';
import { escapeMd, excerpt } from './tree';

const SELECTOR: vscode.DocumentSelector = [{ scheme: 'file' }, { scheme: 'untitled' }];
const MAX_SCAN = 1024 * 1024;

function referencesIn(store: AdrStore, doc: vscode.TextDocument, line: number) {
  const text = doc.lineAt(line).text;
  // Inside decision records, prose mentions ("ADR-0007") are links too.
  return store.isAdrFile(doc.uri) || doc.languageId === 'markdown' ? findMentions(text) : findAnnotations(text);
}

export function hoverMarkdown(r: AdrRecord): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**ADR-${formatId(r.id ?? 0)} — ${escapeMd(r.title)}**\n\n`);
  md.appendMarkdown(`*${statusDisplayName(r.status)}*${r.date ? ` · ${r.date}` : ''}`);
  if (r.supersededBy.length) md.appendMarkdown(` · superseded by ${r.supersededBy.map((s) => `ADR-${formatId(s)}`).join(', ')}`);
  if (r.context) md.appendMarkdown(`\n\n${escapeMd(excerpt(r.context, 400))}`);
  if (r.decision) md.appendMarkdown(`\n\n**Decision:** ${escapeMd(excerpt(r.decision, 300))}`);
  md.appendMarkdown(`\n\n[Open ${escapeMd(r.fileName)}](${vscode.Uri.file(r.filePath).toString()})`);
  return md;
}

export function registerLanguageFeatures(store: AdrStore): vscode.Disposable[] {
  const hover = vscode.languages.registerHoverProvider(SELECTOR, {
    provideHover(doc, pos) {
      if (doc.lineAt(pos.line).text.length > 4000) return undefined;
      const index = store.index(doc.uri);
      for (const ref of referencesIn(store, doc, pos.line)) {
        if (pos.character < ref.start || pos.character > ref.end) continue;
        const r = index.get(ref.id);
        if (r) return new vscode.Hover(hoverMarkdown(r), new vscode.Range(ref.line + pos.line, ref.start, ref.line + pos.line, ref.end));
      }
      return undefined;
    },
  });

  const links = vscode.languages.registerDocumentLinkProvider(SELECTOR, {
    provideDocumentLinks(doc) {
      const text = doc.getText();
      if (text.length > MAX_SCAN || store.allRecords().length === 0) return [];
      const index = store.index(doc.uri);
      const isAdr = store.isAdrFile(doc.uri);
      const refs = isAdr ? findMentions(text) : findAnnotations(text);
      const out: vscode.DocumentLink[] = [];
      for (const ref of refs) {
        const r = index.get(ref.id);
        if (!r || (isAdr && r.filePath === doc.uri.fsPath)) continue;
        const link = new vscode.DocumentLink(new vscode.Range(ref.line, ref.start, ref.line, ref.end), vscode.Uri.file(r.filePath));
        link.tooltip = `ADR-${formatId(ref.id)}: ${r.title} (${statusDisplayName(r.status)})`;
        out.push(link);
      }
      return out;
    },
  });

  const completion = vscode.languages.registerCompletionItemProvider(
    SELECTOR,
    {
      provideCompletionItems(doc, pos) {
        const before = doc.lineAt(pos.line).text.slice(0, pos.character);
        const m = /@adr(?:[:#(-]\s?)?\d*$/i.exec(before);
        if (!m) return undefined;
        const range = new vscode.Range(pos.line, pos.character - m[0].length, pos.line, pos.character);
        const index = store.index(doc.uri);
        return [...index.values()].map((r, i) => {
          const id = formatId(r.id!);
          const item = new vscode.CompletionItem({ label: `@adr:${id}`, description: `${r.title} · ${statusDisplayName(r.status)}` }, vscode.CompletionItemKind.Reference);
          item.insertText = `@adr:${id}`;
          item.range = range;
          item.filterText = `${m[0]} @adr:${id} ${r.id} ${r.title}`;
          item.sortText = `${['deprecated', 'superseded', 'rejected'].includes(r.status) ? 1 : 0}${String(i).padStart(5, '0')}`;
          item.documentation = hoverMarkdown(r);
          if (['deprecated', 'superseded', 'rejected'].includes(r.status)) item.tags = [vscode.CompletionItemTag.Deprecated];
          return item;
        });
      },
    },
    ':',
    '#',
    '-',
    '(',
  );

  return [hover, links, completion];
}
