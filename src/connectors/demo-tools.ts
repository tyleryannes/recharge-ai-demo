/**
 * The connector layer in demo mode: store tools answered from a fixed fixture, in the
 * shape a real MCP tool would return. Browser-safe (no node imports) so the same code
 * backs the local server and the single-file demo page.
 *
 * mode=demo → this file.  mode=live (later) → a real MCP server with the same tool
 * names and arguments; prompts, schemas and the UI don't change.
 */

import fixtureJson from '../../fixtures/bramble-and-bean.json' with { type: 'json' };
import type { LedgerEntry, SourceId } from '../v2/types.js';
import type { Ledger } from './ledger.js';

export interface Metric {
  value: number;
  unit: string;
  label: string;
  window?: string;
}

type ToolData = Record<string, unknown>;
interface ArgCases {
  $args: string;
  cases: Record<string, ToolData>;
}

export interface Fixture {
  store: { id: string; name: string; domain: string; category: string; market: string; asOf: string; demo: boolean };
  sources: Record<SourceId, { label: string; kind: string; provides: string; syncedMinutesAgo: number; required?: boolean }>;
  [source: string]: unknown;
}

export const fixture = fixtureJson as unknown as Fixture;

const isMetric = (v: unknown): v is Metric =>
  !!v && typeof v === 'object' && typeof (v as Metric).value === 'number' && typeof (v as Metric).label === 'string';

/** Plain-words description of a tool call for the trace ("Pulled … from Shopify"). */
export const TOOL_PHRASES: Record<string, string> = {
  'shopify.get_store_profile': 'store profile',
  'shopify.get_products': 'products and subscription eligibility',
  'shopify.get_inventory_levels': 'inventory levels',
  'shopify.get_sales_by_product': 'sales by product',
  'shopify.get_repurchase_rates': 'repurchase rates',
  'shopify.get_cohorts': 'customer cohorts',
  'shopify.get_installed_apps': 'installed apps and integrations',
  'klaviyo.list_flows': 'the list of flows',
  'klaviyo.get_flow_performance': 'flow performance',
  'klaviyo.list_campaigns': 'campaigns',
  'klaviyo.get_list_health': 'list health',
  'sms.list_sms_flows': 'SMS flows',
  'sms.get_sms_campaign_performance': 'SMS campaign performance',
  'sms.get_subscriber_count': 'SMS subscriber count',
  'meta.get_account_performance': 'account performance',
  'meta.get_top_creatives': 'top creatives',
  'tiktok.get_ads_performance': 'ads performance',
  'tiktokshop.get_shop_performance': 'shop performance',
  'tiktokshop.get_shop_customers_sync_status': 'buyer sync status',
  'skio.get_subscription_summary': 'subscription summary',
  'skio.get_churn': 'churn',
  'skio.get_cancel_reasons': 'cancel reasons',
  'skio.get_skip_swap_usage': 'skip and swap usage',
  'skio.get_dunning_performance': 'dunning performance',
  'skio.get_ltv_comparison': 'LTV, subscriber vs one-time',
};

export function toolNames(source: SourceId): string[] {
  const tools = fixture[source] as Record<string, unknown> | undefined;
  return tools ? Object.keys(tools) : [];
}

/** The raw result a demo tool returns, before any ledger ids are attached. */
export function readTool(source: SourceId, tool: string, args: Record<string, string> = {}): ToolData {
  const tools = fixture[source] as Record<string, ToolData | ArgCases> | undefined;
  const entry = tools?.[tool];
  if (!entry) throw new Error(`No demo tool ${source}.${tool}`);
  if ('$args' in entry && 'cases' in entry) {
    const c = entry as ArgCases;
    const key = args[c.$args];
    const data = key !== undefined ? c.cases[key] : undefined;
    if (!data) throw new Error(`${source}.${tool}: no demo data for ${c.$args}=${key ?? '(missing)'}`);
    return data;
  }
  return entry as ToolData;
}

export interface ToolCallResult {
  /** MCP-shaped JSON the agent would see: metrics carry their ledger id. */
  data: Record<string, unknown>;
  ledgerIds: string[];
  entries: LedgerEntry[];
}

/** Calls a demo tool and records every metric it returns in the ledger. */
export function callTool(ledger: Ledger, source: SourceId, tool: string, args: Record<string, string> = {}): ToolCallResult {
  const raw = readTool(source, tool, args);
  const qualified = `${source}.${tool}`;
  const data: Record<string, unknown> = {};
  const entries: LedgerEntry[] = [];
  for (const [field, v] of Object.entries(raw)) {
    if (isMetric(v)) {
      const entry = ledger.record({
        source,
        tool: qualified,
        args,
        field,
        value: v.value,
        unit: v.unit,
        window: v.window,
        label: v.label,
        asOf: fixture.store.asOf,
        demo: true,
      });
      entries.push(entry);
      data[field] = { id: entry.id, value: v.value, unit: v.unit, ...(v.window ? { window: v.window } : {}) };
    } else {
      data[field] = v;
    }
  }
  return { data, ledgerIds: entries.map((e) => e.id), entries };
}

/** A metric's value straight from the fixture, for code that needs numbers without a ledger id. */
export function metric(source: SourceId, tool: string, field: string, args: Record<string, string> = {}): Metric {
  const v = readTool(source, tool, args)[field];
  if (!isMetric(v)) throw new Error(`${source}.${tool}.${field} is not a metric`);
  return v;
}
