/**
 * The V2 scripted run: the whole growth-planner pipeline (intake → six store auditors
 * → store profile → three researchers → opportunities → follow-ups → prioritiser →
 * planner → fact-check → report) as a timed event stream, built from the demo fixture
 * and the merchant's Run Brief. No tokens, no network. Numbers come from the fixture
 * through the ledger; impact and sample sizes are computed here, not written.
 *
 * Browser-safe: the single-file demo page bundles this same module.
 */

import { V2_STAGE_ORDER, STAGE_LABELS, type AgentDescriptor, type Claim, type ClaimVerdict, type Finding, type RunEvent, type RunEventBody, type SourceRef } from '../events.js';
import { TOOL_PHRASES, callTool, fixture, metric } from '../connectors/demo-tools.js';
import { Ledger } from '../connectors/ledger.js';
import { CAPACITY_LABELS, CONSTRAINT_LABELS, COMPETITORS, GOAL_LABELS, TIMEFRAME_LABELS } from './intake.js';
import { annualImpact, count, formatValue, pct, sampleSizePerArm, score, usd, weeksToEnrol } from './scoring.js';
import type {
  AuditFinding,
  AuditSection,
  Confidence,
  Effort,
  FeasibilityCheck,
  FlowStatus,
  Initiative,
  Opportunity,
  QuarterRow,
  Roadmap,
  RoadmapItem,
  RunBrief,
  ScoredOpportunity,
  SourceContradiction,
  SourceId,
  StatTile,
  StoreProfile,
  TestPlan,
} from './types.js';
import { WEB_FINDINGS, type WebFinding } from './web-corpus.js';
import { buildAnalytics, buildScorecard, buildStrategy } from '../v3/analytics.js';
import { buildPackages } from '../v3/builds.js';
import type { Ctx } from '../v3/ctx.js';
import { JOURNEY_AGENTS, buildJourneys } from '../v3/journeys.js';

export const MODELS = { top: 'claude-opus-5-5', mid: 'claude-sonnet-5', fast: 'claude-haiku-4-5' };

export interface DemoRunOptions {
  /** How much faster than the recorded clock the page will be shown (label only). */
  playback?: number;
  startedAt?: string;
}

type Args = Record<string, string>;
interface Call {
  source: SourceId;
  tool: string;
  args?: Args;
}
interface Auditor {
  id: string;
  label: string;
  task: string;
  area: string;
  sources: SourceId[];
  model: string;
  calls: Call[];
}

const AUDITORS: Auditor[] = [
  {
    id: 'audit-analytics', label: 'Store analytics', area: 'Store & customers', sources: ['shopify'], model: MODELS.mid,
    task: 'Repurchase rates, order 1 → 2, cohort curves and seasonality',
    calls: [
      { source: 'shopify', tool: 'get_store_profile' },
      { source: 'shopify', tool: 'get_repurchase_rates', args: { window: '90d' } },
      { source: 'shopify', tool: 'get_repurchase_rates', args: { window: '12m' } },
      { source: 'shopify', tool: 'get_cohorts' },
      ...['all', 'mobile', 'desktop'].map((device) => ({ source: 'shopify' as SourceId, tool: 'get_funnel', args: { device } })),
      { source: 'shopify', tool: 'get_margins' },
      { source: 'shopify', tool: 'get_channel_performance' },
      { source: 'shopify', tool: 'get_cohort_ltv' },
    ],
  },
  {
    id: 'audit-catalog', label: 'Catalogue & inventory', area: 'Catalogue & inventory', sources: ['shopify'], model: MODELS.mid,
    task: 'Catalogue, subscription eligibility, inventory cover, best and worst sellers by quarter',
    calls: [
      { source: 'shopify', tool: 'get_products' },
      { source: 'shopify', tool: 'get_inventory_levels' },
      ...['Q4-2025', 'Q1-2026', 'Q2-2026', 'Q3-2026'].map((quarter) => ({ source: 'shopify' as SourceId, tool: 'get_sales_by_product', args: { quarter } })),
    ],
  },
  {
    id: 'audit-lifecycle', label: 'Email & SMS', area: 'Email & SMS', sources: ['klaviyo', 'sms'], model: MODELS.mid,
    task: 'Which flows exist and how they perform, campaigns, list health, SMS',
    calls: [
      { source: 'klaviyo', tool: 'list_flows' },
      { source: 'klaviyo', tool: 'get_flow_performance', args: { flowId: 'post_purchase' } },
      { source: 'klaviyo', tool: 'get_flow_performance', args: { flowId: 'abandoned_cart' } },
      { source: 'klaviyo', tool: 'get_flow_performance', args: { flowId: 'welcome' } },
      { source: 'klaviyo', tool: 'get_list_health' },
      { source: 'klaviyo', tool: 'list_campaigns' },
      { source: 'sms', tool: 'get_subscriber_count' },
      { source: 'sms', tool: 'list_sms_flows' },
      { source: 'sms', tool: 'get_sms_campaign_performance' },
    ],
  },
  {
    id: 'audit-paid', label: 'Paid & social', area: 'Paid & social', sources: ['meta', 'tiktok', 'tiktokshop'], model: MODELS.mid,
    task: 'Meta and TikTok spend, CAC, ROAS, creative, TikTok Shop, and whether buyers land in a subscription',
    calls: [
      { source: 'meta', tool: 'get_account_performance' },
      { source: 'meta', tool: 'get_top_creatives' },
      { source: 'tiktok', tool: 'get_ads_performance' },
      { source: 'tiktokshop', tool: 'get_shop_performance' },
    ],
  },
  {
    id: 'audit-subs', label: 'Subscriptions', area: 'Subscriptions', sources: ['skio'], model: MODELS.mid,
    task: 'Subscribers, churn, cancel reasons, skip and swap, dunning, subscriber vs one-time LTV',
    calls: [
      { source: 'skio', tool: 'get_subscription_summary' },
      { source: 'skio', tool: 'get_churn' },
      { source: 'skio', tool: 'get_cancel_reasons' },
      { source: 'skio', tool: 'get_skip_swap_usage' },
      { source: 'skio', tool: 'get_dunning_performance' },
      { source: 'skio', tool: 'get_ltv_comparison' },
      { source: 'skio', tool: 'get_quick_actions' },
    ],
  },
  {
    id: 'audit-cx', label: 'Support & reviews', area: 'Support & reviews', sources: ['gorgias', 'okendo'], model: MODELS.mid,
    task: 'Ticket volume and reasons, how subscription requests are handled, review themes',
    calls: [
      { source: 'gorgias', tool: 'get_ticket_summary' },
      { source: 'gorgias', tool: 'get_ticket_reasons' },
      { source: 'okendo', tool: 'get_review_summary' },
    ],
  },
  {
    id: 'audit-stack', label: 'Tech stack', area: 'Stack & integrations', sources: ['shopify'], model: MODELS.fast,
    task: "Installed apps, what's wired to what, missing integrations",
    calls: [{ source: 'shopify', tool: 'get_installed_apps' }],
  },
];

const SOURCE_LABEL = (s: SourceId) => fixture.sources[s].label;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const DAY = 86_400_000;
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY);
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function buildDemoRun(runId: string, brief: RunBrief, opts: DemoRunOptions = {}): RunEvent[] {
  const events: { body: RunEventBody; t: number; order: number }[] = [];
  let order = 0;
  const at = (t: number, body: RunEventBody) => events.push({ body, t: Math.round(t), order: order++ });
  // The storefront is public: every run can look at it.
  const has = (s: SourceId) => s === 'storefront' || !!brief.sources[s];
  const ledger = new Ledger();
  const asOf = fixture.store.asOf;

  /** "[dN]" for a pulled metric, or "" when its source is off. Key is "source.tool.field". */
  const R = (key: string, args: Args = {}) => {
    const id = RID(key, args);
    return id ? `[${id}]` : '';
  };
  const RID = (key: string, args: Args = {}) => {
    const [source, tool, field] = key.split('.');
    return ledger.find(`${source}.${tool}`, field, args)?.id;
  };
  const V = (key: string, args: Args = {}) => {
    const [source, tool, field] = key.split('.');
    return metric(source as SourceId, tool, field, args).value;
  };
  const F = (key: string, args: Args = {}) => {
    const [source, tool, field] = key.split('.');
    const m = metric(source as SourceId, tool, field, args);
    return formatValue(m.value, m.unit);
  };
  const refsIn = (text: string) => [...new Set([...text.matchAll(/\[(d\d+)\]/g)].map((m) => m[1]))];

  // Web claims get ids in the order the researchers turn them in.
  const cIds = new Map<string, string>();
  const webByKey = new Map(WEB_FINDINGS.map((f) => [f.key, f]));
  const C = (key: string) => (cIds.has(key) ? `[${cIds.get(key)}]` : '');

  const usage = (costUsd: number, turns: number, inputTokens = 38_000, outputTokens = 3_600) => ({ inputTokens, outputTokens, costUsd, turns });

  // ---------------- queue the map ----------------
  const picked = brief.competitors.filter((c) => COMPETITORS.includes(c));
  const customCompetitors = [
    ...brief.competitors.filter((c) => !COMPETITORS.includes(c)),
    ...(brief.freeText.competitors ? brief.freeText.competitors.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : []),
  ];
  const competitorNames = [...picked, ...customCompetitors];
  const offSources = (Object.keys(brief.sources) as SourceId[]).filter((s) => !brief.sources[s]);

  at(0, {
    type: 'run.started',
    runId,
    brief: brief.question,
    model: `mixed: ${MODELS.top} · ${MODELS.mid} · ${MODELS.fast}`,
    startedAt: opts.startedAt ?? new Date().toISOString(),
    stages: V2_STAGE_ORDER,
    stageLabels: { ...Object.fromEntries(V2_STAGE_ORDER.map((s) => [s, STAGE_LABELS[s]])), report: 'Final plan' },
    runBrief: brief,
    store: { name: fixture.store.name, domain: fixture.store.domain, demo: true },
    playback: opts.playback,
  });
  const q = (agent: AgentDescriptor, t = 50) => at(t, { type: 'agent.queued', agent });
  const intake: AgentDescriptor = { id: 'intake', stage: 'intake', label: 'Run brief', task: 'The question plus the answers from Clarify and Connect', dependsOn: [], model: MODELS.fast };
  q(intake, 0);
  at(0, { type: 'agent.started', agentId: 'intake' });
  at(0, { type: 'agent.completed', agentId: 'intake', durationMs: 0, usage: usage(0, 0, 0, 0) });

  const auditors = AUDITORS.map<AgentDescriptor>((a) => ({ id: a.id, stage: 'audit', label: a.label, task: a.task, dependsOn: ['intake'], model: a.model }));
  const journeyAgents = JOURNEY_AGENTS.map<AgentDescriptor>((j) => ({ id: j.id, stage: 'journeys', label: j.label, task: j.task, dependsOn: ['intake'], model: MODELS.mid }));
  const auditAssembly: AgentDescriptor = { id: 'audit-assembly', stage: 'audit-assembly', label: 'Store audit', task: 'Assembling the Store Profile, contradictions between sources, and what research should look up', dependsOn: [...auditors.map((a) => a.id), ...journeyAgents.map((a) => a.id)], model: MODELS.top };
  const researchers: AgentDescriptor[] = [
    { id: 'research-benchmarks', stage: 'research', label: 'Benchmarks', task: 'Benchmarks and best practice for exactly the gaps the audit found', dependsOn: ['audit-assembly'], model: MODELS.top },
    { id: 'research-competitors', stage: 'research', label: 'Competitors', task: `What ${competitorNames.length ? list(competitorNames) : 'named competitors'} do to acquire and keep subscribers`, dependsOn: ['audit-assembly'], model: MODELS.top },
    { id: 'research-trends', stage: 'research', label: 'Consumer trends', task: 'Category behaviour, seasonality and the pricing climate', dependsOn: ['audit-assembly'], model: MODELS.top },
  ];
  const oppAssembly: AgentDescriptor = { id: 'opportunity-assembly', stage: 'opportunities', label: 'Opportunities', task: 'Joining store data with research into store-vs-benchmark gaps', dependsOn: researchers.map((r) => r.id), model: MODELS.top };
  const analyst: AgentDescriptor = { id: 'growth-analyst', stage: 'opportunities', label: 'Growth analyst', task: 'Funnel, unit economics, payback, channel economics and a health scorecard', dependsOn: researchers.map((r) => r.id), model: MODELS.top };
  const strategist: AgentDescriptor = { id: 'sub-strategist', stage: 'opportunities', label: 'Subscription strategist', task: 'How subscriptions should run through every tool in the stack', dependsOn: researchers.map((r) => r.id), model: MODELS.top };
  const prioritiser: AgentDescriptor = { id: 'prioritiser', stage: 'prioritise', label: 'Prioritiser', task: 'Scoring and ranking opportunities with the maths shown', dependsOn: ['opportunity-assembly', 'growth-analyst', 'sub-strategist'], model: MODELS.top };
  const planner: AgentDescriptor = { id: 'planner', stage: 'plan', label: 'Planner', task: 'Action plans, test designs and a 30/60/90 roadmap', dependsOn: ['prioritiser'], model: MODELS.top };
  const buildKits: AgentDescriptor = { id: 'build-kits', stage: 'plan', label: 'Build kits', task: 'Full email and SMS copy, Skio setup, A/B tests and tracking for each move', dependsOn: ['prioritiser'], model: MODELS.top };
  const factcheck: AgentDescriptor = { id: 'factcheck', stage: 'factcheck', label: 'Fact-check', task: 'Checking web claims against sources and recomputing data claims from the ledger', dependsOn: ['planner', 'build-kits'], model: MODELS.mid };
  const report: AgentDescriptor = { id: 'report', stage: 'report', label: 'Final plan', task: 'Summary, store context, ranked plan, test plan and sources', dependsOn: ['factcheck'] };
  for (const a of [...auditors, ...journeyAgents, auditAssembly, ...researchers, oppAssembly, analyst, strategist, prioritiser, planner, buildKits, factcheck, report]) q(a);

  // ---------------- audit: schedule every store-tool call, then run them in time order ----------------
  interface Pull extends Call { t: number; agentId: string; callId: string; ledgerIds?: string[] }
  const pulls: Pull[] = [];
  const auditorEnd = new Map<string, number>();
  let callN = 0;
  AUDITORS.forEach((a, i) => {
    const start = 1_200 + i * 450;
    at(start, { type: 'agent.started', agentId: a.id });
    const calls = a.calls.filter((c) => has(c.source));
    let t = start + 2_400;
    calls.forEach((c, j) => {
      pulls.push({ ...c, t, agentId: a.id, callId: `call_${++callN}` });
      t += 5_600 + ((i * 7 + j * 5) % 5) * 900;
    });
    auditorEnd.set(a.id, calls.length ? t + 7_500 : start + 3_000);
  });
  JOURNEY_AGENTS.forEach((j, i) => {
    const start = 1_500 + i * 600;
    at(start, { type: 'agent.started', agentId: j.id });
    const calls = j.calls.filter((c) => has(c.source));
    let t = start + 3_000;
    calls.forEach((c, k) => {
      pulls.push({ ...c, t, agentId: j.id, callId: `call_${++callN}` });
      t += 6_400 + ((i * 3 + k * 7) % 4) * 1_100;
    });
    auditorEnd.set(j.id, t + 9_000);
  });
  const f2Enabled = has('tiktokshop');

  pulls.sort((x, y) => x.t - y.t);
  for (const p of pulls) {
    const args = p.args ?? {};
    const res = callTool(ledger, p.source, p.tool, args);
    p.ledgerIds = res.ledgerIds;
    at(p.t, { type: 'tool.call', agentId: p.agentId, source: p.source, tool: `${p.source}.${p.tool}`, args, callId: p.callId });
    res.entries.forEach((entry, k) => at(p.t + 500 + k * 40, { type: 'ledger.entry', agentId: p.agentId, entry }));
    at(p.t + 500 + res.entries.length * 40 + 60, { type: 'tool.result', agentId: p.agentId, source: p.source, tool: `${p.source}.${p.tool}`, callId: p.callId, ledgerIds: res.ledgerIds });
  }

  // ---------------- audit content (all numbers via the ledger) ----------------
  const firstToSub = V('shopify.get_cohorts.first_to_sub_60d');
  const ftb = V('shopify.get_store_profile.first_time_buyers_per_month');
  const sections: AuditSection[] = [];
  const tile = (label: string, key: string, args: Args = {}): StatTile | null => {
    const id = RID(key, args);
    return id ? { label, display: F(key, args), dataRef: id } : null;
  };
  const tiles = (...ts: (StatTile | null)[]) => ts.filter((x): x is StatTile => !!x);
  const finding = (claim: string, severity: AuditFinding['severity'], area: string, positive = false): AuditFinding => ({ claim, dataRefs: refsIn(claim), severity, area, positive });

  // Store analytics
  sections.push({
    area: 'Store & customers', agentId: 'audit-analytics', source: ['shopify'],
    headline: `Customers come once and drift: ${F('shopify.get_repurchase_rates.rate', { window: '90d' })} order again within 90 days ${R('shopify.get_repurchase_rates.rate', { window: '90d' })}, and each new cohort keeps a little less.`,
    tiles: tiles(
      tile('Revenue, 12 months', 'shopify.get_store_profile.revenue'),
      tile('Average order value', 'shopify.get_store_profile.aov'),
      tile('First-time buyers', 'shopify.get_store_profile.first_time_buyers_per_month'),
      tile('Subscribe within 60 days', 'shopify.get_cohorts.first_to_sub_60d'),
      tile('Repurchase, 12 months', 'shopify.get_repurchase_rates.rate', { window: '12m' }),
      tile('Lapsed (120+ days)', 'shopify.get_cohorts.lapsed_customers'),
    ),
    findings: [
      finding(`Only ${pct(firstToSub)} of first-time buyers start a subscription within 60 days ${R('shopify.get_cohorts.first_to_sub_60d')}, out of ${count(ftb)} a month ${R('shopify.get_store_profile.first_time_buyers_per_month')}.`, 'high', 'Store & customers'),
      finding(`Month-1 repeat has slipped every cohort, from ${F('shopify.get_cohorts.m1_repeat_oldest')} for Q4 2025 ${R('shopify.get_cohorts.m1_repeat_oldest')} to ${F('shopify.get_cohorts.m1_repeat_latest')} for Q3 2026 ${R('shopify.get_cohorts.m1_repeat_latest')}.`, 'med', 'Store & customers'),
      finding(`${count(V('shopify.get_cohorts.lapsed_customers'))} customers haven't ordered in 120+ days ${R('shopify.get_cohorts.lapsed_customers')}, and about ${count(V('shopify.get_cohorts.newly_lapsed_per_month'))} more cross that line every month ${R('shopify.get_cohorts.newly_lapsed_per_month')}.`, 'med', 'Store & customers'),
      finding(`Q4 brings ${F('shopify.get_store_profile.q4_revenue_share')} of annual revenue ${R('shopify.get_store_profile.q4_revenue_share')}: the holiday first-time buyers are the biggest batch of the year.`, 'low', 'Store & customers'),
    ],
  });

  // Catalogue & inventory
  const Qs = ['Q4-2025', 'Q1-2026', 'Q2-2026', 'Q3-2026'];
  const quarters: QuarterRow[] = Qs.map((quarter) => {
    const d = fixture.shopify as Record<string, { cases: Record<string, Record<string, unknown>> }>;
    const row = d.get_sales_by_product.cases[quarter] as Record<string, unknown>;
    const worstKey = 'worst_change' in row ? 'worst_change' : 'worst_units_on_hand';
    const worstNote = worstKey === 'worst_change' ? `${F(`shopify.get_sales_by_product.worst_change`, { quarter })} vs the quarter before` : `${count(V('shopify.get_sales_by_product.worst_units_on_hand', { quarter }))} units unsold`;
    return {
      quarter: quarter.replace('-', ' '),
      best: String(row.best_product),
      bestNote: F('shopify.get_sales_by_product.best_revenue', { quarter }),
      bestRef: RID('shopify.get_sales_by_product.best_revenue', { quarter }),
      worst: String(row.worst_product),
      worstNote,
      worstRef: RID(`shopify.get_sales_by_product.${worstKey}`, { quarter }),
    };
  });
  sections.push({
    area: 'Catalogue & inventory', agentId: 'audit-catalog', source: ['shopify'],
    headline: `${V('shopify.get_products.sub_eligible_skus')} of ${V('shopify.get_products.active_skus')} SKUs can be subscribed to ${R('shopify.get_products.sub_eligible_skus')}${R('shopify.get_products.active_skus')}, but the seasonal hits don't carry over from one quarter to the next.`,
    tiles: tiles(
      tile('Active SKUs', 'shopify.get_products.active_skus'),
      tile('Subscription-eligible', 'shopify.get_products.sub_eligible_skus'),
      tile('A 12oz bag lasts', 'shopify.get_products.bag_days_supply'),
      tile('Ethiopia Guji cover', 'shopify.get_inventory_levels.guji_days_cover'),
      tile('Decaf cover', 'shopify.get_inventory_levels.decaf_days_cover'),
    ),
    findings: [
      finding(`Ethiopia Guji has ${F('shopify.get_inventory_levels.guji_days_cover')} of cover ${R('shopify.get_inventory_levels.guji_days_cover')}: reorder before any campaign features it.`, 'high', 'Catalogue & inventory'),
      finding(`Decaf Swiss Water is overstocked at ${F('shopify.get_inventory_levels.decaf_days_cover')} of cover ${R('shopify.get_inventory_levels.decaf_days_cover')}. Use it as a free add-on instead of a deeper discount.`, 'med', 'Catalogue & inventory'),
      finding(`${count(V('shopify.get_sales_by_product.worst_units_on_hand', { quarter: 'Q2-2026' }))} Holiday Blend gift sets sat unsold through Q2 ${R('shopify.get_sales_by_product.worst_units_on_hand', { quarter: 'Q2-2026' })}: last holiday's dead stock.`, 'med', 'Catalogue & inventory'),
      finding(`Cold Brew Packs lead Q2 and Q3 ${R('shopify.get_sales_by_product.best_revenue', { quarter: 'Q2-2026' })}${R('shopify.get_sales_by_product.best_revenue', { quarter: 'Q3-2026' })} but fall ${F('shopify.get_sales_by_product.worst_change', { quarter: 'Q4-2025' }).replace('−', '')} in Q4 ${R('shopify.get_sales_by_product.worst_change', { quarter: 'Q4-2025' })}.`, 'low', 'Catalogue & inventory'),
    ],
  });

  // Email & SMS
  let flows: FlowStatus[] | null = null;
  if (has('klaviyo') || has('sms')) {
    const f: AuditFinding[] = [];
    if (has('klaviyo')) {
      f.push(finding(`The post-purchase flow is a single email with no subscribe offer ${R('klaviyo.get_flow_performance.sub_offer', { flowId: 'post_purchase' })}, sent to ${count(V('klaviyo.get_flow_performance.recipients', { flowId: 'post_purchase' }))} people in 90 days ${R('klaviyo.get_flow_performance.recipients', { flowId: 'post_purchase' })}.`, 'high', 'Email & SMS'));
      f.push(finding(`${V('klaviyo.list_flows.missing_standard_flows')} standard flows aren't built: browse abandonment, winback, replenishment and subscription upcoming-order ${R('klaviyo.list_flows.missing_standard_flows')}.`, 'high', 'Email & SMS'));
      f.push(finding(`Flows drive ${F('klaviyo.get_list_health.flow_share_of_email')} of email revenue ${R('klaviyo.get_list_health.flow_share_of_email')}; email is campaign-heavy, and only ${V('klaviyo.list_campaigns.sub_campaigns_90d')} of ${V('klaviyo.list_campaigns.campaigns_90d')} campaigns in 90 days mentioned subscribing ${R('klaviyo.list_campaigns.sub_campaigns_90d')}${R('klaviyo.list_campaigns.campaigns_90d')}.`, 'med', 'Email & SMS'));
      f.push(finding(`Abandoned cart places orders for ${F('klaviyo.get_flow_performance.placed_order_rate', { flowId: 'abandoned_cart' })} of recipients ${R('klaviyo.get_flow_performance.placed_order_rate', { flowId: 'abandoned_cart' })}: this one works.`, 'low', 'Email & SMS', true));
      flows = [
        { id: 'welcome', name: 'Welcome series', status: 'warn', note: `3 emails, no subscribe offer · ${F('klaviyo.get_flow_performance.placed_order_rate', { flowId: 'welcome' })} placed order`, dataRef: RID('klaviyo.get_flow_performance.placed_order_rate', { flowId: 'welcome' }) },
        { id: 'abandoned_cart', name: 'Abandoned cart', status: 'live', note: `Strong · ${F('klaviyo.get_flow_performance.placed_order_rate', { flowId: 'abandoned_cart' })} placed order`, dataRef: RID('klaviyo.get_flow_performance.placed_order_rate', { flowId: 'abandoned_cart' }) },
        { id: 'post_purchase', name: 'Post-purchase', status: 'warn', note: '1 email, no subscribe offer', dataRef: RID('klaviyo.get_flow_performance.sub_offer', { flowId: 'post_purchase' }) },
        { id: 'browse_abandonment', name: 'Browse abandonment', status: 'missing', note: `Not built · ${count(V('klaviyo.get_list_health.identified_browsers_per_month'))} identified browsers a month`, dataRef: RID('klaviyo.get_list_health.identified_browsers_per_month') },
        { id: 'winback', name: 'Winback', status: 'missing', note: 'Not built', dataRef: RID('klaviyo.list_flows.missing_standard_flows') },
        { id: 'replenishment', name: 'Replenishment', status: 'missing', note: 'Not built', dataRef: RID('klaviyo.list_flows.missing_standard_flows') },
        { id: 'sub_upcoming_order', name: 'Subscription upcoming order', status: 'missing', note: 'Not built', dataRef: RID('klaviyo.list_flows.missing_standard_flows') },
      ];
    }
    if (has('sms')) {
      f.push(finding(`SMS has ${count(V('sms.get_subscriber_count.subscribers'))} subscribers ${R('sms.get_subscriber_count.subscribers')} but only ${V('sms.list_sms_flows.live_flows')} flow (welcome) ${R('sms.list_sms_flows.live_flows')} and ${V('sms.get_sms_campaign_performance.campaigns_per_month')} campaigns a month ${R('sms.get_sms_campaign_performance.campaigns_per_month')}.`, 'med', 'Email & SMS'));
    }
    sections.push({
      area: 'Email & SMS', agentId: 'audit-lifecycle', source: (['klaviyo', 'sms'] as SourceId[]).filter(has),
      headline: has('klaviyo')
        ? `Email is ${F('klaviyo.get_list_health.email_revenue_share')} of revenue ${R('klaviyo.get_list_health.email_revenue_share')}, but no flow asks anyone to subscribe.`
        : `SMS reaches ${count(V('sms.get_subscriber_count.subscribers'))} people ${R('sms.get_subscriber_count.subscribers')} with almost no automation. Klaviyo is off, so email wasn't audited.`,
      tiles: tiles(
        tile('Email share of revenue', 'klaviyo.get_list_health.email_revenue_share'),
        tile('Flows share of email', 'klaviyo.get_list_health.flow_share_of_email'),
        tile('Email list', 'klaviyo.get_list_health.list_size'),
        tile('Engaged, 90 days', 'klaviyo.get_list_health.engaged_90d'),
        tile('Post-purchase recipients, 90d', 'klaviyo.get_flow_performance.recipients', { flowId: 'post_purchase' }),
        tile('SMS subscribers', 'sms.get_subscriber_count.subscribers'),
      ),
      findings: f,
    });
  }

  // Paid & social
  if (has('meta') || has('tiktok') || has('tiktokshop')) {
    const f: AuditFinding[] = [];
    if (has('meta')) {
      f.push(finding(`Meta buys customers at $${V('meta.get_account_performance.cac')} ${R('meta.get_account_performance.cac')}, but only ${F('meta.get_account_performance.new_customer_sub_rate')} of them subscribe within 60 days ${R('meta.get_account_performance.new_customer_sub_rate')}.`, 'high', 'Paid & social'));
      f.push(finding(`Campaigns optimise for any purchase, and only ${F('meta.get_top_creatives.sub_creative_share')} of spend runs subscription creative ${R('meta.get_top_creatives.sub_creative_share')}; the top creative is "20% off your first bag".`, 'high', 'Paid & social'));
    }
    if (has('tiktokshop')) f.push(finding(`TikTok Shop sells ${F('tiktokshop.get_shop_performance.gmv')} ${R('tiktokshop.get_shop_performance.gmv')} to ${count(V('tiktokshop.get_shop_performance.first_time_buyers'))} first-time buyers a month ${R('tiktokshop.get_shop_performance.first_time_buyers')}, and ${F('tiktokshop.get_shop_performance.sub_conversion')} of them subscribe ${R('tiktokshop.get_shop_performance.sub_conversion')}.`, 'high', 'Paid & social'));
    if (has('tiktok')) f.push(finding(`TikTok Ads return ${V('tiktok.get_ads_performance.roas')} ROAS ${R('tiktok.get_ads_performance.roas')} on ${F('tiktok.get_ads_performance.spend')} ${R('tiktok.get_ads_performance.spend')}, the weakest paid channel.`, 'med', 'Paid & social'));
    sections.push({
      area: 'Paid & social', agentId: 'audit-paid', source: (['meta', 'tiktok', 'tiktokshop'] as SourceId[]).filter(has),
      headline: has('meta')
        ? `Paid acquisition lands one-time buyers: ${F('meta.get_account_performance.spend')} on Meta ${R('meta.get_account_performance.spend')} and almost none of it sells the subscription.`
        : 'Meta is off for this run; TikTok is audited on its own.',
      tiles: tiles(
        tile('Meta spend', 'meta.get_account_performance.spend'),
        tile('Meta ROAS', 'meta.get_account_performance.roas'),
        tile('Meta CAC', 'meta.get_account_performance.cac'),
        tile('Meta buyers who subscribe', 'meta.get_account_performance.new_customer_sub_rate'),
        tile('TikTok Ads spend', 'tiktok.get_ads_performance.spend'),
        tile('TikTok Shop GMV', 'tiktokshop.get_shop_performance.gmv'),
      ),
      findings: f,
    });
  }

  // Subscriptions
  if (has('skio')) {
    sections.push({
      area: 'Subscriptions', agentId: 'audit-subs', source: ['skio'],
      headline: `A subscriber is worth ${(V('skio.get_ltv_comparison.sub_ltv') / V('skio.get_ltv_comparison.one_time_ltv')).toFixed(1)}× a one-time buyer ${R('skio.get_ltv_comparison.sub_ltv')}${R('skio.get_ltv_comparison.one_time_ltv')}, but a third of cancels are simply "too much coffee" ${R('skio.get_cancel_reasons.reason_too_much')}.`,
      tiles: tiles(
        tile('Active subscribers', 'skio.get_subscription_summary.active_subscribers'),
        tile('Subscription share of revenue', 'skio.get_subscription_summary.sub_revenue_share'),
        tile('Monthly churn', 'skio.get_churn.monthly_churn'),
        tile('Cancel-flow save rate', 'skio.get_cancel_reasons.save_rate'),
        tile('Skip usage', 'skio.get_skip_swap_usage.skip_usage'),
        tile('Dunning recovery', 'skio.get_dunning_performance.recovery_rate'),
      ),
      findings: [
        finding(`${F('skio.get_cancel_reasons.reason_too_much')} of cancels say "too much coffee" ${R('skio.get_cancel_reasons.reason_too_much')}, yet the only save offer is 10% off: nothing offers fewer bags or a skip before cancel.`, 'high', 'Subscriptions'),
        finding(`Skip is used by ${F('skio.get_skip_swap_usage.skip_usage')} of subscribers ${R('skio.get_skip_swap_usage.skip_usage')}; the default plan ships 2 bags every 4 weeks, and ${F('skio.get_subscription_summary.cadence_4w_share')} of subscribers are on it ${R('skio.get_subscription_summary.cadence_4w_share')}.`, 'high', 'Subscriptions'),
        finding(`${count(V('skio.get_cancel_reasons.cancel_sessions'))} cancel-flow sessions a month ${R('skio.get_cancel_reasons.cancel_sessions')} save ${F('skio.get_cancel_reasons.save_rate')} ${R('skio.get_cancel_reasons.save_rate')}; monthly churn is ${F('skio.get_churn.monthly_churn')} ${R('skio.get_churn.monthly_churn')}.`, 'med', 'Subscriptions'),
        finding(`Dunning recovers ${F('skio.get_dunning_performance.recovery_rate')} ${R('skio.get_dunning_performance.recovery_rate')} of ${count(V('skio.get_dunning_performance.failed_per_month'))} failed payments a month ${R('skio.get_dunning_performance.failed_per_month')}.`, 'med', 'Subscriptions'),
      ],
    });
  }

  // Support & reviews
  if (has('gorgias') || has('okendo')) {
    const f: AuditFinding[] = [];
    if (has('gorgias')) {
      const subShare = V('gorgias.get_ticket_reasons.change_skip') + V('gorgias.get_ticket_reasons.cancel_request');
      f.push(finding(`${pct(subShare, 0)} of ${count(V('gorgias.get_ticket_summary.tickets'))} tickets a month are subscription changes or cancel requests ${R('gorgias.get_ticket_reasons.change_skip')}${R('gorgias.get_ticket_reasons.cancel_request')}${R('gorgias.get_ticket_summary.tickets')}: work the portal should be doing.`, 'high', 'Support & reviews'));
      f.push(finding(`"Where is my order" is the top reason at ${F('gorgias.get_ticket_reasons.wismo')} ${R('gorgias.get_ticket_reasons.wismo')}; first response takes ${F('gorgias.get_ticket_summary.first_response')} ${R('gorgias.get_ticket_summary.first_response')}.`, 'med', 'Support & reviews'));
      f.push(finding(`Customers rate support ${F('gorgias.get_ticket_summary.csat')} out of 5 ${R('gorgias.get_ticket_summary.csat')}.`, 'low', 'Support & reviews', true));
    }
    if (has('okendo')) f.push(finding(`Reviews average ${F('okendo.get_review_summary.rating')}★ across ${count(V('okendo.get_review_summary.reviews'))} reviews ${R('okendo.get_review_summary.rating')}${R('okendo.get_review_summary.reviews')}, but only ${F('okendo.get_review_summary.request_rate')} of orders leave one ${R('okendo.get_review_summary.request_rate')}.`, 'low', 'Support & reviews', true));
    sections.push({
      area: 'Support & reviews', agentId: 'audit-cx', source: (['gorgias', 'okendo'] as SourceId[]).filter(has),
      headline: has('gorgias') ? `Support is doing the portal's job: ${pct(V('gorgias.get_ticket_reasons.change_skip') + V('gorgias.get_ticket_reasons.cancel_request'), 0)} of tickets are subscription requests ${R('gorgias.get_ticket_reasons.change_skip')}.` : `Reviews are a strength: ${F('okendo.get_review_summary.rating')}★ ${R('okendo.get_review_summary.rating')}.`,
      tiles: tiles(
        tile('Tickets a month', 'gorgias.get_ticket_summary.tickets'),
        tile('Change or skip requests', 'gorgias.get_ticket_reasons.change_skip'),
        tile('Cancel requests', 'gorgias.get_ticket_reasons.cancel_request'),
        tile('CSAT', 'gorgias.get_ticket_summary.csat'),
        tile('Average rating', 'okendo.get_review_summary.rating'),
        tile('Reviews', 'okendo.get_review_summary.reviews'),
      ),
      findings: f,
    });
  }

  // Stack
  const syncOff = R('shopify.get_installed_apps.skio_klaviyo_sync');
  sections.push({
    area: 'Stack & integrations', agentId: 'audit-stack', source: ['shopify'],
    headline: 'The tools are all installed; two wires between them are missing.',
    tiles: tiles(
      tile('Skio → Klaviyo sync', 'shopify.get_installed_apps.skio_klaviyo_sync'),
      tile('TikTok Shop → Klaviyo', 'shopify.get_installed_apps.tiktokshop_klaviyo_sync'),
      tile('Okendo connected here', 'shopify.get_installed_apps.okendo_connected'),
    ),
    findings: [
      finding(`The Skio → Klaviyo subscriber sync is off ${syncOff}: Klaviyo can't tell who already subscribes, so it can't exclude them or trigger on subscription events.`, 'high', 'Stack & integrations'),
      finding(`TikTok Shop buyers aren't synced to Klaviyo ${R('shopify.get_installed_apps.tiktokshop_klaviyo_sync')}, so they never get an email from you.`, 'high', 'Stack & integrations'),
      finding(`Okendo (reviews) and Gorgias (support) are installed but not connected to this planner ${R('shopify.get_installed_apps.okendo_connected')}, so review and ticket themes aren't in this audit.`, 'low', 'Stack & integrations'),
    ],
  });

  // Audit timelines, narration and findings
  const narration: Record<string, { think: string; text: string; skipped?: string }> = {
    'audit-analytics': { think: 'Store profile for the denominators, then repurchase, cohorts, the funnel by device, margins and channel economics. The question is about subscription, so first-time buyer → subscriber conversion is the number that matters most.', text: `Phones convert at half the laptop rate. ${pct(firstToSub)} of one-time buyers subscribe later. A $46 order leaves about $18.60 after costs, so repeat orders are where the profit is.` },
    'audit-catalog': { think: 'Check which products can be subscribed to, how long a bag lasts (for timing any replenishment offer), inventory risks, and what sells in which quarter.', text: 'A 12oz bag lasts about 14 days. Guji is about to run out; Decaf is sitting in the warehouse. Cold Brew is a summer product that collapses in Q4.' },
    'audit-lifecycle': { think: 'List the flows first, so I know what exists before pulling performance. Then post-purchase and cart performance, list health, campaigns, then SMS.', text: has('klaviyo') ? 'Three flows live, four standard ones missing. Post-purchase is one email and never mentions subscribing. Cart is the bright spot.' : 'Only SMS to audit.', skipped: 'Klaviyo and Postscript are both switched off for this run, so there is nothing to audit here. Email and SMS recommendations will say "connect to unlock".' },
    'audit-paid': { think: 'Spend and CAC first, then whether Meta buyers become subscribers (UTM-matched to Skio), then creative themes, then TikTok and TikTok Shop.', text: 'Meta is optimised for any purchase and leads with a first-order discount. TikTok Shop is a separate island: buyers never reach email or subscription.', skipped: 'Meta, TikTok Ads and TikTok Shop are all switched off for this run. Paid recommendations are locked.' },
    'audit-subs': { think: 'Subscription summary, churn, then cancel reasons: if one reason dominates, that is the retention lever. Then skip and swap, dunning, and the LTV gap that prices every conversion.', text: 'Churn is 7.8% a month and the biggest cancel reason is oversupply, which the cancel flow answers with a discount. Skip is barely used.', skipped: 'Skio is switched off for this run. Subscriber value will fall back to a benchmark estimate and cancel-flow work is locked.' },
    'audit-cx': { think: 'Tickets by reason first: how many are really about subscriptions? Then how agents handle them, then what reviews say.', text: 'Almost a third of tickets are subscription changes and cancels that customers could do themselves. Reviews are excellent.', skipped: 'Gorgias and Okendo are switched off for this run, so support and review themes are missing.' },
    'audit-stack': { think: 'Installed apps, then check each pair that the plan might depend on: Skio → Klaviyo, TikTok Shop → Klaviyo.', text: 'Everything needed is installed. The Skio → Klaviyo subscriber sync is off, which blocks any subscribe offer from excluding existing subscribers.' },
  };
  const auditCost: Record<string, number> = { 'audit-cx': 0.18, 'audit-analytics': 0.31, 'audit-catalog': 0.34, 'audit-lifecycle': 0.42, 'audit-paid': 0.29, 'audit-subs': 0.37, 'audit-stack': 0.06 };
  let auditsDone = 0;
  AUDITORS.forEach((a, i) => {
    const start = 1_200 + i * 450;
    const end = auditorEnd.get(a.id)!;
    const n = narration[a.id];
    const anyOn = a.sources.some(has);
    if (!anyOn) {
      at(start + 1_500, { type: 'agent.text', agentId: a.id, text: n.skipped ?? 'No connected sources.' });
      at(end, { type: 'agent.completed', agentId: a.id, durationMs: end - start, usage: usage(0.01, 1, 4_000, 200) });
      auditsDone = Math.max(auditsDone, end);
      return;
    }
    at(start + 1_100, { type: 'agent.thinking', agentId: a.id, text: n.think });
    const off = a.sources.filter((s) => !has(s));
    if (off.length) at(start + 1_800, { type: 'agent.text', agentId: a.id, text: `${list(off.map(SOURCE_LABEL))} ${off.length > 1 ? 'are' : 'is'} switched off for this run; auditing the rest.` });
    at(end - 2_500, { type: 'agent.text', agentId: a.id, text: n.text });
    at(end, { type: 'agent.completed', agentId: a.id, durationMs: end - start, usage: usage(auditCost[a.id], 2 + a.calls.length, 24_000, 2_400) });
    const section = sections.find((s) => s.agentId === a.id);
    if (section) at(end + 50, { type: 'audit.findings', agentId: a.id, area: section.area, headline: section.headline, findings: section.findings });
    auditsDone = Math.max(auditsDone, end);
  });

  // ---------------- store audit assembly ----------------
  const aaStart = auditsDone + 900;
  const aaEnd = aaStart + 44_000;
  const contradictions: SourceContradiction[] = [];
  if (has('klaviyo')) {
    contradictions.push({
      topic: 'Abandoned cart revenue',
      first: { source: 'klaviyo', claim: `Klaviyo attributes ${F('klaviyo.get_flow_performance.revenue_klaviyo', { flowId: 'abandoned_cart' })} in 90 days ${R('klaviyo.get_flow_performance.revenue_klaviyo', { flowId: 'abandoned_cart' })} (5-day open window)` },
      second: { source: 'shopify', claim: `Shopify sees ${F('shopify.get_store_profile.abandoned_cart_utm_revenue')} of orders with abandoned-cart UTMs ${R('shopify.get_store_profile.abandoned_cart_utm_revenue')}` },
      resolution: "Different attribution windows. Impact maths uses conversion rates, not Klaviyo's attributed revenue, so the plan isn't inflated by it.",
    });
  }
  if (has('tiktokshop')) {
    contradictions.push({
      topic: 'TikTok Shop order count',
      first: { source: 'tiktokshop', claim: `TikTok Shop reports ${count(V('tiktokshop.get_shop_performance.orders'))} orders a month ${R('tiktokshop.get_shop_performance.orders')}` },
      second: { source: 'shopify', claim: `${count(V('tiktokshop.get_shop_performance.shopify_matched_orders'))} of them reach Shopify ${R('tiktokshop.get_shop_performance.shopify_matched_orders')}` },
      resolution: "TikTok counts orders before cancels. Sizing uses TikTok's first-time buyer count and treats GMV as gross.",
    });
  }
  const missing: string[] = [
    ...offSources.map((s) => `${SOURCE_LABEL(s)} is switched off for this run, so its data is missing and anything that depends on it is locked.`),
    'Product costs and margins: no connected source reports them, so every dollar figure is revenue, not profit.',
    'Reviews (Okendo) and support tickets (Gorgias) are installed but not connected, so taste and delivery complaints are unread.',
  ];
  const researchQuestions = [
    has('klaviyo') && `Post-purchase: what do consumables brands convert when the flow includes a subscribe offer? (Here: 1 email, no offer, ${pct(firstToSub)} convert.)`,
    has('skio') && `Cancel flow: what save rates do skip or cadence-change offers get for "too much product" cancels? (Here: ${F('skio.get_cancel_reasons.reason_too_much')} of cancels, 10%-off-only flow.)`,
    has('klaviyo') && 'Winback: what do 60/90/120-day winback flows reactivate? (Here: no flow, 19k lapsed.)',
    has('meta') && `Paid: what share of new buyers subscribe when acquisition leads with the subscription? (Here: ${F('meta.get_account_performance.new_customer_sub_rate')}.)`,
    competitorNames.length ? `Competitors: how do ${list(competitorNames)} get first-time buyers into a subscription?` : 'Competitors: how do the leading coffee subscriptions get first-time buyers into a subscription?',
    'Trends: Q4 behaviour in coffee subscriptions and the current pricing climate.',
  ].filter((x): x is string => !!x);

  const profile: StoreProfile = {
    name: fixture.store.name, domain: fixture.store.domain, category: fixture.store.category, market: fixture.store.market, asOf, demo: true,
    headline: `${fixture.store.name} does ${F('shopify.get_store_profile.revenue')} a year ${R('shopify.get_store_profile.revenue')}${has('skio') ? ` with ${count(V('skio.get_subscription_summary.active_subscribers'))} subscribers ${R('skio.get_subscription_summary.active_subscribers')}` : ''}. The front door is the gap: ${count(ftb)} first-time buyers a month ${R('shopify.get_store_profile.first_time_buyers_per_month')}, ${pct(firstToSub)} of whom subscribe ${R('shopify.get_cohorts.first_to_sub_60d')}.`,
    tiles: tiles(
      tile('Revenue, 12 months', 'shopify.get_store_profile.revenue'),
      tile('Active subscribers', 'skio.get_subscription_summary.active_subscribers'),
      tile('Subscription share', 'skio.get_subscription_summary.sub_revenue_share'),
      tile('First-time buyers', 'shopify.get_store_profile.first_time_buyers_per_month'),
      tile('First-time → subscriber', 'shopify.get_cohorts.first_to_sub_60d'),
      tile('Monthly churn', 'skio.get_churn.monthly_churn'),
    ),
    sections, flows, quarters, contradictions, researchQuestions, missing,
  };
  at(aaStart, { type: 'agent.started', agentId: 'audit-assembly' });
  at(aaStart + 3_000, { type: 'agent.thinking', agentId: 'audit-assembly', text: `Six audits in, ${ledger.entries.length} data points in the ledger. The strongest signal crosses sources: Shopify shows ${pct(firstToSub)} of first-time buyers subscribe${has('klaviyo') ? ', Klaviyo shows nothing ever asks them to' : ''}${has('skio') ? ', and Skio says a subscriber is worth 3.5× a one-time buyer' : ''}. Check the sources against each other before briefing research.` });
  if (contradictions.length) at(aaStart + 19_000, { type: 'agent.text', agentId: 'audit-assembly', text: `${contradictions.length} place${contradictions.length === 1 ? '' : 's'} where two sources disagree. Neither changes the plan, but the maths will use the conservative side.` });
  at(aaStart + 31_000, { type: 'agent.text', agentId: 'audit-assembly', text: `Briefing research with ${researchQuestions.length} targeted questions instead of a general market scan.` });
  at(aaEnd, { type: 'agent.completed', agentId: 'audit-assembly', durationMs: aaEnd - aaStart, usage: usage(0.88, 2, 61_000, 7_900) });
  at(aaEnd + 50, { type: 'audit.profile', profile });

  // ---------------- research ----------------
  const rStart = aaEnd + 1_200;
  const needs: Record<string, SourceId | 'always'> = {
    b_pp: 'always', b_ltv: 'always', b_timing: 'klaviyo', b_flowshare: 'klaviyo', b_cart: 'klaviyo', b_winback: 'klaviyo', b_browse: 'klaviyo',
    b_cancel: 'skio', b_dunning: 'skio', b_meta_event: 'meta', b_meta_rate: 'meta', t_tiktok: 'tiktokshop',
  };
  const keep = (f: WebFinding) => {
    if (f.agent === 'followup-1') return false;
    if (f.key.startsWith('comp_')) {
      if (f.key === 'comp_flex') return true;
      if (f.key === 'comp_trade_cancel') return picked.includes('Trade Coffee') && has('skio');
      return picked.includes(f.key.slice(5));
    }
    const need = needs[f.key] ?? 'always';
    return need === 'always' || has(need);
  };
  interface Step { kind: 'think' | 'text' | 'search' | 'fetch'; text: string; results?: SourceRef[] }
  const scripts: Record<string, Step[]> = {
    'research-benchmarks': [
      { kind: 'think', text: `The Store Profile narrows this a lot. I don't need an email primer; I need ranges for: a subscribe offer in post-purchase (store: ${pct(firstToSub)}), ${has('skio') ? 'save rates for oversupply cancels, dunning, ' : ''}${has('klaviyo') ? 'winback reactivation, flow revenue share, ' : ''}${has('meta') ? 'and subscription-led paid acquisition.' : 'and subscriber vs one-time value.'}` },
      { kind: 'search', text: 'post-purchase flow subscribe offer conversion rate consumables benchmark', results: [webByKey.get('b_pp')!.source, webByKey.get('b_timing')!.source] },
      { kind: 'fetch', text: webByKey.get('b_pp')!.source.url },
      ...(has('skio') ? ([{ kind: 'search', text: 'cancel flow skip frequency change save rate "too much" subscription', results: [webByKey.get('b_cancel')!.source] }, { kind: 'fetch', text: webByKey.get('b_cancel')!.source.url }, { kind: 'search', text: 'subscription dunning recovery rate smart retries benchmark', results: [webByKey.get('b_dunning')!.source] }] as Step[]) : []),
      ...(has('klaviyo') ? ([{ kind: 'search', text: 'winback flow 60 90 120 day reactivation rate benchmark', results: [webByKey.get('b_winback')!.source] }, { kind: 'search', text: 'flow share of email revenue benchmark DTC', results: [webByKey.get('b_flowshare')!.source, webByKey.get('b_cart')!.source] }, { kind: 'search', text: 'browse abandonment flow conversion rate', results: [webByKey.get('b_browse')!.source] }] as Step[]) : []),
      ...(has('meta') ? ([{ kind: 'search', text: 'optimise Meta ads for subscription start custom conversion', results: [webByKey.get('b_meta_event')!.source, webByKey.get('b_meta_rate')!.source] }, { kind: 'fetch', text: webByKey.get('b_meta_rate')!.source.url }] as Step[]) : []),
      { kind: 'search', text: 'subscriber vs one-time buyer 12 month value consumables', results: [webByKey.get('b_ltv')!.source] },
      { kind: 'text', text: 'Taking the conservative end of every range for targets; the prioritiser should not be ranking on best-case numbers.' },
    ],
    'research-competitors': [
      { kind: 'think', text: `The merchant named ${competitorNames.length ? list(competitorNames) : 'no competitors'}. Look at how each gets a first-time buyer into a subscription, and whether they make flexibility visible, since oversupply is this store's top cancel reason.` },
      ...picked.map<Step>((name) => ({ kind: 'search', text: `${name} subscription how it works first order`, results: [webByKey.get(`comp_${name}`)!.source] })),
      ...(picked.length ? [{ kind: 'fetch', text: webByKey.get(`comp_${picked[0]}`)!.source.url } as Step] : []),
      { kind: 'search', text: 'coffee subscription change frequency skip bag size account', results: [webByKey.get('comp_flex')!.source] },
      ...(picked.includes('Trade Coffee') && has('skio') ? [{ kind: 'search', text: 'Trade Coffee cancel subscription fewer bags offer', results: [webByKey.get('comp_trade_cancel')!.source] } as Step, { kind: 'text', text: "Only one forum comment on Trade's cancel flow. Reporting it at low confidence." } as Step] : []),
      ...customCompetitors.map<Step>((name) => ({ kind: 'search', text: `${name} coffee subscription retention offer`, results: [] })),
      ...(customCompetitors.length ? [{ kind: 'text', text: `Nothing usable came back for ${list(customCompetitors)}. That goes in "could not verify".` } as Step] : []),
    ],
    'research-trends': [
      { kind: 'think', text: 'Q4 is 31% of this store\'s year, so seasonality matters for when to ship. Also: is oversupply a common cancel reason across consumables, and what is the pricing climate doing to discount sensitivity?' },
      { kind: 'search', text: 'coffee subscription starts by month holiday gifting', results: [webByKey.get('t_q4')!.source] },
      { kind: 'search', text: 'why people cancel consumable subscriptions too much product', results: [webByKey.get('t_toomuch')!.source] },
      { kind: 'fetch', text: webByKey.get('t_toomuch')!.source.url },
      { kind: 'search', text: 'green coffee prices 2025 roaster retail price increases', results: [webByKey.get('t_prices')!.source] },
      ...(has('tiktokshop') ? [{ kind: 'search', text: 'TikTok Shop buyers move to own site insert card QR subscription', results: [webByKey.get('t_tiktok')!.source] } as Step] : []),
    ],
  };
  const rCost: Record<string, number> = { 'research-benchmarks': 1.55, 'research-competitors': 1.35, 'research-trends': 1.38 };
  const rHeadline: Record<string, string> = {
    'research-benchmarks': 'Every gap the audit found has a published range, and the store sits below the bottom of most of them.',
    'research-competitors': picked.some((p) => p === 'Trade Coffee' || p === 'Atlas Coffee Club') ? 'The named competitors make the subscription the first purchase; this store makes it an afterthought.' : 'Competitors make flexibility visible and lead with the subscription.',
    'research-trends': 'Q4 is when coffee subscriptions start, oversupply is a common reason they stop, and shoppers are price-aware.',
  };
  let researchEnd = rStart;
  const runScript = (agentId: string, t0: number, steps: Step[], gap = 11_000) => {
    let t = t0 + 2_000;
    for (const s of steps) {
      if (s.kind === 'think') at(t, { type: 'agent.thinking', agentId, text: s.text });
      else if (s.kind === 'text') at(t, { type: 'agent.text', agentId, text: s.text });
      else if (s.kind === 'fetch') at(t, { type: 'agent.fetch', agentId, url: s.text });
      else {
        at(t, { type: 'agent.search', agentId, query: s.text });
        at(t + 4_600, { type: 'agent.search.results', agentId, query: s.text, results: s.results ?? [] });
      }
      t += s.kind === 'search' ? gap + 3_000 : gap;
    }
    return t + 6_000;
  };
  researchers.forEach((r, i) => {
    const t0 = rStart + i * 700;
    at(t0, { type: 'agent.started', agentId: r.id });
    const end = runScript(r.id, t0, scripts[r.id], 11_000 + i * 1_500);
    at(end, { type: 'agent.completed', agentId: r.id, durationMs: end - t0, usage: usage(rCost[r.id], 14 + i * 2, 88_000, 9_800) });
    researchEnd = Math.max(researchEnd, end);
  });
  // Findings in the order the researchers finish, so [cN] ids read in time order.
  researchers
    .map((r) => ({ r, end: events.find((e) => e.body.type === 'agent.completed' && e.body.agentId === r.id)!.t }))
    .sort((a, b) => a.end - b.end)
    .forEach(({ r, end }) => {
      const findings: Finding[] = WEB_FINDINGS.filter((f) => f.agent === r.id && keep(f)).map((f) => {
        const id = `c${cIds.size + 1}`;
        cIds.set(f.key, id);
        return { id, claim: f.claim, evidence: f.evidence, sources: [f.source], confidence: f.confidence };
      });
      at(end + 50, { type: 'findings', agentId: r.id, headline: rHeadline[r.id], findings });
    });

  // ---------------- opportunities ----------------
  const oStart = researchEnd + 1_200;
  const oEnd = oStart + 52_000;
  const discountCap = brief.constraints.includes('max_discount_15');
  const skioOn = has('skio');
  const subLtv = skioOn ? V('skio.get_ltv_comparison.sub_ltv') : 406;
  const oneLtv = skioOn ? V('skio.get_ltv_comparison.one_time_ltv') : 116;
  const valueSub = subLtv - oneLtv;
  const valueSubInput = skioOn
    ? { value: valueSub, display: `$${subLtv} − $${oneLtv} = $${valueSub}`, ref: `${R('skio.get_ltv_comparison.sub_ltv')}${R('skio.get_ltv_comparison.one_time_ltv')}` }
    : { value: valueSub, display: `≈ $${valueSub} (benchmark estimate)`, ref: `${C('b_ltv')}${R('shopify.get_store_profile.aov')}`, note: `Skio is off, so subscriber value is estimated: one-time value ≈ $${oneLtv} (AOV × 2.5 orders a year), a subscriber worth ~3.5× that.` };
  const downgrade = (c: Confidence): Confidence => (skioOn ? c : c === 'H' ? 'M' : 'L');
  const savedValue = skioOn ? Math.round(V('skio.get_cancel_reasons.saved_extra_orders') * V('skio.get_subscription_summary.sub_order_value')) : 0;
  const blend = Math.round((0.9 * oneLtv + 0.1 * subLtv) * 10) / 10;

  const opportunities: Opportunity[] = [
    {
      id: 'o1', title: 'Add a subscribe offer to the post-purchase flow', area: 'Email & SMS', goals: ['convert_one_time_to_sub'],
      audience: { value: ftb, display: `${count(ftb)} first-time buyers/month`, ref: R('shopify.get_store_profile.first_time_buyers_per_month') },
      currentRate: { value: firstToSub, display: pct(firstToSub), ref: R('shopify.get_cohorts.first_to_sub_60d'), note: 'of one-time buyers subscribe within 60 days' },
      targetRate: { value: 0.07, display: '7%', ref: C('b_pp'), note: 'conservative middle of the 6–9% benchmark' },
      valuePerConversion: valueSubInput,
      rationale: `${count(ftb)} people a month buy for the first time and nothing in email or SMS asks them to subscribe ${R('klaviyo.get_flow_performance.sub_offer', { flowId: 'post_purchase' })}. Brands that ask convert 6–9% ${C('b_pp')}.`,
      citeRefs: [], dataRefs: [],
      confidence: downgrade('M'), confidenceWhy: skioOn ? 'Benchmark is category-level, not coffee-specific.' : 'Benchmark is category-level, and subscriber value is estimated (Skio off).',
      effort: 'S', effortWhy: 'Klaviyo and Skio are already installed; it is one flow edit plus a sync toggle.',
      requires: ['klaviyo'],
    },
    {
      id: 'o2', title: 'Fix the cancel flow for "too much coffee"', area: 'Subscriptions', goals: ['reduce_churn'],
      audience: skioOn ? { value: Math.round(V('skio.get_cancel_reasons.cancel_sessions') * V('skio.get_cancel_reasons.reason_too_much')), display: `${count(V('skio.get_cancel_reasons.cancel_sessions') * V('skio.get_cancel_reasons.reason_too_much'))} cancel sessions/month citing "too much"`, ref: `${R('skio.get_cancel_reasons.cancel_sessions')}${R('skio.get_cancel_reasons.reason_too_much')}` } : { value: 0, display: '—' },
      currentRate: skioOn ? { value: V('skio.get_cancel_reasons.save_rate'), display: F('skio.get_cancel_reasons.save_rate'), ref: R('skio.get_cancel_reasons.save_rate'), note: 'saved today (10% off only)' } : { value: 0, display: '—' },
      targetRate: { value: 0.3, display: '30%', ref: C('b_cancel'), note: 'middle of 25–35% for cadence-change offers' },
      valuePerConversion: skioOn ? { value: savedValue, display: `${V('skio.get_cancel_reasons.saved_extra_orders')} extra orders × $${V('skio.get_subscription_summary.sub_order_value')} = $${savedValue}`, ref: `${R('skio.get_cancel_reasons.saved_extra_orders')}${R('skio.get_subscription_summary.sub_order_value')}` } : { value: 0, display: '—' },
      rationale: `The biggest cancel reason is oversupply ${R('skio.get_cancel_reasons.reason_too_much')} and the flow answers it with a discount. Skip is barely used ${R('skio.get_skip_swap_usage.skip_usage')}.`,
      citeRefs: [], dataRefs: [],
      confidence: 'H', confidenceWhy: "It's the store's own largest cancel reason, and the fix directly answers it.",
      effort: 'S', effortWhy: 'A Skio cancel-flow setting; no new tools.',
      requires: ['skio'],
    },
    {
      id: 'o3', title: 'Launch a lapsed-customer winback flow', area: 'Email & SMS', goals: ['convert_one_time_to_sub', 'acquire_direct'],
      audience: { value: V('shopify.get_cohorts.newly_lapsed_per_month'), display: `${count(V('shopify.get_cohorts.newly_lapsed_per_month'))} customers lapsing/month`, ref: R('shopify.get_cohorts.newly_lapsed_per_month') },
      currentRate: { value: V('shopify.get_cohorts.organic_reactivation_rate'), display: F('shopify.get_cohorts.organic_reactivation_rate'), ref: R('shopify.get_cohorts.organic_reactivation_rate'), note: 'come back on their own' },
      targetRate: { value: 0.05, display: '5%', ref: C('b_winback'), note: 'middle of 4–6%' },
      valuePerConversion: { value: blend, display: `$${blend} (9 in 10 at $${oneLtv}, 1 in 10 subscribes at $${subLtv})`, ref: skioOn ? `${R('skio.get_ltv_comparison.one_time_ltv')}${R('skio.get_ltv_comparison.sub_ltv')}` : C('b_ltv'), note: 'Planner assumption: 1 in 10 reactivated customers takes the subscription offer.' },
      rationale: `${count(V('shopify.get_cohorts.lapsed_customers'))} lapsed customers ${R('shopify.get_cohorts.lapsed_customers')} and no winback flow ${R('klaviyo.list_flows.missing_standard_flows')}.`,
      citeRefs: [], dataRefs: [],
      confidence: downgrade('M'), confidenceWhy: 'Benchmark range is wide and the subscription take-up is an assumption.',
      effort: 'M', effortWhy: 'A new 3-touch flow with creative, plus a holdout.',
      requires: ['klaviyo'],
    },
    {
      id: 'o4', title: 'Route TikTok Shop buyers into subscription', area: 'Paid & social', goals: ['convert_one_time_to_sub', 'acquire_direct'],
      audience: { value: V('tiktokshop.get_shop_performance.first_time_buyers'), display: `${count(V('tiktokshop.get_shop_performance.first_time_buyers'))} TikTok Shop first-time buyers/month`, ref: R('tiktokshop.get_shop_performance.first_time_buyers') },
      currentRate: { value: 0, display: '0%', ref: R('tiktokshop.get_shop_performance.sub_conversion') },
      targetRate: { value: 0.03, display: '3%', ref: `${C('b_pp')}${C('t_tiktok')}`, note: 'half the post-purchase benchmark, since most start via an insert card' },
      valuePerConversion: valueSubInput,
      rationale: `${F('tiktokshop.get_shop_performance.gmv')} of GMV ${R('tiktokshop.get_shop_performance.gmv')} with no route to subscription and no sync to Klaviyo ${R('shopify.get_installed_apps.tiktokshop_klaviyo_sync')}.`,
      citeRefs: [], dataRefs: [],
      confidence: downgrade('M'), confidenceWhy: 'Insert-card response varies; the target is deliberately low.',
      effort: 'M', effortWhy: 'A sync toggle, a printed insert and a landing page.',
      requires: ['tiktokshop'],
    },
    {
      id: 'o5', title: 'Shift Meta toward the subscription offer and optimise for sub starts', area: 'Paid & social', goals: ['acquire_direct', 'convert_one_time_to_sub'],
      audience: { value: V('meta.get_account_performance.new_customers_per_month'), display: `${count(V('meta.get_account_performance.new_customers_per_month'))} Meta first-time buyers/month`, ref: R('meta.get_account_performance.new_customers_per_month') },
      currentRate: { value: V('meta.get_account_performance.new_customer_sub_rate'), display: F('meta.get_account_performance.new_customer_sub_rate'), ref: R('meta.get_account_performance.new_customer_sub_rate') },
      targetRate: { value: 0.11, display: '11%', ref: C('b_meta_rate'), note: 'bottom of the 10–14% range' },
      valuePerConversion: valueSubInput,
      rationale: `CAC is $${V('meta.get_account_performance.cac')} ${R('meta.get_account_performance.cac')} against a subscriber worth $${subLtv}, yet ${F('meta.get_top_creatives.sub_creative_share')} of spend sells the subscription ${R('meta.get_top_creatives.sub_creative_share')}.`,
      citeRefs: [], dataRefs: [],
      confidence: downgrade('M'), confidenceWhy: 'Depends on creative quality; Meta learning phase adds noise.',
      effort: 'M', effortWhy: 'A custom conversion, a new ad set and three creatives.',
      requires: ['meta'],
      overlapNote: 'Overlaps with #1: these buyers also get the post-purchase offer. Impact counts only the lift at acquisition.',
    },
    {
      id: 'o6', title: 'Build a browse-abandonment flow', area: 'Email & SMS', goals: ['acquire_direct'],
      audience: { value: V('klaviyo.get_list_health.identified_browsers_per_month'), display: `${count(V('klaviyo.get_list_health.identified_browsers_per_month'))} identified browsers/month`, ref: R('klaviyo.get_list_health.identified_browsers_per_month') },
      currentRate: { value: 0, display: '0%', note: 'no flow' },
      targetRate: { value: 0.012, display: '1.2%', ref: C('b_browse'), note: 'low end of 1–2%' },
      valuePerConversion: { value: V('shopify.get_store_profile.aov'), display: `$${V('shopify.get_store_profile.aov')} first order only`, ref: R('shopify.get_store_profile.aov'), note: 'Conservative: many would have bought anyway.' },
      rationale: 'A standard flow that is missing, but the benchmark is thin.',
      citeRefs: [], dataRefs: [],
      confidence: 'L', confidenceWhy: 'Thin benchmark, and heavy overlap with organic purchases.',
      effort: 'S', effortWhy: 'A Klaviyo template flow.',
      requires: ['klaviyo'],
    },
    {
      id: 'o7', title: 'Tighten dunning with smart retries and an SMS card-update prompt', area: 'Subscriptions', goals: ['reduce_churn'],
      audience: skioOn ? { value: V('skio.get_dunning_performance.failed_per_month'), display: `${count(V('skio.get_dunning_performance.failed_per_month'))} failed payments/month`, ref: R('skio.get_dunning_performance.failed_per_month') } : { value: 0, display: '—' },
      currentRate: skioOn ? { value: V('skio.get_dunning_performance.recovery_rate'), display: F('skio.get_dunning_performance.recovery_rate'), ref: R('skio.get_dunning_performance.recovery_rate') } : { value: 0, display: '—' },
      targetRate: { value: 0.55, display: '55%', ref: C('b_dunning'), note: 'bottom of 55–70%' },
      valuePerConversion: skioOn ? { value: savedValue, display: `$${savedValue} per saved subscriber`, ref: `${R('skio.get_cancel_reasons.saved_extra_orders')}${R('skio.get_subscription_summary.sub_order_value')}` } : { value: 0, display: '—' },
      rationale: 'Recovery is below the benchmark range.',
      citeRefs: [], dataRefs: [],
      confidence: 'L', confidenceWhy: 'Small volume; recovery depends on card mix.',
      effort: 'S', effortWhy: 'Skio retry settings plus one SMS.',
      requires: ['skio'],
    },
  ];
  opportunities.push(
    {
      id: 'o8', title: 'Make subscribe the default on product pages', area: 'Storefront', goals: ['convert_one_time_to_sub', 'acquire_direct'],
      audience: { value: ftb, display: `${count(ftb)} first-time buyers/month`, ref: R('shopify.get_store_profile.first_time_buyers_per_month') },
      currentRate: { value: V('shopify.get_pdp_performance.first_order_sub_share'), display: F('shopify.get_pdp_performance.first_order_sub_share'), ref: R('shopify.get_pdp_performance.first_order_sub_share'), note: 'of first orders are subscriptions' },
      targetRate: { value: 0.13, display: '13%', ref: C('b_pdp_default'), note: 'below the 15–25% range, to stay conservative; desktop already gets 14%' },
      valuePerConversion: valueSubInput,
      rationale: `On a phone, subscribe sits below the fold with one-time preselected ${R('storefront.open_page.sub_default', { path: '/products/house-blend' })}, and ${F('shopify.get_pdp_performance.first_order_sub_share_mobile')} of mobile first orders are subscriptions ${R('shopify.get_pdp_performance.first_order_sub_share_mobile')} vs ${F('shopify.get_pdp_performance.first_order_sub_share_desktop')} on desktop ${R('shopify.get_pdp_performance.first_order_sub_share_desktop')}. Found by the first-time shopper agent.`,
      citeRefs: [], dataRefs: [],
      confidence: downgrade('M'), confidenceWhy: 'Desktop already shows the effect on this store; the benchmark range is wide.',
      effort: 'S', effortWhy: 'Theme and Skio settings; no new tools.',
      requires: [],
      overlapNote: 'Overlaps with the post-purchase offer: this converts at checkout, that one after the first order. Each is sized on its own; if both ship, expect some overlap.',
    },
    {
      id: 'o9', title: 'Save cancel requests in Gorgias with Skio macros', area: 'Support', goals: ['reduce_churn'],
      audience: has('gorgias') ? { value: Math.round(V('gorgias.get_ticket_summary.tickets') * V('gorgias.get_ticket_reasons.cancel_request')), display: `${count(V('gorgias.get_ticket_summary.tickets') * V('gorgias.get_ticket_reasons.cancel_request'))} cancel tickets/month`, ref: `${R('gorgias.get_ticket_summary.tickets')}${R('gorgias.get_ticket_reasons.cancel_request')}` } : { value: 0, display: '—' },
      currentRate: has('gorgias') ? { value: V('gorgias.get_macros.cancel_ticket_saves'), display: F('gorgias.get_macros.cancel_ticket_saves'), ref: R('gorgias.get_macros.cancel_ticket_saves'), note: 'kept today' } : { value: 0, display: '—' },
      targetRate: { value: 0.2, display: '20%', ref: C('b_helpdesk'), note: 'bottom of 20–30%' },
      valuePerConversion: skioOn ? { value: savedValue, display: `$${savedValue} per saved subscriber`, ref: `${R('skio.get_cancel_reasons.saved_extra_orders')}${R('skio.get_subscription_summary.sub_order_value')}` } : { value: 0, display: '—' },
      rationale: `Agents cancel on request ${R('gorgias.get_macros.cancel_ticket_saves')}. Skio's Gorgias sidebar and a save-first macro change that. Found by the subscriber agent.`,
      citeRefs: [], dataRefs: [],
      confidence: 'M', confidenceWhy: 'Benchmark from helpdesk programmes; tone of the macro matters.',
      effort: 'S', effortWhy: 'Two macros, a rule and a sidebar app.',
      requires: ['gorgias', 'skio'],
    },
    {
      id: 'o10', title: 'Send a pre-charge reminder with one-click skip and add-ons', area: 'Subscriptions', goals: ['raise_rev_per_sub', 'reduce_churn'],
      audience: skioOn ? { value: V('skio.get_subscription_summary.orders_per_month'), display: `${count(V('skio.get_subscription_summary.orders_per_month'))} subscription orders/month`, ref: R('skio.get_subscription_summary.orders_per_month') } : { value: 0, display: '—' },
      currentRate: skioOn ? { value: V('skio.get_portal_usage.addon_attach'), display: F('skio.get_portal_usage.addon_attach'), ref: R('skio.get_portal_usage.addon_attach'), note: 'of orders carry an add-on' } : { value: 0, display: '—' },
      targetRate: { value: 0.07, display: '7%', ref: C('b_addon'), note: 'bottom of 7–10%' },
      valuePerConversion: skioOn ? { value: V('skio.get_portal_usage.addon_value'), display: `$${V('skio.get_portal_usage.addon_value')} average add-on`, ref: R('skio.get_portal_usage.addon_value') } : { value: 0, display: '—' },
      rationale: `No reminder before charges ${R('skio.get_notifications.upcoming_order_reminder')}, and ${F('skio.get_notifications.regret_cancels')} of cancels come right after one ${R('skio.get_notifications.regret_cancels')}. Found by the subscriber agent.`,
      citeRefs: [], dataRefs: [],
      confidence: 'M', confidenceWhy: 'Add-on benchmark is solid; the churn effect is extra and not counted.',
      effort: 'S', effortWhy: 'One Klaviyo flow on an event Skio already sends.',
      requires: ['skio', 'klaviyo'],
      overlapNote: 'Only the add-on revenue is counted. Fewer cancels right after a charge would be a bonus.',
    },
  );
  for (const o of opportunities) {
    const text = [o.rationale, o.audience.ref, o.currentRate.ref, o.targetRate.ref, o.valuePerConversion.ref].join(' ');
    o.dataRefs = refsIn(text);
    o.citeRefs = [...new Set([...text.matchAll(/\[(c\d+)\]/g)].map((m) => m[1]))];
  }

  const followups: { question: string; kind: 'web' | 'data'; why: string }[] = [];
  if (has('klaviyo')) followups.push({ kind: 'web', question: `Is day 10 the right send day for a subscribe prompt when a bag lasts ~${V('shopify.get_products.bag_days_supply')} days?`, why: 'Timing decides whether #1 lands as "running low?" or as spam.' });
  if (f2Enabled) followups.push({ kind: 'data', question: 'How many TikTok Shop buyers could be emailed if the Klaviyo sync were on?', why: 'Decides whether #4 is an email play or an insert-card play.' });

  const ctx: Ctx = {
    R, RID, V, F, C, has, brief, isQ4: brief.timeframe === 'this_quarter', subLtv, oneLtv, asOf,
    offer: `subscribe and save 10%${discountCap ? ' (inside your 15% cap)' : ''}`,
    date: (weeks) => shortDate(addDays(asOf, Math.round(weeks * 7) + 7)),
    store: { name: fixture.store.name, domain: fixture.store.domain },
  };
  const journeys = buildJourneys(ctx);
  const journeyCost = [0.28, 0.22, 0.26];
  JOURNEY_AGENTS.forEach((j, i) => {
    const start = 1_500 + i * 600;
    const end = auditorEnd.get(j.id)!;
    const jr = journeys.find((x2) => x2.id === j.journey)!;
    at(start + 1_200, { type: 'agent.thinking', agentId: j.id, text: j.think });
    const span = end - start - 6_000;
    jr.steps.forEach((st, k) => at(start + 4_000 + (span * (k + 1)) / (jr.steps.length + 1), { type: 'journey.step', agentId: j.id, journey: jr.id, step: st }));
    at(end - 2_000, { type: 'agent.text', agentId: j.id, text: jr.headline });
    at(end, { type: 'agent.completed', agentId: j.id, durationMs: end - start, usage: usage(journeyCost[i], 3 + jr.steps.length, 30_000, 3_100) });
    at(end + 50, { type: 'journey.done', agentId: j.id, journey: jr });
  });
  const pack = buildAnalytics(ctx);
  const scorecard = buildScorecard(ctx);
  const strategy = buildStrategy(ctx);
  at(oStart + 400, { type: 'agent.started', agentId: 'growth-analyst' });
  at(oStart + 3_400, { type: 'agent.thinking', agentId: 'growth-analyst', text: 'What an agency would put on page one: where visits drop off by device, what an order leaves after costs, how long a Meta customer takes to pay back, and which channels bring customers who stay.' });
  at(oStart + 26_000, { type: 'agent.text', agentId: 'growth-analyst', text: pack.headline });
  at(oEnd - 4_000, { type: 'agent.completed', agentId: 'growth-analyst', durationMs: oEnd - oStart - 4_400, usage: usage(0.62, 3, 70_000, 7_800) });
  at(oEnd - 3_950, { type: 'analytics.pack', pack, scorecard });
  at(oStart + 800, { type: 'agent.started', agentId: 'sub-strategist' });
  at(oStart + 4_200, { type: 'agent.thinking', agentId: 'sub-strategist', text: 'Go tool by tool: where does the subscription get sold, remembered, protected and saved? Score each from 0 to 4 against what the best stores do.' });
  at(oEnd - 1_500, { type: 'agent.completed', agentId: 'sub-strategist', durationMs: oEnd - oStart - 2_300, usage: usage(0.45, 2, 52_000, 6_200) });
  at(oEnd - 1_450, { type: 'strategy.stack', strategy });

  at(oStart, { type: 'agent.started', agentId: 'opportunity-assembly' });
  at(oStart + 3_000, { type: 'agent.thinking', agentId: 'opportunity-assembly', text: 'Line up each store number against its benchmark. An opportunity only counts if it has at least two store data points behind it; generic best practice with no store gap gets dropped.' });
  at(oStart + 24_000, { type: 'agent.text', agentId: 'opportunity-assembly', text: `${opportunities.length} opportunities with store data behind them. Dropped: "launch a loyalty programme" (no store signal) and "raise prices" (the price climate cuts both ways, and price is only 21% of cancels).` });
  at(oEnd, { type: 'agent.completed', agentId: 'opportunity-assembly', durationMs: oEnd - oStart, usage: usage(1.06, 2, 72_000, 8_400) });
  at(oEnd + 50, { type: 'opportunities', items: opportunities, followups });

  // ---------------- follow-ups ----------------
  const fStart = oEnd + 1_200;
  let fEnd = fStart;
  const followupAgents: AgentDescriptor[] = followups.map((f, i) => ({ id: `followup-${i + 1}`, stage: 'followup', label: `Follow-up ${i + 1}`, task: f.question, dependsOn: ['opportunity-assembly'], model: MODELS.mid }));
  for (const a of followupAgents) at(oEnd + 100, { type: 'agent.queued', agent: a });
  if (followupAgents.length) at(oEnd + 100, { type: 'agent.queued', agent: { ...prioritiser, dependsOn: followupAgents.map((a) => a.id) } });
  followupAgents.forEach((a, i) => {
    const f = followups[i];
    const t0 = fStart + i * 500;
    at(t0, { type: 'agent.started', agentId: a.id });
    if (f.kind === 'web') {
      const end = runScript(a.id, t0, [
        { kind: 'think', text: 'The bag lasts about 14 days. The question is how many days before run-out a prompt should land.' },
        { kind: 'search', text: 'replenishment email timing days before run out consumables test', results: [webByKey.get('f_sendday')!.source] },
        { kind: 'fetch', text: webByKey.get('f_sendday')!.source.url },
      ], 12_000);
      const id = `c${cIds.size + 1}`;
      cIds.set('f_sendday', id);
      const wf = webByKey.get('f_sendday')!;
      at(end, { type: 'agent.completed', agentId: a.id, durationMs: end - t0, usage: usage(0.64, 7, 41_000, 3_900) });
      at(end + 50, { type: 'followup.answer', agentId: a.id, question: f.question, answer: 'Yes. Prompts do best 3–5 days before the typical run-out, which is day 9–11 for a 14-day bag. Day 10 stays.', findings: [{ id, claim: wf.claim, evidence: wf.evidence, sources: [wf.source], confidence: wf.confidence }] });
      fEnd = Math.max(fEnd, end + 50);
    } else {
      at(t0 + 2_000, { type: 'agent.thinking', agentId: a.id, text: 'This is a data question, not a web one. Pull the buyer sync status and email coverage from TikTok Shop.' });
      // The last store pull of the run, so its ledger id still follows time order.
      const pt = t0 + 9_000;
      const res = callTool(ledger, 'tiktokshop', 'get_shop_customers_sync_status');
      const callId = `call_${++callN}`;
      at(pt, { type: 'tool.call', agentId: a.id, source: 'tiktokshop', tool: 'tiktokshop.get_shop_customers_sync_status', args: {}, callId });
      res.entries.forEach((entry, k) => at(pt + 500 + k * 40, { type: 'ledger.entry', agentId: a.id, entry }));
      at(pt + 700, { type: 'tool.result', agentId: a.id, source: 'tiktokshop', tool: 'tiktokshop.get_shop_customers_sync_status', callId, ledgerIds: res.ledgerIds });
      const end = pt + 14_000;
      const share = V('tiktokshop.get_shop_customers_sync_status.buyers_with_email');
      const reachable = Math.round(V('tiktokshop.get_shop_performance.first_time_buyers') * share);
      at(end, { type: 'agent.completed', agentId: a.id, durationMs: end - t0, usage: usage(0.21, 3, 18_000, 1_700) });
      at(end + 50, { type: 'followup.answer', agentId: a.id, question: f.question, answer: `${F('tiktokshop.get_shop_customers_sync_status.buyers_with_email')} of TikTok Shop buyers have a usable email ${R('tiktokshop.get_shop_customers_sync_status.buyers_with_email')}: about ${count(reachable)} of ${count(V('tiktokshop.get_shop_performance.first_time_buyers'))} first-time buyers a month could enter the post-purchase flow once the sync is on. The insert card covers the rest.`, findings: [] });
      fEnd = Math.max(fEnd, end + 50);
    }
  });

  // ---------------- prioritise (maths in code) ----------------
  const pStart = fEnd + 1_200;
  const pEnd = pStart + 38_000;
  const TEST_SPECS: Record<string, { baseline: number; target: number; eligible: number; eligibleNote: string; lag: number; hypothesis: string; design: string; primary: string; guardrails: string[]; decision: string; proxy?: string }> = {
    o1: { baseline: firstToSub, target: 0.06, eligible: ftb, eligibleNote: `first-time buyers a month ${R('shopify.get_store_profile.first_time_buyers_per_month')}, all of whom enter the flow`, lag: 3, hypothesis: `A day-10 subscribe offer raises 60-day first-time → subscription conversion from ${pct(firstToSub)} to at least 6%.`, design: 'Klaviyo flow A/B split 50/50 on email 2 (offer vs. no email 2). SMS follow-up only in the offer arm.', primary: 'Subscription starts within 60 days of first order', guardrails: ['Unsubscribe rate', 'One-time repeat purchase rate', 'Discount cost per subscription'], decision: 'Ship to everyone if the lift is at least 1 point and the unsubscribe rate rises less than 0.2 points.', proxy: 'Early read at 3 weeks on sub starts within 14 days of email 2; final read at 60 days.' },
    o2: { baseline: skioOn ? V('skio.get_cancel_reasons.save_rate') : 0.12, target: 0.18, eligible: skioOn ? V('skio.get_cancel_reasons.cancel_sessions') : 900, eligibleNote: `cancel-flow sessions a month ${R('skio.get_cancel_reasons.cancel_sessions')}`, lag: 1, hypothesis: 'Offering "fewer bags" and "skip" before any discount raises the cancel-flow save rate from 12% to at least 18%.', design: 'Skio cancel flow split 50/50: new flexibility-first offers vs. today\'s 10%-off-only flow.', primary: 'Cancel-flow save rate', guardrails: ['Re-cancel within 30 days', 'Revenue per saved subscriber'], decision: 'Ship if the save rate reaches 16% or more and fewer than 25% of saves re-cancel within 30 days.' },
    o3: { baseline: 0.02, target: 0.04, eligible: V('shopify.get_cohorts.newly_lapsed_per_month'), eligibleNote: `customers lapsing a month ${R('shopify.get_cohorts.newly_lapsed_per_month')}`, lag: 4, hypothesis: 'A 60/90/120-day winback flow with a subscription-first offer doubles 90-day reactivation from 2% to 4%.', design: '50% holdout: half of customers crossing 60 days without an order get no winback flow.', primary: 'Orders or subscription starts within 90 days of entering', guardrails: ['Discount cost as a share of reactivated revenue', 'Unsubscribe rate'], decision: 'Ship if reactivation lifts by 1.5 points or more and discount cost stays under 15% of reactivated revenue.', proxy: 'Early read at 30 days; final at 90.' },
    o4: { baseline: 0, target: 0.03, eligible: V('tiktokshop.get_shop_performance.first_time_buyers'), eligibleNote: `TikTok Shop first-time buyers a month ${R('tiktokshop.get_shop_performance.first_time_buyers')}`, lag: 4, hypothesis: 'An insert card plus Klaviyo sync gets at least 3% of TikTok Shop first-time buyers to subscribe within 60 days.', design: 'Alternate weeks: card in every order on odd weeks, none on even weeks (packing can\'t randomise per order).', primary: 'TikTok Shop first-time buyers who subscribe within 60 days', guardrails: ['TikTok Shop return rate', 'Card print cost per subscription start'], decision: 'Keep the card if conversion is 2% or more and cost per subscription start is under $15.' },
    o5: { baseline: 0.09, target: 0.13, eligible: V('meta.get_account_performance.new_customers_per_month'), eligibleNote: `Meta first-time buyers a month ${R('meta.get_account_performance.new_customers_per_month')}`, lag: 4, hypothesis: 'A sub-start-optimised ad set with subscription creative lifts the share of new Meta buyers who subscribe from 9% to 13%.', design: 'Split prospecting 50/50: current purchase-optimised ad set vs. sub-start-optimised ad set with subscription creative.', primary: 'Share of new buyers who subscribe within 60 days', guardrails: ['Blended CAC', 'Cost per subscription start', 'ROAS'], decision: 'Move budget if cost per subscription start falls 20% or more with CAC up less than 10%.', proxy: 'The detectable lift is loosened to 4 points; 9% → 11% would take about 9 months at this volume (see feasibility).' },
    o6: { baseline: 0, target: 0.012, eligible: V('klaviyo.get_list_health.identified_browsers_per_month'), eligibleNote: 'identified browsers a month', lag: 1, hypothesis: 'A browse-abandonment flow converts at least 1.2% of identified browsers.', design: '80/20 holdout on the flow trigger.', primary: 'Orders within 7 days of the browse', guardrails: ['Unsubscribe rate'], decision: 'Keep if conversion is at least 1% with no unsubscribe spike.' },
    o8: { baseline: V('shopify.get_pdp_performance.first_order_sub_share'), target: 0.13, eligible: ftb, eligibleNote: `first-time buyers a month ${R('shopify.get_store_profile.first_time_buyers_per_month')}`, lag: 0, hypothesis: `Making subscription the default, visible option on product pages raises the share of first orders placed as subscriptions from ${F('shopify.get_pdp_performance.first_order_sub_share')} to at least 13%.`, design: 'Phones get the new product page; laptops keep today\'s page for 3 weeks as the comparison.', primary: 'First orders placed as a subscription', guardrails: ['Conversion rate', 'Average order value'], decision: 'Ship everywhere if phone subscription share rises 3 points or more with conversion flat.' },
    o9: { baseline: has('gorgias') ? V('gorgias.get_macros.cancel_ticket_saves') : 0.04, target: 0.15, eligible: has('gorgias') ? Math.round(V('gorgias.get_ticket_summary.tickets') * V('gorgias.get_ticket_reasons.cancel_request')) : 209, eligibleNote: `cancel tickets a month ${R('gorgias.get_ticket_reasons.cancel_request')}`, lag: 4, hypothesis: 'Offering skip or a slower schedule first keeps at least 15% of subscribers who write in to cancel.', design: 'Alternate weeks: save-first macro on odd weeks, today\'s process on even weeks.', primary: 'Cancel tickets that end with the subscription kept (30 days later)', guardrails: ['CSAT', 'First response time'], decision: 'Keep it if 15% or more are kept and CSAT holds.' },
    o10: { baseline: skioOn ? V('skio.get_portal_usage.addon_attach') : 0.04, target: 0.06, eligible: skioOn ? V('skio.get_subscription_summary.orders_per_month') : 6300, eligibleNote: `subscription orders a month ${R('skio.get_subscription_summary.orders_per_month')}`, lag: 0, hypothesis: 'A pre-charge email with a one-click add-on button lifts add-on attach from 4% to at least 6%.', design: 'Klaviyo split 50/50: reminder with add-on button vs reminder with skip/change only.', primary: 'Subscription orders with an add-on', guardrails: ['Skips per order', 'Cancels within 48 hours of a charge'], decision: 'Keep the button if attach reaches 6% or more.' },
    o7: { baseline: 0.48, target: 0.55, eligible: skioOn ? V('skio.get_dunning_performance.failed_per_month') : 188, eligibleNote: 'failed payments a month', lag: 2, hypothesis: 'Smart retries plus an SMS card-update prompt lift recovery from 48% to 55%.', design: 'Pre/post comparison over 8 weeks (volume is too low to split).', primary: 'Dunning recovery rate', guardrails: ['Retry fees', 'Complaints'], decision: 'Keep if recovery reaches 53% or more.' },
  };
  const testOf = (o: Opportunity) => {
    const s = TEST_SPECS[o.id];
    const n = sampleSizePerArm(s.baseline, s.target);
    const enrol = weeksToEnrol(n, s.eligible);
    return { s, n, enrol, total: enrol + s.lag };
  };
  const constraintBlocks: Record<string, string[]> = { dont_touch_paid: ['o5'] };
  const scored: ScoredOpportunity[] = opportunities.map((o) => {
    const missingSrc = o.requires.filter((s) => !has(s));
    const impact = missingSrc.length ? 0 : annualImpact(o.audience.value, o.currentRate.value, o.targetRate.value, o.valuePerConversion.value);
    const deltaPts = Math.round((o.targetRate.value - o.currentRate.value) * 1000) / 10;
    const excludedBy = Object.entries(constraintBlocks).find(([c, ids]) => brief.constraints.includes(c) && ids.includes(o.id))?.[0];
    const { total } = testOf(o);
    return {
      ...o,
      rank: null,
      annualImpact: impact,
      maths: `${count(o.audience.value)} × ${deltaPts} pts × $${o.valuePerConversion.value} × 12 = ${usd(impact)}`,
      score: missingSrc.length ? 0 : score(impact, o.confidence, o.effort),
      timeToSignalWeeks: Math.round(total),
      goalFit: !!brief.goal && o.goals.includes(brief.goal),
      ...(missingSrc.length ? { locked: { missing: missingSrc, message: `Connect ${list(missingSrc.map(SOURCE_LABEL))} to unlock this. It needs that data to size and build.` } } : {}),
      ...(excludedBy && !missingSrc.length ? { excluded: { constraint: excludedBy, message: `Ruled out by your constraint: "${CONSTRAINT_LABELS[excludedBy]}".` } } : {}),
    };
  });
  const ranked = scored.filter((o) => !o.locked && !o.excluded).sort((a, b) => b.score - a.score);
  ranked.forEach((o, i) => (o.rank = i + 1));
  const priorities = [...ranked, ...scored.filter((o) => o.excluded && !o.locked), ...scored.filter((o) => o.locked)];
  const top5 = ranked.slice(0, 5);

  at(pStart, { type: 'agent.started', agentId: 'prioritiser' });
  at(pStart + 3_000, { type: 'agent.thinking', agentId: 'prioritiser', text: 'Inputs only: audience, current rate, target rate, value per conversion, confidence and effort. The orchestrator multiplies. Every input must carry a [d] or [c] reference, or the opportunity is dropped.' });
  if (offSources.length) at(pStart + 14_000, { type: 'agent.text', agentId: 'prioritiser', text: `${scored.filter((o) => o.locked).length} opportunit${scored.filter((o) => o.locked).length === 1 ? 'y is' : 'ies are'} locked because ${list(offSources.map(SOURCE_LABEL))} ${offSources.length > 1 ? 'are' : 'is'} off.` });
  at(pStart + 22_000, { type: 'agent.text', agentId: 'prioritiser', text: `Ranked: ${ranked.slice(0, 3).map((o) => `#${o.rank} ${o.title.toLowerCase()} (${usd(o.annualImpact)}/yr)`).join('; ')}.` });
  at(pEnd, { type: 'agent.completed', agentId: 'prioritiser', durationMs: pEnd - pStart, usage: usage(0.79, 2, 54_000, 5_100) });
  at(pEnd + 50, { type: 'priorities', items: priorities });

  // ---------------- plan ----------------
  const plStart = pEnd + 1_200;
  const plEnd = plStart + 61_000;
  const offer = `subscribe and save 10%${discountCap ? ' (inside your 15% cap)' : ''}`;
  const syncStep = has('skio') && has('klaviyo') ? `Turn on the Skio → Klaviyo subscriber sync first. The audit found it off ${syncOff}, so today Klaviyo can't tell who already subscribes.` : null;
  const isQ4 = brief.timeframe === 'this_quarter';
  const capacity = brief.capacity ?? 'small_team';
  const successBy = (weeks: number) => shortDate(addDays(asOf, Math.round(weeks * 7) + 7));
  const INITIATIVES: Record<string, () => Omit<Initiative, 'rank' | 'title' | 'opportunityId'>> = {
    o1: () => ({
      why: `${count(ftb)} first-time buyers a month ${R('shopify.get_store_profile.first_time_buyers_per_month')} convert at ${pct(firstToSub)} ${R('shopify.get_cohorts.first_to_sub_60d')}, and the post-purchase flow never asks ${R('klaviyo.get_flow_performance.sub_offer', { flowId: 'post_purchase' })}. Brands that ask convert 6–9% ${C('b_pp')}, and a prompt 3–5 days before run-out works best ${C('f_sendday')}.${isQ4 ? ` Q4 is ${F('shopify.get_store_profile.q4_revenue_share')} of your year ${R('shopify.get_store_profile.q4_revenue_share')}: ship before Black Friday (Nov 27).` : ''}`,
      steps: [
        ...(syncStep ? [syncStep] : []),
        `In Klaviyo, open "Post-Purchase: Thank you" and add email 2 at day 10 ("Running low?"), since a 12oz bag lasts about ${V('shopify.get_products.bag_days_supply')} days ${R('shopify.get_products.bag_days_supply')}.`,
        `Offer ${offer}, with a one-click Skio subscribe link that turns their last order into the 2-bag, 4-week plan.${isQ4 ? ' For Holiday Blend buyers, make Holiday Blend the first shipment.' : ''}`,
        ...(has('sms') ? [`Add an SMS at day 12 for SMS subscribers who didn't open email 2 (${count(V('sms.get_subscriber_count.subscribers'))} SMS subscribers ${R('sms.get_subscriber_count.subscribers')}).`] : []),
        'Exclude anyone who already subscribes, and split email 2 50/50 for the test (see Test plan).',
      ],
      owner: 'Email/lifecycle owner', tools: ['Klaviyo', 'Skio', ...(has('sms') ? ['Postscript'] : [])], dependencies: syncStep ? ['Skio → Klaviyo subscriber sync'] : [],
      success: { metric: '60-day first-time → subscription conversion', target: `${pct(firstToSub)} → 6% or more`, by: successBy(testOf(opportunities[0]).total) },
    }),
    o2: () => ({
      why: `${F('skio.get_cancel_reasons.reason_too_much')} of cancels are "too much coffee" ${R('skio.get_cancel_reasons.reason_too_much')} and the flow only offers 10% off. Skip is used by ${F('skio.get_skip_swap_usage.skip_usage')} ${R('skio.get_skip_swap_usage.skip_usage')}. Cadence-change offers save 25–35% of these cancels ${C('b_cancel')}, and oversupply is a common reason across consumables ${C('t_toomuch')}.`,
      steps: [
        'In the Skio cancel flow, add a reason-specific path for "too much coffee": offer "1 bag every 4 weeks" and "Skip my next delivery" before any discount.',
        'Move 10% off to second place for that reason, and keep it first for "price".',
        `Put "Change frequency" and "Skip" on the portal home, not only inside the cancel flow.`,
        'Run it as a 50/50 test on all cancel sessions (see Test plan).',
      ],
      owner: 'Retention/CX lead', tools: ['Skio'], dependencies: [],
      success: { metric: 'Cancel-flow save rate', target: '12% → 18% or more', by: successBy(testOf(opportunities[1]).total) },
    }),
    o3: () => ({
      why: `${count(V('shopify.get_cohorts.lapsed_customers'))} lapsed customers ${R('shopify.get_cohorts.lapsed_customers')}, ${count(V('shopify.get_cohorts.newly_lapsed_per_month'))} more a month ${R('shopify.get_cohorts.newly_lapsed_per_month')}, and no winback flow. Winback flows reactivate 4–6% ${C('b_winback')}.`,
      steps: [
        'Build a Klaviyo winback flow triggered at 60 days since last order, with touches at 60, 90 and 120 days.',
        `Lead with the subscription, not a one-time code: 60 days is a "new roast" story, 90 days adds ${offer}, 120 days is a last call.`,
        `Use Decaf Swiss Water (${F('shopify.get_inventory_levels.decaf_days_cover')} of cover ${R('shopify.get_inventory_levels.decaf_days_cover')}) as the free add-on in the 120-day email instead of a deeper discount.`,
        ...(has('sms') ? ['Add an SMS on the 90-day touch for SMS subscribers.'] : []),
        'Hold out 50% of lapsing customers to measure it (see Test plan).',
      ],
      owner: 'Email/lifecycle owner', tools: ['Klaviyo', 'Skio', ...(has('sms') ? ['Postscript'] : [])], dependencies: syncStep ? ['Skio → Klaviyo subscriber sync'] : [],
      success: { metric: '90-day reactivation', target: '2% → 4% or more', by: successBy(testOf(opportunities[2]).total) },
    }),
    o4: () => ({
      why: `${F('tiktokshop.get_shop_performance.gmv')} of TikTok Shop GMV ${R('tiktokshop.get_shop_performance.gmv')}, ${F('tiktokshop.get_shop_performance.sub_conversion')} subscribe ${R('tiktokshop.get_shop_performance.sub_conversion')}, and buyers never reach Klaviyo ${R('shopify.get_installed_apps.tiktokshop_klaviyo_sync')}. Insert cards are the standard bridge ${C('t_tiktok')}.`,
      steps: [
        ...(has('klaviyo') ? [`Connect TikTok Shop to Klaviyo; ${F('tiktokshop.get_shop_customers_sync_status.buyers_with_email')} of buyers have a usable email ${R('tiktokshop.get_shop_customers_sync_status.buyers_with_email')}.`] : []),
        `Add an insert card to every TikTok Shop order: a QR code to "Make it a subscription", ${offer}.`,
        ...(has('klaviyo') ? ['Enter synced buyers into the post-purchase flow (#1) with a TikTok-specific first email.'] : []),
        'Measure with alternating card and no-card weeks (see Test plan).',
      ],
      owner: 'Ecommerce/marketplace lead', tools: ['TikTok Shop', 'Skio', ...(has('klaviyo') ? ['Klaviyo'] : [])], dependencies: has('klaviyo') ? ['TikTok Shop → Klaviyo sync'] : [],
      success: { metric: 'TikTok Shop first-time buyers who subscribe', target: '0% → 3%', by: successBy(testOf(opportunities[3]).total) },
    }),
    o5: () => ({
      why: `Meta CAC is $${V('meta.get_account_performance.cac')} ${R('meta.get_account_performance.cac')} against a subscriber worth $${subLtv}, but only ${F('meta.get_account_performance.new_customer_sub_rate')} of Meta buyers subscribe ${R('meta.get_account_performance.new_customer_sub_rate')} and ${F('meta.get_top_creatives.sub_creative_share')} of spend sells the subscription ${R('meta.get_top_creatives.sub_creative_share')}. Optimising for the downstream event shifts who Meta finds ${C('b_meta_event')}.`,
      steps: [
        'Send a "Subscription started" event from Skio to Meta (Conversions API) as a custom conversion.',
        `Move 25% of prospecting (about $11k of ${F('meta.get_account_performance.prospecting_spend')} ${R('meta.get_account_performance.prospecting_spend')}) into a new ad set optimised for subscription starts. A shift, not an increase.`,
        'Brief three subscription-led creatives: "never run out", flexible cadence, and a first-shipment offer, instead of "20% off your first bag".',
        'Compare cost per subscription start across the two ad sets (see Test plan).',
      ],
      owner: 'Paid social lead or agency', tools: ['Meta Ads', 'Skio'], dependencies: [],
      success: { metric: 'Share of new Meta buyers who subscribe', target: '9% → 13%', by: successBy(testOf(opportunities[4]).total) },
    }),
    o6: () => ({ why: 'Missing standard flow; low confidence.', steps: ['Clone the Klaviyo browse-abandonment template, one email at 4 hours.', 'Show the viewed product with its subscription price.', 'Hold out 20%.'], owner: 'Email/lifecycle owner', tools: ['Klaviyo'], dependencies: [], success: { metric: 'Orders from browsers', target: '≥ 1%', by: successBy(6) } }),
    o8: () => ({
      why: `${F('shopify.get_pdp_performance.first_order_sub_share_mobile')} of mobile first orders are subscriptions ${R('shopify.get_pdp_performance.first_order_sub_share_mobile')} against ${F('shopify.get_pdp_performance.first_order_sub_share_desktop')} on desktop ${R('shopify.get_pdp_performance.first_order_sub_share_desktop')}, where the option is visible. Stores that default to subscription get 15–25% ${C('b_pdp_default')}.`,
      steps: ['Preselect Subscribe & save on every product page and show its price up front.', 'Move the widget right under the price on mobile.', 'Add "Skip, change or cancel anytime" and a subscriber review under it.', 'Turn on Skio Checkout Upgrade and Save.', 'Update the welcome email so it tells the same story.'],
      owner: 'Ecommerce lead', tools: ['Shopify theme', 'Skio', 'Klaviyo'], dependencies: [],
      success: { metric: 'First orders placed as a subscription', target: `${F('shopify.get_pdp_performance.first_order_sub_share')} → 13% or more`, by: successBy(4) },
    }),
    o9: () => ({
      why: `${F('gorgias.get_ticket_reasons.cancel_request')} of tickets are cancel requests ${R('gorgias.get_ticket_reasons.cancel_request')} and only ${F('gorgias.get_macros.cancel_ticket_saves')} are saved ${R('gorgias.get_macros.cancel_ticket_saves')}. Offering a skip first keeps 20–30% ${C('b_helpdesk')}.`,
      steps: ['Install Skio\'s Gorgias sidebar.', 'Create Quick Action links for skip, every 8 weeks and pause.', 'Add a save-first macro and a do-it-for-them skip macro.', 'Auto-tag cancel requests so the macro is suggested.'],
      owner: 'Support lead', tools: ['Gorgias', 'Skio'], dependencies: [],
      success: { metric: 'Cancel tickets kept', target: '4% → 15% or more', by: successBy(8) },
    }),
    o10: () => ({
      why: `No reminder before charges ${R('skio.get_notifications.upcoming_order_reminder')}; ${F('skio.get_notifications.regret_cancels')} of cancels happen right after one ${R('skio.get_notifications.regret_cancels')}. Add-on buttons lift attach to 7–10% ${C('b_addon')}.`,
      steps: ['Set Skio\'s billing reminder to 3 days before each charge.', 'Create Quick Actions: add a bag, skip, every 6 weeks.', 'Build a Klaviyo flow on "Skio: Billing Reminder Notification" with a 50/50 split.', ...(has('sms') ? ['Add a Postscript text: reply SKIP to skip.'] : [])],
      owner: 'Email/lifecycle owner', tools: ['Skio', 'Klaviyo', ...(has('sms') ? ['Postscript'] : [])], dependencies: [],
      success: { metric: 'Orders with an add-on', target: '4% → 6% or more', by: successBy(4) },
    }),
    o7: () => ({ why: 'Recovery below the benchmark range.', steps: ['In Skio, retry at 1, 3 and 7 days instead of 2 attempts in 5 days.', 'Add an SMS card-update link on the first failure.', 'Compare recovery for 8 weeks before and after.'], owner: 'Retention/CX lead', tools: ['Skio', ...(has('sms') ? ['Postscript'] : [])], dependencies: [], success: { metric: 'Dunning recovery', target: '48% → 55%', by: successBy(10) } }),
  };
  const initiatives: Initiative[] = top5.map((o) => ({ opportunityId: o.id, rank: o.rank!, title: o.title, ...INITIATIVES[o.id]() }));

  // Roadmap: sequence by rank, capacity and dependencies.
  const perBlock = capacity === 'solo' ? 1 : capacity === 'agency' ? 3 : 2;
  const blocks: RoadmapItem[][] = [[], [], [], []];
  if (syncStep) blocks[0].push({ title: 'Turn on the Skio → Klaviyo subscriber sync', kind: 'enabler' });
  blocks[0].push({ title: `Reorder Ethiopia Guji (${F('shopify.get_inventory_levels.guji_days_cover')} of cover)`, kind: 'enabler' });
  const builds = capacity === 'agency' ? ranked.slice(0, 7) : ranked.slice(0, 5);
  builds.forEach((o, i) => {
    const b = Math.min(3, Math.floor(i / perBlock));
    blocks[b].push({ title: `Build #${o.rank}: ${o.title}`, opportunityId: o.id, kind: 'build' });
    const readWeek = b * 4.3 + 2 + testOf(o).total;
    const rb = readWeek <= 4.3 ? 0 : readWeek <= 8.6 ? 1 : readWeek <= 13 ? 2 : 3;
    blocks[Math.max(rb, b)].push({ title: `Read out test #${o.rank} (~week ${Math.round(readWeek)})`, opportunityId: o.id, kind: 'readout' });
  });
  const roadmap: Roadmap = {
    capacityNote: `${CAPACITY_LABELS[capacity]}: ${perBlock} build${perBlock > 1 ? 's' : ''} per 30-day block, highest score first, enablers before the builds that need them.${brief.timeframe === 'next_30_days' ? ' You asked for 30 days: the first block is the plan; the rest is what comes next.' : ''}`,
    days30: blocks[0], days60: blocks[1], days90: blocks[2], later: blocks[3],
  };

  const tests: TestPlan[] = top5.map((o) => {
    const { s, n, enrol, total } = testOf(o);
    return {
      opportunityId: o.id, rank: o.rank!, title: o.title,
      hypothesis: s.hypothesis, design: s.design, primaryMetric: s.primary, guardrails: s.guardrails,
      baseline: s.baseline, target: s.target, nPerArm: n, eligiblePerMonth: s.eligible, eligibleNote: s.eligibleNote,
      weeksToEnrol: Math.round(enrol * 10) / 10, readoutLagWeeks: s.lag, totalWeeks: Math.round(total * 10) / 10,
      decisionRule: s.decision, proxy: s.proxy,
    };
  });
  const feasibility: FeasibilityCheck[] = [];
  if (skioOn) {
    const n = sampleSizePerArm(V('skio.get_churn.monthly_churn'), 0.068);
    feasibility.push({ name: 'Test churn directly (7.8% → 6.8% a month)', baseline: V('skio.get_churn.monthly_churn'), target: 0.068, nPerArm: n, available: V('skio.get_subscription_summary.active_subscribers'), availableLabel: `active subscribers in total ${R('skio.get_subscription_summary.active_subscribers')}`, feasible: false, instead: 'Needs more subscribers per arm than the store has. Test the cancel-flow save rate instead (12% → 18%, about 550 per arm).' });
  }
  if (has('meta') && top5.some((o) => o.id === 'o5')) {
    const n = sampleSizePerArm(0.09, 0.11);
    feasibility.push({ name: 'Meta at the planning target (9% → 11%)', baseline: 0.09, target: 0.11, nPerArm: n, available: V('meta.get_account_performance.new_customers_per_month'), availableLabel: `new Meta buyers a month ${R('meta.get_account_performance.new_customers_per_month')} (≈ ${Math.round(weeksToEnrol(n, V('meta.get_account_performance.new_customers_per_month')))} weeks to enrol)`, feasible: false, instead: 'Too slow for a quarter. The test looks for a bigger lift (9% → 13%), with cost per subscription start as the early signal.' });
  }

  // ---------------- summary report ----------------
  const flowShareId = RID('klaviyo.get_list_health.flow_share_of_email');
  const writeSummary = (draft: boolean) => {
    const top3 = ranked.slice(0, 3);
    const total5 = top5.reduce((s, o) => s + o.annualImpact, 0);
    const revenue = V('shopify.get_store_profile.revenue');
    const where: string[] = [];
    where.push(`${fixture.store.name} did ${F('shopify.get_store_profile.revenue')} in the last 12 months ${R('shopify.get_store_profile.revenue')} from ${count(V('shopify.get_store_profile.customers'))} customers ${R('shopify.get_store_profile.customers')}.${skioOn ? ` Subscriptions are ${F('skio.get_subscription_summary.sub_revenue_share')} of revenue ${R('skio.get_subscription_summary.sub_revenue_share')} from ${count(V('skio.get_subscription_summary.active_subscribers'))} active subscribers ${R('skio.get_subscription_summary.active_subscribers')}, and a subscriber is worth $${subLtv} over 12 months against $${oneLtv} for a one-time buyer ${R('skio.get_ltv_comparison.sub_ltv')}${R('skio.get_ltv_comparison.one_time_ltv')}.` : ''}`);
    let gap = `The gap is at the front door: ${count(ftb)} people buy for the first time each month ${R('shopify.get_store_profile.first_time_buyers_per_month')}, ${F('shopify.get_pdp_performance.first_order_sub_share')} of first orders are subscriptions ${R('shopify.get_pdp_performance.first_order_sub_share')}, and only ${pct(firstToSub)} of the one-time buyers subscribe later ${R('shopify.get_cohorts.first_to_sub_60d')}.`;
    if (has('klaviyo')) gap += ` Nothing asks them to: the post-purchase flow is one email with no subscribe offer ${R('klaviyo.get_flow_performance.sub_offer', { flowId: 'post_purchase' })}, and flows drive only ${draft ? '22%' : F('klaviyo.get_list_health.flow_share_of_email')} of email revenue [${flowShareId}], against 30–45% at mature brands ${C('b_flowshare')}.`;
    where.push(gap);
    if (skioOn) where.push(`Once people do subscribe, ${F('skio.get_cancel_reasons.reason_too_much')} of cancels are "too much coffee" ${R('skio.get_cancel_reasons.reason_too_much')}, and the cancel flow's only answer is 10% off.`);

    const effortWord: Record<Effort, string> = { S: 'small', M: 'medium', L: 'large' };
    const moves = top3.map((o) => `${o.rank}. **${o.title}**: about ${usd(o.annualImpact)} a year, ${effortWord[o.effort]} effort, first signal in ~${o.timeToSignalWeeks} weeks.`);
    const goalNote = (() => {
      if (!brief.goal || !ranked.length || ranked[0].goalFit) return '';
      const best = ranked.find((o) => o.goalFit);
      const goalText = GOAL_LABELS[brief.goal]?.toLowerCase() ?? brief.goal;
      if (!best) return `\n\nYou asked to ${goalText}. Nothing in the connected data ranks for that goal yet; the moves above are where the money is.`;
      return `\n\nYou asked to ${goalText}. The biggest move for that is **#${best.rank} ${best.title.toLowerCase()}** (${usd(best.annualImpact)} a year). #1 still ranks first because it's worth more for similar effort.`;
    })();
    const locked = scored.filter((o) => o.locked);

    const working: string[] = [];
    if (has('klaviyo')) working.push(`Abandoned cart places orders for ${F('klaviyo.get_flow_performance.placed_order_rate', { flowId: 'abandoned_cart' })} of recipients ${R('klaviyo.get_flow_performance.placed_order_rate', { flowId: 'abandoned_cart' })}, above the usual 3–5% ${C('b_cart')}. Leave it alone.`);
    working.push(`Cold Brew Packs carried Q2 and Q3 (${F('shopify.get_sales_by_product.best_revenue', { quarter: 'Q2-2026' })} and ${F('shopify.get_sales_by_product.best_revenue', { quarter: 'Q3-2026' })} ${R('shopify.get_sales_by_product.best_revenue', { quarter: 'Q2-2026' })}${R('shopify.get_sales_by_product.best_revenue', { quarter: 'Q3-2026' })}). Summer has a hero product; it needs a subscription version.`);
    if (has('sms')) working.push(`${count(V('sms.get_subscriber_count.subscribers'))} SMS subscribers ${R('sms.get_subscriber_count.subscribers')} is a large owned channel that barely gets used.`);

    const couldnt: string[] = [
      ...offSources.map((s) => `**${SOURCE_LABEL(s)}** was switched off, so ${locked.filter((o) => o.requires.includes(s)).length ? `${locked.filter((o) => o.requires.includes(s)).length} opportunit${locked.filter((o) => o.requires.includes(s)).length === 1 ? 'y is' : 'ies are'} locked` : 'its numbers are missing'}. Connect it to unlock.`),
      'Product costs and margins: no connected source reports them, so every dollar figure is revenue, not profit.',
      `Reviews (Okendo) and support tickets (Gorgias) are installed but not connected ${R('shopify.get_installed_apps.okendo_connected')}, so taste and delivery complaints are unread.`,
      ...(picked.includes('Trade Coffee') && skioOn ? [`Whether Trade Coffee's cancel flow offers a frequency change first: one forum comment says so ${C('comp_trade_cancel')}, nothing confirms it.`] : []),
      ...customCompetitors.map((c) => `${c}: no public detail on how they acquire or keep subscribers.`),
    ];

    const start: string[] = [];
    if (syncStep && ranked[0]?.id === 'o1') start.push(`Turn on the Skio → Klaviyo subscriber sync (it's off ${syncOff}); every subscribe offer depends on it. Then build email 2 of the post-purchase flow for day 10.`);
    else if (initiatives[0]) start.push(`${initiatives[0].steps[0]}`);
    start.push(`Reorder Ethiopia Guji now: ${F('shopify.get_inventory_levels.guji_days_cover')} of cover ${R('shopify.get_inventory_levels.guji_days_cover')}.`);
    if (isQ4) start.push(`Q4 is ${F('shopify.get_store_profile.q4_revenue_share')} of your year ${R('shopify.get_store_profile.q4_revenue_share')} and the peak for coffee subscription starts ${C('t_q4')}: ship #1 before Black Friday (Nov 27) so holiday first-time buyers get the offer.`);
    const constraintsLine = brief.constraints.length || brief.freeText.constraints
      ? `\n\n*Planned within your constraints: ${[...brief.constraints.map((c) => CONSTRAINT_LABELS[c] ?? c), ...(brief.freeText.constraints ? [brief.freeText.constraints] : [])].join('; ')}.*`
      : '';

    return `## Where you stand

${where.join(' ')}

## Your top 3 moves

${moves.join('\n')}

Together the top ${top5.length} are worth about **${usd(total5)} a year**, roughly ${pct(total5 / revenue, 0)} of current revenue. Estimates are revenue, not profit, and the Ranked plan tab shows every input.${goalNote}${constraintsLine}

## What our shoppers saw

${journeys.map((j) => `- **${j.persona}:** ${j.headline}`).join('\n')}

## What's working

${working.map((w) => `- ${w}`).join('\n')}

## What we couldn't see

${couldnt.map((w) => `- ${w}`).join('\n')}

## Start here this week

${start.map((w) => `- ${w}`).join('\n')}
`;
  };
  const draftMd = writeSummary(true);
  const finalMd = writeSummary(false);

  const testsById = new Map(tests.map((t) => [t.opportunityId, t]));
  const packages = buildPackages(ctx, ranked, testsById);
  const bkEnd = plEnd + 6_000;
  const pkgText = packages.map((pk) => [...pk.plainCase, ...pk.tracking.baseline.map((b) => (b.ref ? `[${b.ref}]` : '')), ...pk.walkthrough.map((w) => w.why)].join(' '));
  const journeyText = journeys.flatMap((j) => j.steps.map((st) => st.why));
  const analyticsText = [...pack.charts.map((c) => c.insight), ...scorecard.map((a) => `${a.line} ${a.working}`), ...strategy.why, ...strategy.stack.map((t) => t.today)];
  // Claims: every [c] and [d] cited anywhere in the plan.
  const planText = [...pkgText, ...journeyText, ...analyticsText, draftMd, ...initiatives.map((i) => [i.why, ...i.steps].join(' ')), ...priorities.map((o) => [o.rationale, o.audience.ref, o.currentRate.ref, o.targetRate.ref, o.valuePerConversion.ref].join(' ')), ...tests.map((t) => t.eligibleNote), ...feasibility.map((f) => f.availableLabel)].join(' ');
  const citedC = [...new Set([...planText.matchAll(/\[(c\d+)\]/g)].map((m) => m[1]))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const citedD = [...new Set([...planText.matchAll(/\[(d\d+)\]/g)].map((m) => m[1]))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const keyOfC = new Map([...cIds.entries()].map(([k, v]) => [v, k]));
  const claims: Claim[] = citedC.map((id) => ({ id, text: webByKey.get(keyOfC.get(id)!)!.claim }));
  const dataClaims: Claim[] = citedD.map((id) => {
    const e = ledger.get(id)!;
    return { id, text: `${e.label}: ${formatValue(e.value, e.unit)}` };
  });

  at(plStart, { type: 'agent.started', agentId: 'planner' });
  at(plStart + 3_000, { type: 'agent.thinking', agentId: 'planner', text: `Top ${top5.length} get full action plans, specific enough to hand to someone. Capacity is "${CAPACITY_LABELS[capacity]}", so the roadmap runs ${perBlock} build${perBlock > 1 ? 's' : ''} per month. Sample sizes come from code; if a test can't read out in a sensible time, say so.` });
  if (feasibility.length) at(plStart + 21_000, { type: 'agent.text', agentId: 'planner', text: `Flagging ${feasibility.length} test${feasibility.length > 1 ? 's' : ''} that can't be run as asked: ${feasibility.map((f) => f.name.toLowerCase()).join('; ')}. Swapping in measurable alternatives.` });
  at(plStart + 40_000, { type: 'agent.text', agentId: 'planner', text: 'Writing the summary for the founder: where you stand, top three moves, what works, what we could not see, and one thing to do this week.' });
  at(plEnd, { type: 'agent.completed', agentId: 'planner', durationMs: plEnd - plStart, usage: usage(1.58, 3, 96_000, 14_200) });
  at(plEnd + 50, { type: 'plan.draft', initiatives, roadmap });
  at(plEnd + 80, { type: 'tests.draft', tests, feasibility });
  at(plEnd + 110, { type: 'report.draft', markdown: draftMd, claims, dataClaims });
  at(plStart + 1_500, { type: 'agent.started', agentId: 'build-kits' });
  at(plStart + 4_500, { type: 'agent.thinking', agentId: 'build-kits', text: 'For every ranked move: the Skio setup, paired comms with finished copy and Quick Action links, an A/B test, and a baseline to compare against. Plain words: the reader may not be technical.' });
  packages.slice(0, 4).forEach((pk, i) => at(plStart + 14_000 + i * 11_000, { type: 'agent.text', agentId: 'build-kits', text: `Kit ${i + 1}: ${pk.title}. ${pk.assets.length} pieces: ${[...new Set(pk.assets.map((a) => a.platform))].join(', ')}.` }));
  at(bkEnd, { type: 'agent.completed', agentId: 'build-kits', durationMs: bkEnd - plStart - 1_500, usage: usage(1.2, 4, 110_000, 22_600) });
  at(bkEnd + 50, { type: 'build.packages', packages });

  // ---------------- fact-check ----------------
  const fcStart = bkEnd + 1_000;
  const fcEnd = fcStart + 34_000;
  const verdicts: ClaimVerdict[] = [
    ...citedC.map((id) => {
      const f = webByKey.get(keyOfC.get(id)!)!;
      return { id, verdict: f.verdict, evidence: f.verdictNote, source_url: f.source.url };
    }),
    ...citedD.map((id) => {
      const e = ledger.get(id)!;
      if (id === flowShareId && has('klaviyo')) {
        const emailShare = RID('klaviyo.get_list_health.email_revenue_share');
        return { id, verdict: 'mismatch' as const, evidence: `The draft said flows drive 22% of email revenue. Ledger ${id} (${e.label}, ${e.window}) is ${formatValue(e.value, e.unit)}; 22% is email's share of total revenue${emailShare ? ` [${emailShare}]` : ''}. Corrected in the final summary.`, source_url: null, corrected: true };
      }
      return { id, verdict: 'recomputed' as const, evidence: `Recomputed from ledger ${id}: ${e.tool}(${Object.entries(e.args).map(([k, v]) => `${k}=${v}`).join(', ')}) → ${e.field} = ${formatValue(e.value, e.unit)}${e.window ? ` (${e.window})` : ''}. Matches.`, source_url: null };
    }),
  ];
  const counts = {
    web: { supported: verdicts.filter((v) => v.verdict === 'supported').length, unsupported: verdicts.filter((v) => v.verdict === 'unsupported').length, contradicted: 0 },
    data: { recomputed: verdicts.filter((v) => v.verdict === 'recomputed').length, mismatch: verdicts.filter((v) => v.verdict === 'mismatch').length },
  };
  at(fcStart, { type: 'agent.started', agentId: 'factcheck' });
  at(fcStart + 2_500, { type: 'agent.thinking', agentId: 'factcheck', text: `${citedC.length} web claims to trace to the research corpus and ${citedD.length} store numbers to recompute from the ledger. For data claims the check is exact: the number in the text must equal the ledger value.` });
  if (counts.data.mismatch) at(fcStart + 17_000, { type: 'agent.text', agentId: 'factcheck', text: `[${flowShareId}] doesn't match: the draft says 22% but the ledger says ${F('klaviyo.get_list_health.flow_share_of_email')}. The planner mixed up flow share of email revenue with email share of total revenue.` });
  if (counts.web.unsupported) at(fcStart + 24_000, { type: 'agent.text', agentId: 'factcheck', text: "The Trade Coffee cancel-flow claim rests on one hedged forum comment. Unsupported; it stays in \"What we couldn't see\" only." });
  at(fcEnd, { type: 'agent.completed', agentId: 'factcheck', durationMs: fcEnd - fcStart, usage: usage(0.47, 2, 58_000, 4_300) });
  at(fcEnd + 50, { type: 'factcheck.verdicts', verdicts });

  const endT = fcEnd + 400;
  at(endT, { type: 'agent.started', agentId: 'report' });
  at(endT, { type: 'agent.completed', agentId: 'report', durationMs: 0, usage: usage(0, 0, 0, 0) });
  at(endT + 20, { type: 'report.final', markdown: finalMd, supported: counts.web.supported + counts.data.recomputed, unsupported: counts.web.unsupported, contradicted: counts.data.mismatch, counts });

  // Cost is the sum of agent usage, as the live pipeline tallies it.
  const cost = events.reduce((s, e) => s + (e.body.type === 'agent.completed' ? e.body.usage.costUsd : 0), 0);
  at(endT + 60, { type: 'run.completed', durationMs: endT + 60, costUsd: Math.round(cost * 100) / 100 });

  events.sort((a, b) => a.t - b.t || a.order - b.order);
  // A citation to a switched-off source renders as "", which can leave "flow ." behind; tidy those.
  const tidy = (v: unknown): unknown =>
    typeof v === 'string' ? v.replace(/ +([.,;:)])/g, '$1').replace(/ {2,}/g, ' ') : Array.isArray(v) ? v.map(tidy) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x2]) => [k, tidy(x2)])) : v;
  return events.map((e, i) => ({ ...(tidy(e.body) as RunEventBody), seq: i, t: e.t }) as RunEvent);
}

export { TOOL_PHRASES, TIMEFRAME_LABELS };
