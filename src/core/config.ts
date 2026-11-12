/**
 * Team configuration: `.adr-config.yaml` committed to the repository root.
 *
 * Implements only the flat YAML subset the schema needs (`key: value` scalars
 * plus block or inline string lists) so it stays dependency-free and never
 * throws: every malformed line becomes a warning. A broken config must never
 * stop anyone from finding their decisions. The file format is shared with the
 * ADR Companion plugin for JetBrains IDEs, so one file serves both editors.
 */
import { AdrFormat, parseFormat } from './templates';

export const CONFIG_FILE_NAMES = ['.adr-config.yaml', '.adr-config.yml'];

export interface ProjectConfig {
  directory?: string;
  defaultFormat?: AdrFormat;
  stalenessThresholdDays?: number;
  maxProposedAgeDays?: number;
  commitGate?: boolean;
  customTemplatePath?: string;
  requireAdrForPaths: string[];
  warnings: string[];
}

type Key =
  | 'directory'
  | 'defaultFormat'
  | 'stalenessThresholdDays'
  | 'maxProposedAgeDays'
  | 'commitGate'
  | 'customTemplatePath'
  | 'requireAdrForPaths';

const ALIASES: Record<string, Key> = {
  directory: 'directory',
  adrdirectory: 'directory',
  path: 'directory',
  defaultformat: 'defaultFormat',
  format: 'defaultFormat',
  stalenessthresholddays: 'stalenessThresholdDays',
  stalenessthreshold: 'stalenessThresholdDays',
  maxproposedagedays: 'maxProposedAgeDays',
  maxproposedage: 'maxProposedAgeDays',
  commitgate: 'commitGate',
  commitgateenabled: 'commitGate',
  customtemplatepath: 'customTemplatePath',
  templatepath: 'customTemplatePath',
  requireadrforpaths: 'requireAdrForPaths',
  requireadrfor: 'requireAdrForPaths',
};

/** Drop a trailing `#` comment unless the `#` sits inside quotes. */
export function stripComment(line: string): string {
  let single = false;
  let double = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !double) single = !single;
    else if (c === '"' && !single) double = !double;
    else if (c === '#' && !single && !double && (i === 0 || /\s/.test(line[i - 1]!))) return line.slice(0, i);
  }
  return line;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) return v.slice(1, -1);
  return v;
}

function inlineList(value: string): string[] {
  let body = value.trim();
  if (body.startsWith('[') && body.endsWith(']')) body = body.slice(1, -1);
  if (!body.trim()) return [];
  return body
    .split(',')
    .map((s) => unquote(s))
    .filter((s) => s.length > 0);
}

export function parseConfig(text: string): ProjectConfig {
  const config: ProjectConfig = { requireAdrForPaths: [], warnings: [] };
  let listKey: Key | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = stripComment(raw).trimEnd();
    if (!line.trim()) return;
    const item = /^-\s*(.*)$/.exec(line.trim());
    if (item) {
      const value = unquote(item[1]!);
      if (listKey === 'requireAdrForPaths') {
        if (value) config.requireAdrForPaths.push(value);
      } else {
        config.warnings.push(`Line ${lineNo}: list item outside a list-valued option, ignored.`);
      }
      return;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) {
      config.warnings.push(`Line ${lineNo}: not a \`key: value\` pair, ignored.`);
      return;
    }
    const key = ALIASES[kv[1]!.toLowerCase().replace(/[-_]/g, '')];
    if (!key) {
      config.warnings.push(`Line ${lineNo}: unknown option \`${kv[1]}\`, ignored.`);
      listKey = null;
      return;
    }
    listKey = key === 'requireAdrForPaths' ? key : null;
    assign(config, key, unquote(kv[2]!), kv[2]!, lineNo);
  });
  return config;
}

function assign(config: ProjectConfig, key: Key, value: string, rawValue: string, lineNo: number): void {
  const positive = (): number | undefined => {
    const n = /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isFinite(n) || n <= 0) {
      config.warnings.push(`Line ${lineNo}: \`${value}\` is not a positive whole number, ignored.`);
      return undefined;
    }
    return n;
  };
  switch (key) {
    case 'directory':
      if (value) config.directory = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
      break;
    case 'customTemplatePath':
      if (value) config.customTemplatePath = value;
      break;
    case 'defaultFormat': {
      if (!value) break;
      const format = parseFormat(value);
      if (format) config.defaultFormat = format;
      else config.warnings.push(`Line ${lineNo}: unknown ADR format \`${value}\`, ignored.`);
      break;
    }
    case 'stalenessThresholdDays': {
      const n = positive();
      if (n !== undefined) config.stalenessThresholdDays = n;
      break;
    }
    case 'maxProposedAgeDays': {
      const n = positive();
      if (n !== undefined) config.maxProposedAgeDays = n;
      break;
    }
    case 'commitGate': {
      const v = value.toLowerCase();
      if (['true', 'yes', 'on', '1'].includes(v)) config.commitGate = true;
      else if (['false', 'no', 'off', '0'].includes(v)) config.commitGate = false;
      else config.warnings.push(`Line ${lineNo}: \`${value}\` is not a boolean, ignored.`);
      break;
    }
    case 'requireAdrForPaths':
      config.requireAdrForPaths.push(...inlineList(rawValue));
      break;
  }
}

/** Per-user defaults the team file overrides key by key. */
export interface UserSettings {
  directory: string;
  defaultFormat: AdrFormat;
  maxProposedAgeDays: number;
  stalenessThresholdDays: number;
  customTemplatePath: string;
  requireAdrForPaths: string[];
}

export interface EffectiveSettings extends UserSettings {
  /** Which keys came from `.adr-config.yaml`. */
  fromTeamConfig: string[];
}

export function resolveSettings(user: UserSettings, team: ProjectConfig | null): EffectiveSettings {
  const fromTeamConfig: string[] = [];
  const pick = <T>(key: string, teamValue: T | undefined, userValue: T): T => {
    if (teamValue === undefined) return userValue;
    fromTeamConfig.push(key);
    return teamValue;
  };
  return {
    directory: pick('directory', team?.directory, user.directory),
    defaultFormat: pick('defaultFormat', team?.defaultFormat, user.defaultFormat),
    maxProposedAgeDays: pick('maxProposedAgeDays', team?.maxProposedAgeDays, user.maxProposedAgeDays),
    stalenessThresholdDays: pick('stalenessThresholdDays', team?.stalenessThresholdDays, user.stalenessThresholdDays),
    customTemplatePath: pick('customTemplatePath', team?.customTemplatePath, user.customTemplatePath),
    requireAdrForPaths: pick(
      'requireAdrForPaths',
      team && team.requireAdrForPaths.length > 0 ? team.requireAdrForPaths : undefined,
      user.requireAdrForPaths,
    ),
    fromTeamConfig,
  };
}

const FORMAT_NAMES: Record<AdrFormat, string> = {
  nygard: 'NYGARD',
  madr: 'MADR',
  rfc: 'RFC',
  'y-statement': 'Y_STATEMENT',
  'tyree-akerman': 'TYREE_AKERMAN',
  custom: 'CUSTOM',
};

/** A documented scaffold that round-trips through {@link parseConfig}. */
export function configTemplate(settings: Partial<UserSettings> = {}): string {
  const dir = settings.directory || 'docs/adr';
  const format = FORMAT_NAMES[settings.defaultFormat ?? 'nygard'];
  const paths = settings.requireAdrForPaths ?? [];
  const lines = [
    '# ADR Companion team configuration.',
    '# Committed to the repository root, it overrides each developer\'s editor',
    '# settings key by key. Keys you leave out fall back to personal settings.',
    '',
    '# Directory holding the decision records, relative to the repository root.',
    `directory: ${dir}`,
    '',
    '# Template for new records: NYGARD | MADR | RFC | Y_STATEMENT | TYREE_AKERMAN | CUSTOM',
    `defaultFormat: ${format}`,
    '',
    '# A Proposed record older than this many days is reported as stale.',
    `maxProposedAgeDays: ${settings.maxProposedAgeDays ?? 30}`,
    '',
    '# Accepted records whose date is older than this get a review reminder.',
    `stalenessThresholdDays: ${settings.stalenessThresholdDays || 180}`,
    '',
    '# Template file backing the CUSTOM format (placeholders: {{number}},',
    '# {{number:0000}}, {{title}}, {{date}}, {{status}}).',
    settings.customTemplatePath ? `customTemplatePath: ${settings.customTemplatePath}` : `# customTemplatePath: ${dir}/.adr-template.md`,
    '',
    '# Changing a file that matches one of these globs without adding or',
    '# changing an ADR fails `adr-companion governance` in CI and is flagged',
    '# by "ADR: Check Governance". An empty list disables the check.',
    'requireAdrForPaths:',
  ];
  if (paths.length === 0) {
    lines.push('  # - "**/api/**"', '  # - "**/*.proto"', '  # - "db/migrations/**"');
  } else {
    for (const p of paths) lines.push(`  - "${p}"`);
  }
  return lines.join('\n') + '\n';
}
