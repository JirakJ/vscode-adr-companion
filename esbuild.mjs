import esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions[]} */
const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
    target: 'node16', // VS Code 1.75 extension host (engines.vscode)
  },
  {
    // Standalone, dependency-free CLI for CI (attached to every GitHub release).
    ...common,
    entryPoints: ['src/cli/main.ts'],
    outfile: 'dist/adr-companion-cli.cjs',
    target: 'node18',
    sourcemap: false,
    minify: false,
    banner: { js: '#!/usr/bin/env node' },
  },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
