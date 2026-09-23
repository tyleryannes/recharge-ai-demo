/**
 * The Intake agent, scripted for the demo: reads the merchant's question plus a quick
 * look at the store and writes 3–5 follow-up questions whose suggested answers come
 * from the store's own (demo) data. Spec §1.2 and §5.2.
 */

import { fixture, metric } from '../connectors/demo-tools.js';
import { pct } from './scoring.js';
import { SOURCE_IDS, type IntakeOption, type IntakeQuestion, type RunBrief, type SourceId } from './types.js';

export const EXAMPLE_QUESTIONS = [
  'How do I get more of my customers onto subscription?',
  'My retention after the first order is dropping. Why, and what should I do?',
  'Where should I spend my next $20k in marketing?',
];

export const GOAL_LABELS: Record<string, string> = {
  convert_one_time_to_sub: 'Convert more one-time buyers to subscribe',
  reduce_churn: 'Reduce subscriber churn',
  acquire_direct: 'Acquire new subscribers directly',
  raise_rev_per_sub: 'Raise revenue per subscriber',
};

export const TIMEFRAME_LABELS: Record<string, string> = {
  next_30_days: 'Next 30 days',
  this_quarter: 'This quarter (Q4)',
  next_6_months: 'Next 6 months',
};

export const CAPACITY_LABELS: Record<string, string> = {
  solo: 'Just me, a few hours a week',
  small_team: 'Small team, 1–2 projects a month',
  agency: 'We have an agency',
};

export const CONSTRAINT_LABELS: Record<string, string> = {
  max_discount_15: 'No deeper discounts than 15%',
  no_new_tools: 'No new tools',
  dont_touch_paid: "Don't touch paid budget",
};

export const COMPETITORS = ['Trade Coffee', 'Atlas Coffee Club', 'Blue Bottle', 'Onyx Coffee Lab'];

function suggestedGoal(question: string): string {
  const q = question.toLowerCase();
  if (/(churn|retention|cancel|keep|dropping|leav)/.test(q)) return 'reduce_churn';
  if (/(\$|spend|budget|ads|acquir|marketing)/.test(q)) return 'acquire_direct';
  if (/(revenue per|aov|upsell|order value)/.test(q)) return 'raise_rev_per_sub';
  return 'convert_one_time_to_sub';
}

export function buildIntake(question: string): { store: typeof fixture.store; questions: IntakeQuestion[] } {
  const goal = suggestedGoal(question);
  const firstToSub = metric('shopify', 'get_cohorts', 'first_to_sub_60d').value;
  const churn = metric('skio', 'get_churn', 'monthly_churn').value;
  const cac = metric('meta', 'get_account_performance', 'cac').value;
  const metaSub = metric('meta', 'get_account_performance', 'new_customer_sub_rate').value;
  const subAov = metric('skio', 'get_subscription_summary', 'sub_order_value').value;
  const q4 = metric('shopify', 'get_store_profile', 'q4_revenue_share').value;
  const tooMuch = metric('skio', 'get_cancel_reasons', 'reason_too_much').value;

  const questions: IntakeQuestion[] = [
    {
      id: 'goal',
      text: "What's the main goal?",
      select: 'single',
      allowOther: true,
      options: ([
        { id: 'convert_one_time_to_sub', label: GOAL_LABELS.convert_one_time_to_sub, why: `Only ${pct(firstToSub)} of first-time buyers subscribe within 60 days`, whySource: 'shopify' },
        { id: 'reduce_churn', label: GOAL_LABELS.reduce_churn, why: `Monthly churn is ${pct(churn)}; ${pct(tooMuch, 0)} of cancels say "too much coffee"`, whySource: 'skio' },
        { id: 'acquire_direct', label: GOAL_LABELS.acquire_direct, why: `Meta CAC is $${cac}, but only ${pct(metaSub, 0)} of those buyers subscribe`, whySource: 'meta' },
        { id: 'raise_rev_per_sub', label: GOAL_LABELS.raise_rev_per_sub, why: `Average subscription order is $${subAov}`, whySource: 'skio' },
      ] as IntakeOption[]).map((o) => ({ ...o, suggested: o.id === goal })),
    },
    {
      id: 'timeframe',
      text: 'What timeframe are you planning for?',
      select: 'single',
      allowOther: false,
      options: [
        { id: 'next_30_days', label: TIMEFRAME_LABELS.next_30_days },
        { id: 'this_quarter', label: TIMEFRAME_LABELS.this_quarter, why: `Q4 is your biggest quarter: ${pct(q4, 0)} of annual revenue`, whySource: 'shopify', suggested: true },
        { id: 'next_6_months', label: TIMEFRAME_LABELS.next_6_months },
      ],
    },
    {
      id: 'competitors',
      text: 'Who do you compete with?',
      select: 'multi',
      allowOther: true,
      options: COMPETITORS.map((name, i) => ({
        id: name,
        label: name,
        why: i === 0 ? 'Seen in your category and catalogue keywords. Research confirms these later.' : undefined,
        whySource: i === 0 ? ('shopify' as SourceId) : undefined,
        suggested: name !== 'Blue Bottle',
      })),
    },
    {
      id: 'capacity',
      text: 'What can your team realistically take on?',
      select: 'single',
      allowOther: false,
      options: [
        { id: 'solo', label: CAPACITY_LABELS.solo },
        { id: 'small_team', label: CAPACITY_LABELS.small_team, suggested: true },
        { id: 'agency', label: CAPACITY_LABELS.agency },
      ],
    },
    {
      id: 'constraints',
      text: 'Anything off-limits?',
      select: 'multi',
      allowOther: true,
      options: [
        { id: 'max_discount_15', label: CONSTRAINT_LABELS.max_discount_15, why: 'Your deepest live discount is 15% (first-order code)', whySource: 'shopify', suggested: true },
        { id: 'no_new_tools', label: CONSTRAINT_LABELS.no_new_tools, why: '5 apps installed; everything in the plan can use them', whySource: 'shopify' },
        { id: 'dont_touch_paid', label: CONSTRAINT_LABELS.dont_touch_paid },
      ],
    },
  ];
  return { store: fixture.store, questions };
}

/** The brief a merchant gets by pressing "Skip, just run it": every suggestion accepted. */
export function defaultRunBrief(question: string): RunBrief {
  const { questions } = buildIntake(question);
  const picked = (id: string) => questions.find((q) => q.id === id)!.options.filter((o) => o.suggested).map((o) => o.id);
  return {
    question,
    goal: picked('goal')[0] ?? null,
    timeframe: picked('timeframe')[0] ?? null,
    competitors: picked('competitors'),
    capacity: picked('capacity')[0] ?? null,
    constraints: picked('constraints'),
    freeText: {},
    sources: Object.fromEntries(SOURCE_IDS.map((s) => [s, true])) as Record<SourceId, boolean>,
    store: fixture.store.id,
  };
}

/** Fills anything the page left out, and never lets Shopify (required) be switched off. */
export function normaliseRunBrief(input: Partial<RunBrief> & { question: string }): RunBrief {
  const base = defaultRunBrief(input.question);
  const sources = { ...base.sources, ...(input.sources ?? {}), shopify: true };
  return {
    ...base,
    ...input,
    competitors: input.competitors ?? base.competitors,
    constraints: input.constraints ?? base.constraints,
    freeText: input.freeText ?? {},
    sources,
    store: base.store,
  };
}
