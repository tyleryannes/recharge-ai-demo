/**
 * V3 contracts: shopper-journey agents, the expanded analytics pack, the subscription
 * strategy across the stack, the health scorecard, and "build this for me" packages.
 * Every number that comes from the store carries a [dN] ledger ref in its text.
 */

import type { SourceId } from '../v2/types.js';

// ---------- Shopper journeys ----------

export type JourneyId = 'first-time' | 'returning' | 'subscriber';

export interface JourneyStep {
  n: number;
  /** Where the shopper is, e.g. "Product page · House Blend 12oz". */
  place: string;
  path: string;
  device: 'mobile' | 'desktop';
  /** What the shopper did or saw, in plain words. */
  saw: string;
  verdict: 'good' | 'issue' | 'info';
  severity?: 'high' | 'med' | 'low';
  /** Why it matters, with [dN]/[cN] refs. */
  why: string;
  /** Goals this step bears on; used to put goal-relevant steps first. */
  goals: string[];
  /** Opportunity this step feeds, if any. */
  opportunityId?: string;
  /** Wireframe hint for the page sketch. */
  sketch: 'ad' | 'collection' | 'popup' | 'pdp' | 'reviews' | 'cart' | 'checkout' | 'thanks' | 'email' | 'sms' | 'account' | 'portal' | 'cancel' | 'support' | 'speed';
  /** Where to put the highlight on the sketch, 0–1 from the top. */
  mark?: number;
}

export interface Journey {
  id: JourneyId;
  agentId: string;
  persona: string;
  who: string;
  entry: string;
  steps: JourneyStep[];
  headline: string;
}

// ---------- Analytics pack ----------

export interface Series {
  name: string;
  points: { x: string; y: number }[];
}

export interface Chart {
  id: string;
  title: string;
  kind: 'funnel' | 'bars' | 'lines' | 'waterfall' | 'table' | 'split';
  unit: 'ratio' | 'usd' | 'count' | 'months' | 'x';
  series: Series[];
  /** Optional benchmark line or band, in the chart's unit. */
  benchmark?: { label: string; value: number; ref?: string };
  /** One plain-language takeaway, with refs. */
  insight: string;
  /** "So what": the move it points at. */
  opportunityId?: string;
  refs: string[];
  table?: { columns: string[]; rows: (string | number)[][] };
}

export interface AnalyticsPack {
  headline: string;
  kpis: { label: string; value: string; ref?: string; note?: string; tone?: 'good' | 'bad' | 'neutral' }[];
  charts: Chart[];
}

// ---------- Health scorecard ----------

export interface AreaScore {
  area: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  line: string;
  working: string;
}

// ---------- Subscription strategy across the stack ----------

export interface StackTool {
  tool: string;
  source?: SourceId | 'gorgias' | 'okendo';
  role: string;
  /** 0 (nothing) … 4 (best in class). */
  maturity: number;
  today: string;
  great: string;
  plays: { text: string; opportunityId?: string }[];
}

export interface SubscriptionStrategy {
  why: string[];
  maturity: number;
  stack: StackTool[];
}

// ---------- Build packages ----------

export interface EmailBlock {
  type: 'hero' | 'heading' | 'text' | 'button' | 'products' | 'quote' | 'divider' | 'footer';
  text?: string;
  /** Hero illustration key (rendered as inline SVG). */
  art?: 'bag' | 'calendar' | 'cups' | 'gift' | 'box' | 'heart';
  href?: string;
  /** Button caption under the link, e.g. "Skio Quick Action: subscribe". */
  note?: string;
  items?: { name: string; price: string; note?: string }[];
}

export interface EmailAsset {
  kind: 'email';
  id: string;
  name: string;
  platform: 'Klaviyo';
  timing: string;
  subject: string;
  preview: string;
  from: string;
  blocks: EmailBlock[];
}

export interface SmsAsset {
  kind: 'sms';
  id: string;
  name: string;
  platform: 'Postscript';
  timing: string;
  body: string;
  link?: { href: string; note: string };
}

export interface FlowAsset {
  kind: 'flow';
  id: string;
  name: string;
  platform: 'Klaviyo' | 'Postscript';
  trigger: string;
  filters: string[];
  steps: { kind: 'delay' | 'email' | 'sms' | 'split' | 'exit'; label: string; ref?: string }[];
}

export interface ConfigAsset {
  kind: 'config';
  id: string;
  name: string;
  platform: 'Skio' | 'Shopify' | 'Gorgias' | 'Meta Ads' | 'TikTok Shop' | 'Klaviyo';
  where: string;
  settings: { label: string; value: string }[];
}

export interface CancelFlowAsset {
  kind: 'cancel-flow';
  id: string;
  name: string;
  platform: 'Skio';
  where: string;
  reasons: { reason: string; share?: string; ref?: string; offers: { type: string; label: string }[] }[];
  variants: { name: string; split: number; description: string }[];
}

export interface MacroAsset {
  kind: 'macro';
  id: string;
  name: string;
  platform: 'Gorgias';
  when: string;
  body: string;
  actions: string[];
}

export interface PrintAsset {
  kind: 'print';
  id: string;
  name: string;
  platform: 'TikTok Shop' | 'Packaging';
  front: string;
  back: string;
}

export interface AdAsset {
  kind: 'ad';
  id: string;
  name: string;
  platform: 'Meta Ads';
  format: string;
  primary: string;
  headline: string;
  cta: string;
  visual: string;
}

export type BuildAsset = EmailAsset | SmsAsset | FlowAsset | ConfigAsset | CancelFlowAsset | MacroAsset | PrintAsset | AdAsset;

export interface WalkStep {
  title: string;
  where: string;
  minutes: number;
  do: string[];
  /** Values to copy while doing this step. */
  values?: { label: string; value: string }[];
  /** Assets this step creates, by id (shown inline). */
  assets?: string[];
  why: string;
}

export interface BuildPackage {
  opportunityId: string;
  title: string;
  /** The case in plain sentences, each with its data. */
  plainCase: string[];
  /** One-line "what you get". */
  summary: string;
  /** The comms that pair with the change (always present). */
  comms: string;
  assets: BuildAsset[];
  test: { name: string; split: string; metric: string; guardrail: string; runFor: string; tool: string };
  tracking: {
    baseline: { metric: string; value: string; ref?: string }[];
    watch: string[];
    compare: string;
    events: string[];
  };
  walkthrough: WalkStep[];
  buildLog: string[];
}
