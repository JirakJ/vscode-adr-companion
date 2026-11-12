// Renders media/screenshot.png from REAL output of the bundled CLI run against
// the demo decision log in test/fixtures/demo (graph, lint, summary), using
// headless Chrome. Run `npm run build` first. Needs network for Mermaid (CDN).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demo = join(root, 'test', 'fixtures', 'demo');
const cli = (...args) =>
  spawnSync(process.execPath, [join(root, 'dist', 'adr-companion-cli.cjs'), ...args, '--root', demo], { encoding: 'utf8' }).stdout;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const graph = cli('graph', '--direction', 'LR');
const lint = cli('lint').trim().split('\n');
const summary = cli('summary');
const rows = summary
  .split('\n')
  .filter((l) => /^\| \d/.test(l))
  .map((l) => l.slice(1, -1).split(' | ').map((c) => c.trim()));
const statusLine = esc(summary.split('\n').find((l) => l.startsWith('**')) ?? '').replace(/\*\*(.+?)\*\*/, '<b>$1</b>');

const lintHtml = lint
  .map((l) => {
    const m = /^(\S+?:\d+)\s+(error|warning|info)\s+(.*?)\s+\[([\w-]+)\]$/.exec(l);
    if (!m) return `<div class="sum">${esc(l)}</div>`;
    return `<div><span class="loc">${esc(m[1])}</span> <span class="${m[2]}">${m[2]}</span> ${esc(m[3])} <span class="code">${m[4]}</span></div>`;
  })
  .join('');

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  body { margin:0; width:1280px; height:800px; background:#0f1720; color:#d6dde6; font:14px/1.45 -apple-system, "Segoe UI", Helvetica, sans-serif; }
  header { display:flex; align-items:center; gap:14px; padding:22px 28px 6px; }
  header img { width:44px; height:44px; }
  header h1 { margin:0; font-size:22px; font-weight:600; color:#fff; }
  header p { margin:0; color:#8b98a8; font-size:13px; }
  .grid { display:grid; grid-template-columns: 1.15fr 1fr; gap:16px; padding:14px 28px; }
  .card { background:#16202c; border:1px solid #243243; border-radius:10px; padding:14px 16px; }
  .card h2 { margin:0 0 10px; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:#8b98a8; font-weight:600; }
  .card h2 code { text-transform:none; letter-spacing:0; color:#5eead4; font-size:12px; }
  .graph { background:#f8fafc; border-radius:8px; padding:8px; min-height:250px; display:flex; align-items:center; justify-content:center; }
  .term { font:12px/1.6 "SF Mono", Menlo, monospace; background:#0b1118; border-radius:8px; padding:10px 12px; }
  .term .loc { color:#93c5fd; } .term .error { color:#f87171; } .term .warning { color:#fbbf24; } .term .info { color:#60a5fa; }
  .term .code { color:#64748b; } .term .sum { color:#e2e8f0; margin-top:6px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:5px 8px; border-bottom:1px solid #243243; }
  th { color:#8b98a8; font-weight:600; }
  .pill { padding:1px 8px; border-radius:99px; font-size:12px; }
  .Accepted { background:#064e3b; color:#a7f3d0; } .Proposed { background:#1e3a8a; color:#bfdbfe; }
  .Superseded { background:#7f1d1d; color:#fecaca; } .Deprecated { background:#78350f; color:#fde68a; }
  .wide { grid-column: 1 / span 2; }
  .status { margin:-4px 0 8px; color:#cbd5e1; }
  .graph pre { margin:0; }
</style></head><body>
<header><img src="file://${join(root, 'media', 'icon.png')}"><div><h1>ADR Companion</h1>
<p>Real output for a sample decision log: relationship graph, lint findings and status summary — the same rules run in VS Code and in CI.</p></div></header>
<div class="grid">
  <div class="card"><h2>Relationship graph · <code>ADR: Export Relationship Graph</code></h2><div class="graph"><pre class="mermaid">${esc(graph)}</pre></div></div>
  <div class="card"><h2>Lint · <code>adr-companion lint</code></h2><div class="term">${lintHtml}</div></div>
  <div class="card wide"><h2>Status summary · <code>ADR: Copy Status Summary</code></h2><p class="status">${statusLine}</p>
  <table><tr><th>#</th><th>Title</th><th>Status</th><th>Date</th></tr>
  ${rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1].replace(/\\\|/g, '|'))}</td><td><span class="pill ${r[2]}">${r[2]}</span></td><td>${esc(r[3])}</td></tr>`).join('')}
  </table></div>
</div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: false, theme: 'default', flowchart: { useMaxWidth: true } });
  await mermaid.run({ querySelector: '.mermaid' });
  const svg = document.querySelector('.mermaid svg');
  svg.style.maxWidth = 'none';
  svg.setAttribute('width', '640');
  svg.removeAttribute('height');
  document.body.dataset.ready = '1';
</script></body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'adr-shot-'));
const page = join(dir, 'index.html');
writeFileSync(page, html);
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
execFileSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--allow-file-access-from-files',
  `--user-data-dir=${join(dir, 'profile')}`,
  '--window-size=1280,800',
  '--force-device-scale-factor=2',
  '--virtual-time-budget=15000',
  `--screenshot=${join(root, 'media', 'screenshot.png')}`,
  `file://${page}`,
]);
process.stdout.write(`Wrote media/screenshot.png (page: ${page})\n`);
