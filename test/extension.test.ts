import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activate } from '../src/extension';
import { registered } from './vscode-stub';

describe('extension activation', () => {
  it('registers exactly the commands declared in package.json', () => {
    const subscriptions: { dispose(): void }[] = [];
    activate({ subscriptions, extension: { packageJSON: { version: '1.0.0' } } } as never);
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    const declared = manifest.contributes.commands.map((c: { command: string }) => c.command).sort();
    expect([...registered].sort()).toEqual(declared);
    expect(subscriptions.length).toBeGreaterThan(declared.length);
  });

  it('only references declared commands from menus and keybindings', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    const declared = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
    const used = [
      ...Object.values(manifest.contributes.menus).flat().map((m: any) => m.command),
      ...manifest.contributes.keybindings.map((k: any) => k.command),
    ];
    for (const c of used) expect(declared.has(c)).toBe(true);
  });
});
