/**
 * File-system side of the decision log, shared by the extension and the CLI:
 * locating the ADR directory, reading `.adr-config.yaml` and loading records.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { CONFIG_FILE_NAMES, ProjectConfig, parseConfig } from '../core/config';
import { AdrRecord, isAuxiliaryFile, parseAdr } from '../core/parser';

export const COMMON_ADR_DIRS = [
  'doc/adr',
  'docs/adr',
  'adr',
  'docs/decisions',
  'docs/architecture/decisions',
  'doc/architecture/decisions',
  'architecture/decisions',
  'decisions',
];

const MAX_FILE_BYTES = 1024 * 1024;

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function readProjectConfig(root: string): Promise<{ config: ProjectConfig; file: string } | null> {
  for (const name of CONFIG_FILE_NAMES) {
    const file = path.join(root, name);
    try {
      const text = await fs.readFile(file, 'utf8');
      return { config: parseConfig(text), file };
    } catch {
      // not present — try the next name
    }
  }
  return null;
}

/**
 * The ADR directory relative to `root`: the configured one when set (even if
 * it does not exist yet — "Create ADR" creates it), else the first common
 * location that exists, else null.
 */
export async function detectAdrDirectory(root: string, configured?: string): Promise<{ dir: string; exists: boolean } | null> {
  const wanted = configured?.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (wanted) {
    if (path.isAbsolute(wanted)) return { dir: path.relative(root, wanted).replace(/\\/g, '/'), exists: await isDirectory(wanted) };
    return { dir: wanted, exists: await isDirectory(path.join(root, wanted)) };
  }
  for (const candidate of COMMON_ADR_DIRS) {
    if (await isDirectory(path.join(root, candidate))) return { dir: candidate, exists: true };
  }
  return null;
}

/** Parse every decision record directly inside `absDir` (non-recursive). */
export async function loadRecords(absDir: string): Promise<AdrRecord[]> {
  let names: string[];
  try {
    names = await fs.readdir(absDir);
  } catch {
    return [];
  }
  const records: AdrRecord[] = [];
  for (const name of names.sort()) {
    if (isAuxiliaryFile(name)) continue;
    const file = path.join(absDir, name);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      records.push(parseAdr(await fs.readFile(file, 'utf8'), file));
    } catch {
      // unreadable file — skip rather than fail the whole log
    }
  }
  return records;
}
