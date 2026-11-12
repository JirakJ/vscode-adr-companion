/**
 * ADR relationship graph and its Mermaid / Graphviz DOT renderings.
 * Output is deterministic: nodes by number, edges by (from, to, kind).
 */
import { AdrRecord, formatId } from './parser';
import { AdrStatus, STATUS_ORDER, statusDisplayName } from './status';

export type EdgeKind = 'supersedes' | 'amends' | 'depends-on' | 'related';

export interface GraphNode {
  id: number;
  title: string;
  status: AdrStatus;
  fileName: string;
}

export interface GraphEdge {
  from: number;
  to: number;
  kind: EdgeKind;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const TEXT_RELATIONS: [RegExp, EdgeKind][] = [
  [/\b(?:supersedes|replaces)\s+\[?(?:ADR[-#\s]?)0*(\d{1,5})/gi, 'supersedes'],
  [/\b(?:amends|modifies|extends|refines)\s+\[?(?:ADR[-#\s]?)0*(\d{1,5})/gi, 'amends'],
  [/\b(?:depends\s+on|requires|builds\s+on)\s+\[?(?:ADR[-#\s]?)0*(\d{1,5})/gi, 'depends-on'],
  [/\b(?:related\s+to|see\s+also|relates\s+to|references?)\s+\[?(?:ADR[-#\s]?)0*(\d{1,5})/gi, 'related'],
];

export function buildGraph(records: AdrRecord[]): GraphModel {
  const byId = new Map<number, AdrRecord>();
  for (const r of records) if (r.id != null && !byId.has(r.id)) byId.set(r.id, r);
  const nodes: GraphNode[] = [...byId.values()]
    .sort((a, b) => a.id! - b.id!)
    .map((r) => ({ id: r.id!, title: r.title, status: r.status, fileName: r.fileName }));

  const edges = new Map<string, GraphEdge>();
  const add = (from: number, to: number, kind: EdgeKind) => {
    if (from === to || !byId.has(from) || !byId.has(to)) return;
    // One supersede edge per pair regardless of which side declared it.
    if (kind !== 'supersedes' && edges.has(`${from}>${to}>supersedes`)) return;
    edges.set(`${from}>${to}>${kind}`, { from, to, kind });
  };
  for (const r of byId.values()) {
    for (const successor of r.supersededBy) add(successor, r.id!, 'supersedes');
    for (const old of r.supersedes) add(r.id!, old, 'supersedes');
  }
  for (const r of byId.values()) {
    const text = [r.context, r.decision, r.consequences, r.notes].join('\n');
    for (const [pattern, kind] of TEXT_RELATIONS) {
      for (const m of text.matchAll(pattern)) {
        const target = Number(m[1]);
        if (kind === 'supersedes') add(r.id!, target, kind);
        else if (!edges.has(`${r.id}>${target}>supersedes`) && !edges.has(`${target}>${r.id}>supersedes`)) add(r.id!, target, kind);
      }
    }
  }
  const sorted = [...edges.values()].sort((a, b) => a.from - b.from || a.to - b.to || a.kind.localeCompare(b.kind));
  return { nodes, edges: sorted };
}

export interface RenderOptions {
  direction?: 'TD' | 'LR';
  clusterByStatus?: boolean;
}

const COLORS: Record<AdrStatus, { fill: string; stroke: string; text: string }> = {
  accepted: { fill: '#D1FAE5', stroke: '#10B981', text: '#065F46' },
  proposed: { fill: '#DBEAFE', stroke: '#3B82F6', text: '#1E3A8A' },
  draft: { fill: '#F3F4F6', stroke: '#9CA3AF', text: '#374151' },
  deprecated: { fill: '#FEF3C7', stroke: '#F59E0B', text: '#78350F' },
  superseded: { fill: '#FEE2E2', stroke: '#EF4444', text: '#7F1D1D' },
  rejected: { fill: '#E5E7EB', stroke: '#6B7280', text: '#1F2937' },
  unknown: { fill: '#FFFFFF', stroke: '#9CA3AF', text: '#111827' },
};

export function mermaidEscape(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '&#124;')
    .replace(/`/g, '&#96;');
}

function mermaidNode(n: GraphNode): string {
  const label = mermaidEscape(`ADR-${formatId(n.id)} ${n.title}`);
  const id = `ADR_${formatId(n.id)}`;
  if (n.status === 'accepted') return `${id}["${label}"]`;
  if (n.status === 'proposed' || n.status === 'draft') return `${id}(["${label}"])`;
  return `${id}{{"${label}"}}`;
}

export function renderMermaid(model: GraphModel, options: RenderOptions = {}): string {
  const out: string[] = [`flowchart ${options.direction ?? 'TD'}`];
  const used = STATUS_ORDER.filter((s) => model.nodes.some((n) => n.status === s));
  for (const s of used) {
    const c = COLORS[s];
    out.push(`    classDef ${s} fill:${c.fill},stroke:${c.stroke},color:${c.text};`);
  }
  if (options.clusterByStatus) {
    for (const s of used) {
      out.push(`    subgraph ${s}_group["${statusDisplayName(s)}"]`);
      for (const n of model.nodes.filter((x) => x.status === s)) out.push(`        ${mermaidNode(n)}`);
      out.push('    end');
    }
  } else {
    for (const n of model.nodes) out.push(`    ${mermaidNode(n)}`);
  }
  for (const n of model.nodes) out.push(`    class ADR_${formatId(n.id)} ${n.status}`);
  for (const e of model.edges) {
    const a = `ADR_${formatId(e.from)}`;
    const b = `ADR_${formatId(e.to)}`;
    if (e.kind === 'supersedes') out.push(`    ${a} -- supersedes --> ${b}`);
    else if (e.kind === 'amends') out.push(`    ${a} -. amends .-> ${b}`);
    else if (e.kind === 'depends-on') out.push(`    ${a} == depends on ==> ${b}`);
    else out.push(`    ${a} --- ${b}`);
  }
  return out.join('\n') + '\n';
}

export function dotEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

export function renderDot(model: GraphModel, options: RenderOptions = {}): string {
  const out: string[] = [
    'digraph adr {',
    `    rankdir=${options.direction === 'LR' ? 'LR' : 'TB'};`,
    '    node [shape=box, style="rounded,filled", fontname="Helvetica"];',
    '    edge [fontname="Helvetica", fontsize=10];',
  ];
  const node = (n: GraphNode, indent: string) => {
    const c = COLORS[n.status];
    const shape = n.status === 'accepted' ? 'box' : n.status === 'proposed' || n.status === 'draft' ? 'ellipse' : 'hexagon';
    return `${indent}ADR_${formatId(n.id)} [label="ADR-${formatId(n.id)}\\n${dotEscape(n.title)}", shape=${shape}, fillcolor="${c.fill}", color="${c.stroke}", fontcolor="${c.text}"];`;
  };
  if (options.clusterByStatus) {
    for (const s of STATUS_ORDER) {
      const bucket = model.nodes.filter((n) => n.status === s);
      if (bucket.length === 0) continue;
      out.push(`    subgraph cluster_${s} {`, `        label="${statusDisplayName(s)}";`);
      for (const n of bucket) out.push(node(n, '        '));
      out.push('    }');
    }
  } else {
    for (const n of model.nodes) out.push(node(n, '    '));
  }
  for (const e of model.edges) {
    const a = `ADR_${formatId(e.from)}`;
    const b = `ADR_${formatId(e.to)}`;
    const style =
      e.kind === 'supersedes'
        ? '[label="supersedes"]'
        : e.kind === 'amends'
          ? '[label="amends", style=dashed]'
          : e.kind === 'depends-on'
            ? '[label="depends on", style=bold]'
            : '[label="related", style=dotted, arrowhead=none]';
    out.push(`    ${a} -> ${b} ${style};`);
  }
  out.push('}');
  return out.join('\n') + '\n';
}
