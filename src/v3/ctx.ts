/**
 * What every V3 content builder gets from the run: ledger refs, fixture values and
 * the merchant's brief. R() returns "[dN]" only for data the run actually pulled, so
 * text written with it never cites a source that was switched off.
 */

import type { RunBrief, SourceId } from '../v2/types.js';

export interface Ctx {
  /** "[dN]" for a pulled metric ("source.tool.field"), or "". */
  R(key: string, args?: Record<string, string>): string;
  RID(key: string, args?: Record<string, string>): string | undefined;
  /** A fixture value, whether or not it was pulled. */
  V(key: string, args?: Record<string, string>): number;
  /** A fixture value, formatted for prose. */
  F(key: string, args?: Record<string, string>): string;
  /** "[cN]" for a web claim the researchers turned in, or "". */
  C(key: string): string;
  has(source: SourceId): boolean;
  brief: RunBrief;
  /** e.g. "subscribe and save 10% (inside your 15% cap)". */
  offer: string;
  isQ4: boolean;
  subLtv: number;
  oneLtv: number;
  asOf: string;
  /** Short date this many weeks after the store's as-of date. */
  date(weeks: number): string;
  store: { name: string; domain: string };
}
