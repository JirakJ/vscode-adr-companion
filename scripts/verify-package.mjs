import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listFiles, PackageManager } from '@vscode/vsce';

const files = await listFiles({ packageManager: PackageManager.None });
const allowed = /^(package\.json|README\.md|CHANGELOG\.md|LICENSE|NOTICE|dist\/extension\.js|dist\/adr-companion-cli\.cjs|media\/(icon|screenshot[-\w]*)\.png)$/;
assert.deepEqual(files.filter((file) => !allowed.test(file)), [], 'Unexpected files in VSIX');
for (const required of ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'dist/extension.js', 'dist/adr-companion-cli.cjs', 'media/icon.png']) {
  assert(files.includes(required), `Missing runtime file: ${required}`);
}
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(manifest.version, lock.version);
assert.equal(manifest.version, lock.packages[''].version);
assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, 'The extension must have zero runtime dependencies');
process.stdout.write(`Verified ${files.length} allowed package files for v${manifest.version}\n`);
