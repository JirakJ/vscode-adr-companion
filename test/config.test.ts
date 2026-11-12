import { describe, expect, it } from 'vitest';
import { configTemplate, parseConfig, resolveSettings, stripComment, UserSettings } from '../src/core/config';

const user: UserSettings = {
  directory: '',
  defaultFormat: 'nygard',
  maxProposedAgeDays: 30,
  stalenessThresholdDays: 0,
  customTemplatePath: '',
  requireAdrForPaths: [],
};

describe('parseConfig', () => {
  it('parses the documented schema', () => {
    const c = parseConfig(`directory: ./docs/adr/
defaultFormat: MADR   # comment
stalenessThresholdDays: 180
maxProposedAgeDays: 14
commitGate: yes
customTemplatePath: "docs/adr/.adr-template.md"
requireAdrForPaths:
  - "**/api/**"
  - '**/*.proto'
  - db/migration/**
`);
    expect(c).toMatchObject({
      directory: 'docs/adr',
      defaultFormat: 'madr',
      stalenessThresholdDays: 180,
      maxProposedAgeDays: 14,
      commitGate: true,
      customTemplatePath: 'docs/adr/.adr-template.md',
      requireAdrForPaths: ['**/api/**', '**/*.proto', 'db/migration/**'],
      warnings: [],
    });
  });

  it('accepts inline lists and aliases', () => {
    const c = parseConfig('path: adr\nrequire-adr-for: ["src/core/**", lib/*.ts]\nformat: rfc');
    expect(c.directory).toBe('adr');
    expect(c.defaultFormat).toBe('rfc');
    expect(c.requireAdrForPaths).toEqual(['src/core/**', 'lib/*.ts']);
  });

  it('warns instead of throwing on bad input', () => {
    const c = parseConfig('bogus: 1\nmaxProposedAgeDays: -3\ncommitGate: maybe\n- orphan\njust text\ndefaultFormat: word');
    expect(c.warnings).toHaveLength(6);
    expect(c.warnings[0]).toContain('unknown option `bogus`');
    expect(c.maxProposedAgeDays).toBeUndefined();
  });

  it('keeps # inside quotes', () => {
    expect(stripComment('a: "x # y" # z')).toBe('a: "x # y" ');
    expect(stripComment('a: b#c')).toBe('a: b#c');
  });
});

describe('resolveSettings', () => {
  it('lets the team file override key by key', () => {
    const team = parseConfig('directory: decisions\nrequireAdrForPaths: ["api/**"]');
    const eff = resolveSettings({ ...user, maxProposedAgeDays: 10, directory: 'mine' }, team);
    expect(eff.directory).toBe('decisions');
    expect(eff.maxProposedAgeDays).toBe(10);
    expect(eff.requireAdrForPaths).toEqual(['api/**']);
    expect(eff.fromTeamConfig).toEqual(['directory', 'requireAdrForPaths']);
  });

  it('falls back to user settings without a team file', () => {
    expect(resolveSettings(user, null).fromTeamConfig).toEqual([]);
  });
});

describe('configTemplate', () => {
  it('round-trips through the parser without warnings', () => {
    const c = parseConfig(configTemplate({ directory: 'doc/adr', defaultFormat: 'y-statement', requireAdrForPaths: ['**/*.proto'] }));
    expect(c.warnings).toEqual([]);
    expect(c.directory).toBe('doc/adr');
    expect(c.defaultFormat).toBe('y-statement');
    expect(c.requireAdrForPaths).toEqual(['**/*.proto']);
    expect(parseConfig(configTemplate()).requireAdrForPaths).toEqual([]);
  });
});
