/**
 * ADR lifecycle statuses, alias-tolerant parsing and the transition rules.
 *
 * Pure and vscode-free so the extension, the CLI and the tests share it.
 */

export type AdrStatus =
  | 'draft'
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'deprecated'
  | 'superseded'
  | 'unknown';

/** Display order used by the tree view, summaries and graph clustering. */
export const STATUS_ORDER: readonly AdrStatus[] = [
  'proposed',
  'accepted',
  'draft',
  'deprecated',
  'superseded',
  'rejected',
  'unknown',
];

/** Statuses a user can pick when changing the status of a record. */
export const SETTABLE_STATUSES: readonly AdrStatus[] = [
  'draft',
  'proposed',
  'accepted',
  'rejected',
  'deprecated',
  'superseded',
];

const DISPLAY: Record<AdrStatus, string> = {
  draft: 'Draft',
  proposed: 'Proposed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  deprecated: 'Deprecated',
  superseded: 'Superseded',
  unknown: 'Unknown',
};

export function statusDisplayName(status: AdrStatus): string {
  return DISPLAY[status];
}

/** Statuses that mean "this decision is no longer in force". */
export function isInactive(status: AdrStatus): boolean {
  return status === 'deprecated' || status === 'superseded' || status === 'rejected';
}

const ALIASES: Record<string, AdrStatus> = {
  draft: 'draft',
  wip: 'draft',
  'work in progress': 'draft',
  'work-in-progress': 'draft',
  'in progress': 'draft',
  'in-progress': 'draft',
  proposed: 'proposed',
  proposal: 'proposed',
  pending: 'proposed',
  'under review': 'proposed',
  'under-review': 'proposed',
  'in review': 'proposed',
  'in-review': 'proposed',
  review: 'proposed',
  accepted: 'accepted',
  approved: 'accepted',
  adopted: 'accepted',
  active: 'accepted',
  decided: 'accepted',
  superseded: 'superseded',
  superceded: 'superseded',
  replaced: 'superseded',
  obsolete: 'superseded',
  deprecated: 'deprecated',
  retired: 'deprecated',
  sunset: 'deprecated',
  rejected: 'rejected',
  declined: 'rejected',
  withdrawn: 'rejected',
  cancelled: 'rejected',
  canceled: 'rejected',
  abandoned: 'rejected',
};

/**
 * Parse a raw status value case-insensitively, tolerating Markdown emphasis,
 * trailing punctuation and extra words such as "Superseded by ADR 7" or
 * "proposed (rfc-42)". Returns `unknown` for blank or unrecognised input.
 */
export function parseStatus(raw: string | undefined | null): AdrStatus {
  if (raw == null) return 'unknown';
  const normalised = raw
    .trim()
    .replace(/^[*_\s`]+/, '')
    .replace(/[*_.\s`]+$/, '')
    .toLowerCase();
  if (!normalised) return 'unknown';
  const direct = ALIASES[normalised];
  if (direct) return direct;
  const twoWords = normalised.split(/\s+/).slice(0, 2).join(' ');
  if (ALIASES[twoWords]) return ALIASES[twoWords]!;
  const firstToken = normalised.split(/[\s(:,;]/)[0] ?? '';
  return ALIASES[firstToken] ?? 'unknown';
}

/**
 * Allowed transitions — the canonical MADR/Nygard lifecycle:
 *
 *   draft ──► proposed ─┬─► accepted ─┬─► superseded
 *     ▲         │       │             └─► deprecated
 *     └─(back)──┘       └─► rejected
 */
const TRANSITIONS: Record<AdrStatus, readonly AdrStatus[]> = {
  draft: ['proposed', 'accepted', 'rejected'],
  proposed: ['accepted', 'rejected', 'draft'],
  accepted: ['superseded', 'deprecated'],
  superseded: [],
  deprecated: [],
  rejected: [],
  unknown: SETTABLE_STATUSES,
};

export function isTransitionAllowed(from: AdrStatus, to: AdrStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: AdrStatus): readonly AdrStatus[] {
  return TRANSITIONS[from];
}
