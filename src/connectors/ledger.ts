/**
 * The data ledger: every store number an agent pulls gets an id (d1, d2, …) so the
 * report can cite it as [dN] and fact-check can recompute it. One ledger per run.
 */

import type { LedgerEntry } from '../v2/types.js';

export class Ledger {
  readonly entries: LedgerEntry[] = [];
  private readonly byKey = new Map<string, LedgerEntry>();

  /** Records a metric once per (tool, args, field); pulling it again returns the same id. */
  record(entry: Omit<LedgerEntry, 'id'>): LedgerEntry {
    const key = keyOf(entry.tool, entry.args, entry.field);
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const full = { ...entry, id: `d${this.entries.length + 1}` };
    this.entries.push(full);
    this.byKey.set(key, full);
    return full;
  }

  /** Looks up by the short key content uses, e.g. "skio.get_churn.monthly_churn". */
  find(tool: string, field: string, args: Record<string, string> = {}): LedgerEntry | undefined {
    return this.byKey.get(keyOf(tool, args, field));
  }

  get(id: string): LedgerEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }
}

function keyOf(tool: string, args: Record<string, string>, field: string): string {
  const a = Object.entries(args)
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${tool}?${a}#${field}`;
}
