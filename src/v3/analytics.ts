/**
 * The growth analyst's output: the numbers an agency would put in front of a founder
 * (funnel by device, first-year value curves, channel economics, unit economics and
 * payback, support and review themes), a health scorecard by area, and the case for
 * subscriptions across every tool in the stack. All maths here, in code.
 */

import { readTool } from '../connectors/demo-tools.js';
import { count, pct, usd } from '../v2/scoring.js';
import type { Ctx } from './ctx.js';
import type { AnalyticsPack, AreaScore, Chart, SubscriptionStrategy } from './types.js';

export interface Economics {
  contributionPerOrder: number;
  contributionRate: number;
  subOrderContribution: number;
  paybackSubMonths: number;
  oneTimeYearContribution: number;
  mrrLostPerMonth: number;
  churnPointValue: number;
  mobileShare: number;
}

export function economics(x: Ctx): Economics {
  const { V } = x;
  const aov = V('shopify.get_store_profile.aov');
  const gm = V('shopify.get_margins.gross_margin');
  const perOrderCosts = V('shopify.get_margins.shipping_cost') + V('shopify.get_margins.fulfilment_cost') + V('shopify.get_margins.payment_fees');
  const contributionPerOrder = aov * gm - perOrderCosts;
  const subAov = V('skio.get_subscription_summary.sub_order_value');
  const subOrderContribution = subAov * gm - perOrderCosts;
  const ordersPerSubMonth = V('skio.get_subscription_summary.orders_per_month') / V('skio.get_subscription_summary.active_subscribers');
  const cac = V('meta.get_account_performance.cac');
  const mrr = V('skio.get_subscription_summary.mrr');
  return {
    contributionPerOrder,
    contributionRate: contributionPerOrder / aov,
    subOrderContribution,
    paybackSubMonths: cac / (subOrderContribution * ordersPerSubMonth),
    oneTimeYearContribution: (x.oneLtv / aov) * contributionPerOrder,
    mrrLostPerMonth: mrr * V('skio.get_churn.monthly_churn'),
    churnPointValue: mrr * 0.01 * 12,
    mobileShare: V('shopify.get_funnel.sessions', { device: 'mobile' }) / V('shopify.get_funnel.sessions', { device: 'all' }),
  };
}

export function buildAnalytics(x: Ctx): AnalyticsPack {
  const { R, F, V, C, has } = x;
  const e = economics(x);
  const charts: Chart[] = [];
  const refs = (...s: string[]) => [...new Set(s.join('').match(/d\d+/g) ?? [])];
  const stages = [
    ['Viewed a product', 'pdp_rate'],
    ['Added to cart', 'atc_rate'],
    ['Reached checkout', 'checkout_rate'],
    ['Ordered', 'conversion'],
  ] as const;
  const funnelRefs = ['mobile', 'desktop'].flatMap((device) => stages.map(([, f]) => R(`shopify.get_funnel.${f}`, { device })));
  charts.push({
    id: 'funnel', title: 'Where visits drop off, phone vs laptop', kind: 'funnel', unit: 'ratio',
    series: (['mobile', 'desktop'] as const).map((device) => ({ name: device === 'mobile' ? 'Phone' : 'Laptop', points: stages.map(([x2, f]) => ({ x: x2, y: V(`shopify.get_funnel.${f}`, { device }) })) })),
    insight: `${pct(e.mobileShare, 0)} of visits happen on a phone ${R('shopify.get_funnel.sessions', { device: 'mobile' })}${R('shopify.get_funnel.sessions', { device: 'all' })}, but phones order at ${F('shopify.get_funnel.conversion', { device: 'mobile' })} ${R('shopify.get_funnel.conversion', { device: 'mobile' })} against ${F('shopify.get_funnel.conversion', { device: 'desktop' })} on a laptop ${R('shopify.get_funnel.conversion', { device: 'desktop' })}. The gap opens at "added to cart", which is the product page's job. Typical food and drink stores convert 2–3% on phones ${C('b_mobile_conv')}.`,
    opportunityId: 'o8', refs: refs(...funnelRefs),
  });
  if (has('skio')) {
    // The curves are lists, not metrics, so they come straight off the fixture; the month-3 points are ledgered.
    const sub = readTool('shopify', 'get_cohort_ltv').sub_curve as number[];
    const one = readTool('shopify', 'get_cohort_ltv').one_time_curve as number[];
    charts.push({
      id: 'ltv', title: 'What a customer is worth over their first year', kind: 'lines', unit: 'usd',
      series: [
        { name: 'Subscriber', points: sub.map((y, i) => ({ x: `M${i + 1}`, y })) },
        { name: 'One-time buyer', points: one.map((y, i) => ({ x: `M${i + 1}`, y })) },
      ],
      insight: `A one-time buyer spends more on day one ($${one[0]} vs $${sub[0]}), but a subscriber passes them by month 3 and is worth $${x.subLtv} by month 12 against $${x.oneLtv} ${R('skio.get_ltv_comparison.sub_ltv')}${R('skio.get_ltv_comparison.one_time_ltv')}. Every first order that becomes a subscription is worth about $${x.subLtv - x.oneLtv} more in year one.`,
      opportunityId: 'o8', refs: refs(R('skio.get_ltv_comparison.sub_ltv'), R('skio.get_ltv_comparison.one_time_ltv'), R('shopify.get_cohort_ltv.sub_m3'), R('shopify.get_cohort_ltv.one_time_m3')),
    });
  }
  charts.push({
    id: 'adoption', title: 'First orders placed as a subscription', kind: 'bars', unit: 'ratio',
    series: [{ name: 'First orders as subscription', points: [
      { x: 'Phone', y: V('shopify.get_pdp_performance.first_order_sub_share_mobile') },
      { x: 'Laptop', y: V('shopify.get_pdp_performance.first_order_sub_share_desktop') },
      { x: 'All devices', y: V('shopify.get_pdp_performance.first_order_sub_share') },
    ] }],
    benchmark: { label: 'Stores that default to subscription: 15–25%', value: 0.15, ref: C('b_pdp_default') },
    insight: `On a laptop, where the subscribe option is visible, ${F('shopify.get_pdp_performance.first_order_sub_share_desktop')} of first orders are subscriptions ${R('shopify.get_pdp_performance.first_order_sub_share_desktop')}. On a phone, where it's hidden below the fold, it's ${F('shopify.get_pdp_performance.first_order_sub_share_mobile')} ${R('shopify.get_pdp_performance.first_order_sub_share_mobile')}. Stores that make subscription the default get 15–25% ${C('b_pdp_default')}.`,
    opportunityId: 'o8', refs: refs(R('shopify.get_pdp_performance.first_order_sub_share_desktop'), R('shopify.get_pdp_performance.first_order_sub_share_mobile'), R('shopify.get_pdp_performance.first_order_sub_share')),
  });
  const ch = readTool('shopify', 'get_channel_performance').channels as { channel: string; new: number; cac: number | null; ltv12: number; sub: number }[];
  const paid = ch.filter((c) => c.cac);
  if (has('meta')) charts.push({
    id: 'channels', title: 'Channel economics: first-year revenue for every $1 of acquisition cost', kind: 'bars', unit: 'x',
    series: [{ name: 'First-year revenue ÷ CAC', points: paid.map((c) => ({ x: c.channel, y: Math.round((c.ltv12 / (c.cac as number)) * 10) / 10 })) }],
    benchmark: { label: 'Healthy: 3× or more', value: 3 },
    insight: `Meta brings the most new customers but each returns $${(V('shopify.get_channel_performance.meta_ltv12') / V('meta.get_account_performance.cac')).toFixed(1)} of first-year revenue per $1 spent ${R('shopify.get_channel_performance.meta_ltv12')}${R('meta.get_account_performance.cac')}, under the 3× most growth teams look for. Organic customers are worth $${V('shopify.get_channel_performance.organic_ltv12')} ${R('shopify.get_channel_performance.organic_ltv12')}, a third more than Meta's. The fix is who Meta finds (subscribers), not how much you spend.`,
    opportunityId: 'o5', refs: refs(R('shopify.get_channel_performance.meta_ltv12'), R('meta.get_account_performance.cac'), R('shopify.get_channel_performance.organic_ltv12')),
    table: { columns: ['Channel', 'New customers / mo', 'CAC', 'First-year revenue', 'Subscribe within 60 days'], rows: ch.map((c) => [c.channel, count(c.new), c.cac ? `$${c.cac}` : '—', `$${c.ltv12}`, pct(c.sub, 0)]) },
  });
  charts.push({
    id: 'unit', title: 'Where the money in a $46 order goes', kind: 'waterfall', unit: 'usd',
    series: [{ name: 'Per order', points: [
      { x: 'Average order', y: V('shopify.get_store_profile.aov') },
      { x: 'Coffee and bags', y: -(V('shopify.get_store_profile.aov') * (1 - V('shopify.get_margins.gross_margin'))) },
      { x: 'Shipping', y: -V('shopify.get_margins.shipping_cost') },
      { x: 'Pick and pack', y: -V('shopify.get_margins.fulfilment_cost') },
      { x: 'Payment fees', y: -V('shopify.get_margins.payment_fees') },
      { x: 'Left over', y: e.contributionPerOrder },
    ] }],
    insight: `After product, shipping, packing and fees, about $${e.contributionPerOrder.toFixed(2)} of a $${V('shopify.get_store_profile.aov')} order is left ${R('shopify.get_store_profile.aov')}${R('shopify.get_margins.gross_margin')}${R('shopify.get_margins.shipping_cost')}${R('shopify.get_margins.fulfilment_cost')}${R('shopify.get_margins.payment_fees')}. ${F('shopify.get_margins.discount_share')} of orders also use a code ${R('shopify.get_margins.discount_share')}. That's why the plan uses subscribe-and-save instead of deeper one-time codes: the discount buys a second order.`,
    refs: refs(R('shopify.get_store_profile.aov'), R('shopify.get_margins.gross_margin'), R('shopify.get_margins.shipping_cost'), R('shopify.get_margins.discount_share')),
  });
  if (has('meta') && has('skio')) {
    charts.push({
      id: 'payback', title: 'How long a Meta customer takes to pay back', kind: 'table', unit: 'months',
      series: [],
      insight: `At $${V('meta.get_account_performance.cac')} to acquire ${R('meta.get_account_performance.cac')}, a subscriber pays that back in about ${e.paybackSubMonths.toFixed(1)} months. A one-time buyer earns about $${Math.round(e.oneTimeYearContribution)} in a whole year after costs, so they never pay back inside 12 months. Growth that lands one-time buyers loses money; growth that lands subscribers makes it.`,
      opportunityId: 'o5', refs: refs(R('meta.get_account_performance.cac')),
      table: { columns: ['', 'Subscriber', 'One-time buyer'], rows: [
        ['Cost to acquire (Meta)', `$${V('meta.get_account_performance.cac')}`, `$${V('meta.get_account_performance.cac')}`],
        ['Left over per order', `$${e.subOrderContribution.toFixed(2)}`, `$${e.contributionPerOrder.toFixed(2)}`],
        ['First-year leftover', `$${Math.round(e.subOrderContribution * 0.93 * 12)}`, `$${Math.round(e.oneTimeYearContribution)}`],
        ['Pays back', `month ${Math.ceil(e.paybackSubMonths)}`, 'not within 12 months'],
      ] },
    });
  }
  if (has('skio')) {
    charts.push({
      id: 'cancel', title: 'Why subscribers cancel', kind: 'bars', unit: 'ratio',
      series: [{ name: 'Share of cancels', points: [
        { x: 'Too much coffee', y: V('skio.get_cancel_reasons.reason_too_much') },
        { x: 'Moving or other', y: V('skio.get_cancel_reasons.reason_other') },
        { x: 'Price', y: V('skio.get_cancel_reasons.reason_price') },
        { x: 'Taste or variety', y: V('skio.get_cancel_reasons.reason_taste') },
      ] }],
      insight: `A third of cancels are "too much coffee" ${R('skio.get_cancel_reasons.reason_too_much')}: people who like the product but get too much of it. They don't need a discount, they need fewer bags. Losing ${F('skio.get_churn.monthly_churn')} of subscribers a month ${R('skio.get_churn.monthly_churn')} costs about ${usd(e.mrrLostPerMonth)} of monthly subscription revenue every month; each point of churn you cut is worth about ${usd(e.churnPointValue)} a year.`,
      opportunityId: 'o2', refs: refs(R('skio.get_cancel_reasons.reason_too_much'), R('skio.get_churn.monthly_churn')),
    });
  }
  if (has('gorgias')) {
    const subShare = V('gorgias.get_ticket_reasons.change_skip') + V('gorgias.get_ticket_reasons.cancel_request');
    charts.push({
      id: 'tickets', title: 'What customers write to support about', kind: 'bars', unit: 'ratio',
      series: [{ name: 'Share of tickets', points: [
        { x: 'Where is my order', y: V('gorgias.get_ticket_reasons.wismo') },
        { x: 'Change or skip a subscription', y: V('gorgias.get_ticket_reasons.change_skip') },
        { x: 'Damaged, returns, other', y: V('gorgias.get_ticket_reasons.other') },
        { x: 'Product questions', y: V('gorgias.get_ticket_reasons.product_q') },
        { x: 'Cancel my subscription', y: V('gorgias.get_ticket_reasons.cancel_request') },
        { x: 'Billing', y: V('gorgias.get_ticket_reasons.billing') },
      ] }],
      insight: `${pct(subShare, 0)} of ${count(V('gorgias.get_ticket_summary.tickets'))} tickets a month are about changing, skipping or cancelling a subscription ${R('gorgias.get_ticket_reasons.change_skip')}${R('gorgias.get_ticket_reasons.cancel_request')}${R('gorgias.get_ticket_summary.tickets')}. Customers email because the portal makes those changes hard. Each ticket costs about $${V('gorgias.get_ticket_summary.cost_per_ticket')} to handle ${R('gorgias.get_ticket_summary.cost_per_ticket')}.`,
      opportunityId: 'o9', refs: refs(R('gorgias.get_ticket_reasons.change_skip'), R('gorgias.get_ticket_reasons.cancel_request')),
    });
  }
  if (has('klaviyo')) {
    const flowShare = V('klaviyo.get_list_health.flow_share_of_email');
    charts.push({
      id: 'email', title: 'Email revenue: automated flows vs one-off campaigns', kind: 'split', unit: 'ratio',
      series: [{ name: 'Share of email revenue', points: [{ x: 'Flows', y: flowShare }, { x: 'Campaigns', y: 1 - flowShare }] }],
      benchmark: { label: 'Mature brands: flows 30–45%', value: 0.3, ref: C('b_flowshare') },
      insight: `Only ${pct(flowShare, 0)} of email revenue comes from automated flows ${R('klaviyo.get_list_health.flow_share_of_email')}; the rest depends on someone sending a campaign. At mature brands flows bring in 30–45% ${C('b_flowshare')}, because they fire at the right moment for each customer: after an order, before a charge, when someone lapses.`,
      opportunityId: 'o1', refs: refs(R('klaviyo.get_list_health.flow_share_of_email')),
    });
  }
  if (has('okendo')) {
    charts.push({
      id: 'reviews', title: 'What reviews talk about', kind: 'bars', unit: 'ratio',
      series: [{ name: 'Share of reviews', points: [
        { x: 'Freshness', y: V('okendo.get_review_themes.fresh') },
        { x: 'Price', y: V('okendo.get_review_themes.price') },
        { x: 'Too much coffee (subscribers)', y: V('okendo.get_review_themes.too_much') },
      ] }],
      insight: `Customers rate the coffee ${F('okendo.get_review_summary.rating')}★ ${R('okendo.get_review_summary.rating')} and the word they use most is "fresh" ${R('okendo.get_review_themes.fresh')}. That's your subscription story: roasted to order, delivered before you run out.`,
      refs: refs(R('okendo.get_review_themes.fresh')),
    });
  }
  const kpis: AnalyticsPack['kpis'] = [
    { label: 'Revenue, 12 months', value: F('shopify.get_store_profile.revenue'), ref: x.RID('shopify.get_store_profile.revenue') },
    { label: 'Left over per order', value: `$${e.contributionPerOrder.toFixed(2)}`, note: `${pct(e.contributionRate, 0)} of the order`, tone: 'neutral' },
    ...(has('skio') ? [
      { label: 'Subscription revenue', value: F('skio.get_subscription_summary.mrr'), ref: x.RID('skio.get_subscription_summary.mrr') },
      { label: 'Subscribers are', value: F('shopify.get_customer_mix.sub_customer_share'), note: `of customers, but ${F('skio.get_subscription_summary.sub_revenue_share')} of revenue`, ref: x.RID('shopify.get_customer_mix.sub_customer_share'), tone: 'good' as const },
    ] : []),
    { label: 'Phone conversion', value: F('shopify.get_funnel.conversion', { device: 'mobile' }), note: `laptop ${F('shopify.get_funnel.conversion', { device: 'desktop' })}`, ref: x.RID('shopify.get_funnel.conversion', { device: 'mobile' }), tone: 'bad' },
    ...(has('meta') ? [{ label: 'Meta: revenue per $1', value: `${(V('shopify.get_channel_performance.meta_ltv12') / V('meta.get_account_performance.cac')).toFixed(1)}×`, note: 'first year; healthy is 3×', ref: x.RID('shopify.get_channel_performance.meta_ltv12'), tone: 'bad' as const }] : []),
  ];
  return {
    headline: `The store makes about $${e.contributionPerOrder.toFixed(2)} on an average order after costs, so growth only pays when customers come back. Subscribers do; most customers today don't.`,
    kpis,
    charts,
  };
}

export function buildScorecard(x: Ctx): AreaScore[] {
  const { R, F, V, has } = x;
  const grade = (score: number): AreaScore['grade'] => (score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F');
  const a = (area: string, score: number, line: string, working: string): AreaScore => ({ area, score, grade: grade(score), line, working });
  const out: AreaScore[] = [
    a('Storefront conversion', 44, `Phones convert at ${F('shopify.get_funnel.conversion', { device: 'mobile' })} ${R('shopify.get_funnel.conversion', { device: 'mobile' })} and the main image takes ${F('shopify.get_page_speed.lcp_mobile')} to load ${R('shopify.get_page_speed.lcp_mobile')}.`, 'Checkout is fast, with Shop Pay and Apple Pay up top.'),
    a('Subscription adoption', 38, `${F('shopify.get_pdp_performance.first_order_sub_share')} of first orders are subscriptions ${R('shopify.get_pdp_performance.first_order_sub_share')} and ${F('shopify.get_cohorts.first_to_sub_60d')} of one-time buyers subscribe later ${R('shopify.get_cohorts.first_to_sub_60d')}.`, `Desktop already gets ${F('shopify.get_pdp_performance.first_order_sub_share_desktop')} ${R('shopify.get_pdp_performance.first_order_sub_share_desktop')}: the offer works when people can see it.`),
  ];
  if (has('skio')) out.push(a('Subscriber retention', 52, `Monthly churn is ${F('skio.get_churn.monthly_churn')} ${R('skio.get_churn.monthly_churn')} and the cancel flow saves ${F('skio.get_cancel_reasons.save_rate')} ${R('skio.get_cancel_reasons.save_rate')}.`, `Dunning recovers ${F('skio.get_dunning_performance.recovery_rate')} of failed payments ${R('skio.get_dunning_performance.recovery_rate')}; swap is used and works.`));
  if (has('klaviyo')) out.push(a('Email and SMS', 55, `Flows bring in ${F('klaviyo.get_list_health.flow_share_of_email')} of email revenue ${R('klaviyo.get_list_health.flow_share_of_email')}, and 4 standard flows are missing ${R('klaviyo.list_flows.missing_standard_flows')}.`, `Abandoned cart converts ${F('klaviyo.get_flow_performance.placed_order_rate', { flowId: 'abandoned_cart' })} ${R('klaviyo.get_flow_performance.placed_order_rate', { flowId: 'abandoned_cart' })}, above the usual 3–5%.`));
  if (has('meta')) out.push(a('Paid acquisition', 50, `Meta returns ${(V('shopify.get_channel_performance.meta_ltv12') / V('meta.get_account_performance.cac')).toFixed(1)}× first-year revenue per $1 ${R('shopify.get_channel_performance.meta_ltv12')} and ${F('meta.get_account_performance.new_customer_sub_rate')} of its buyers subscribe ${R('meta.get_account_performance.new_customer_sub_rate')}.`, `Meta delivers ${count(V('meta.get_account_performance.new_customers_per_month'))} new customers a month ${R('meta.get_account_performance.new_customers_per_month')}: the volume is there.`));
  if (has('gorgias')) out.push(a('Support', 58, `${pct(V('gorgias.get_ticket_reasons.change_skip') + V('gorgias.get_ticket_reasons.cancel_request'), 0)} of tickets are subscription changes ${R('gorgias.get_ticket_reasons.change_skip')} and ${F('gorgias.get_macros.cancel_ticket_saves')} of cancel tickets are saved ${R('gorgias.get_macros.cancel_ticket_saves')}.`, `Customers are happy with the help they get: CSAT ${F('gorgias.get_ticket_summary.csat')} ${R('gorgias.get_ticket_summary.csat')}.`));
  if (has('okendo')) out.push(a('Reviews and brand', 90, `${F('okendo.get_review_summary.rating')}★ across ${count(V('okendo.get_review_summary.reviews'))} reviews ${R('okendo.get_review_summary.rating')}.`, `"Fresh" is the most common word in reviews ${R('okendo.get_review_themes.fresh')}.`));
  out.push(a('Inventory', 72, `Ethiopia Guji has ${F('shopify.get_inventory_levels.guji_days_cover')} of cover ${R('shopify.get_inventory_levels.guji_days_cover')}; Decaf has ${F('shopify.get_inventory_levels.decaf_days_cover')} ${R('shopify.get_inventory_levels.decaf_days_cover')}.`, `Most products sit near ${F('shopify.get_inventory_levels.median_days_cover')} of cover ${R('shopify.get_inventory_levels.median_days_cover')}, which is healthy.`));
  out.push(a('Stack wiring', 35, `The Skio → Klaviyo sync is off ${R('shopify.get_installed_apps.skio_klaviyo_sync')}${has('skio') ? ` and Quick Action links have never been used ${R('skio.get_quick_actions.links_used')}` : ''}.`, 'Every tool the plan needs is already installed.'));
  return out;
}

export function buildStrategy(x: Ctx): SubscriptionStrategy {
  const { R, F, V, has } = x;
  const e = economics(x);
  const why = [
    has('skio') ? `Subscribers are ${F('shopify.get_customer_mix.sub_customer_share')} of your customers ${R('shopify.get_customer_mix.sub_customer_share')} but bring in ${F('skio.get_subscription_summary.sub_revenue_share')} of your revenue ${R('skio.get_subscription_summary.sub_revenue_share')}.` : `Subscribers are ${F('shopify.get_customer_mix.sub_customer_share')} of your customers ${R('shopify.get_customer_mix.sub_customer_share')}.`,
    `In their first year a subscriber spends $${x.subLtv}; a one-time buyer spends $${x.oneLtv}${has('skio') ? ` ${R('skio.get_ltv_comparison.sub_ltv')}${R('skio.get_ltv_comparison.one_time_ltv')}` : ''}.`,
    has('meta') && has('skio') ? `At today's Meta costs, a one-time buyer never earns back what it cost to get them. A subscriber does by month ${Math.ceil(e.paybackSubMonths)}.` : 'A one-time buyer rarely earns back what it cost to acquire them; a subscriber does within months.',
    has('skio') ? `Subscription revenue is predictable: ${F('skio.get_subscription_summary.mrr')} a month ${R('skio.get_subscription_summary.mrr')} you can plan roasting and inventory around.` : 'Subscription revenue is predictable, so you can plan roasting and inventory around it.',
    has('skio') ? `Every point of monthly churn you cut keeps about ${usd(e.churnPointValue)} a year.` : 'Every point of churn you cut compounds, month after month.',
  ].filter((s): s is string => !!s);
  const stack: SubscriptionStrategy['stack'] = [
    { tool: 'Shopify storefront', source: 'shopify', role: 'Where the subscription is sold', maturity: 1,
      today: `One-time is preselected; the subscribe option is ${F('storefront.open_page.sub_widget_depth', { path: '/products/house-blend' })} down on phones; no subscription offer in the cart or on the thank-you page.`,
      great: 'Subscribe & save is preselected and priced up front, "skip or cancel anytime" sits under it, the cart offers a one-tap switch, and the thank-you page converts the order.',
      plays: [{ text: 'Make subscribe the default on product pages', opportunityId: 'o8' }, { text: 'Skio Post-purchase upsell on the thank-you page', opportunityId: 'o1' }, { text: 'Skio Checkout Upgrade and Save' }] },
    { tool: 'Skio', source: 'skio', role: 'The subscription engine', maturity: has('skio') ? 2 : 0,
      today: has('skio') ? `Subscriptions, dunning and a basic cancel flow run well. The cancel flow answers every reason with 10% off; Quick Actions are unused ${R('skio.get_quick_actions.links_used')}; no pre-charge reminder ${R('skio.get_notifications.upcoming_order_reminder')}.` : 'Not connected to this run.',
      great: 'Reason-specific cancel treatments tested with Cancel flow A/B tests, Quick Action links in every email and SMS, pre-charge reminders, Smart Retries, Winbacks, and portal shortcuts for the top requests.',
      plays: [{ text: 'Reason-specific cancel flow, A/B tested', opportunityId: 'o2' }, { text: 'Billing reminder with Quick Actions', opportunityId: 'o10' }, { text: 'Smart Retries and card-update Quick Action', opportunityId: 'o7' }] },
    { tool: 'Klaviyo', source: 'klaviyo', role: 'Talks to each customer at the right moment', maturity: has('klaviyo') ? 1 : 0,
      today: has('klaviyo') ? `Campaign-heavy: flows are ${F('klaviyo.get_list_health.flow_share_of_email')} of email revenue ${R('klaviyo.get_list_health.flow_share_of_email')}, the Skio sync is off, and nothing is segmented by subscription status.` : 'Not connected to this run.',
      great: 'Skio events and properties flow in (skio_hasActiveSubscription, "Skio: Billing Reminder Notification", "Skio: Subscription Went Through Cancel Flow"), so every flow knows who subscribes and every email carries a one-click Quick Action.',
      plays: [{ text: 'Day-10 "running low?" email with a one-click subscribe', opportunityId: 'o1' }, { text: 'Winback flow that leads with the subscription', opportunityId: 'o3' }, { text: 'Upcoming-order flow with skip, swap and add-on buttons', opportunityId: 'o10' }] },
    { tool: 'Postscript', source: 'sms', role: 'The fastest channel for "running low" and "skip?"', maturity: has('sms') ? 1 : 0,
      today: has('sms') ? `${count(V('sms.get_subscriber_count.subscribers'))} subscribers ${R('sms.get_subscriber_count.subscribers')}, a welcome flow and ${V('sms.get_sms_campaign_performance.campaigns_per_month')} campaigns a month.` : 'Not connected to this run.',
      great: 'Texts pair with every key email, and subscribers can reply SKIP to skip their next order (Skio reads Postscript replies).',
      plays: [{ text: 'Day-12 "running low?" text', opportunityId: 'o1' }, { text: 'Pre-charge text: reply SKIP to skip', opportunityId: 'o10' }] },
    { tool: 'Gorgias', source: 'gorgias', role: 'The last chance to save a subscriber', maturity: has('gorgias') ? 1 : 0,
      today: has('gorgias') ? `Agents cancel on request; ${F('gorgias.get_macros.cancel_ticket_saves')} of cancel tickets are saved ${R('gorgias.get_macros.cancel_ticket_saves')}.` : 'Not connected to this run.',
      great: "Skio's Gorgias widget shows each subscription in the sidebar; macros offer skip or a slower cadence first and include Quick Action links so customers can do it themselves.",
      plays: [{ text: 'Save-first macros with Skio Quick Actions', opportunityId: 'o9' }] },
    { tool: 'Okendo', source: 'okendo', role: 'Proof that subscribing is worth it', maturity: has('okendo') ? 2 : 0,
      today: has('okendo') ? `Great ratings ${R('okendo.get_review_summary.rating')}, but subscriber reviews aren't highlighted anywhere ${R('okendo.get_review_summary.sub_reviews_on_pdp')}.` : 'Not connected to this run.',
      great: 'Subscriber reviews ("never run out, always fresh") sit next to the subscribe option and inside subscription emails.',
      plays: [{ text: 'Show a subscriber review under the subscribe option', opportunityId: 'o8' }] },
    { tool: 'Meta Ads', source: 'meta', role: 'Finds the next subscribers', maturity: has('meta') ? 1 : 0,
      today: has('meta') ? `Optimises for any purchase; ${F('meta.get_top_creatives.sub_creative_share')} of spend is subscription creative ${R('meta.get_top_creatives.sub_creative_share')}.` : 'Not connected to this run.',
      great: 'A "subscription started" conversion guides delivery, and creative sells "never run out" instead of a first-order code.',
      plays: [{ text: 'Optimise for subscription starts', opportunityId: 'o5' }] },
    { tool: 'TikTok Shop', source: 'tiktokshop', role: 'A new-customer channel that never reaches subscription', maturity: 0,
      today: has('tiktokshop') ? `${F('tiktokshop.get_shop_performance.gmv')} a month ${R('tiktokshop.get_shop_performance.gmv')}, ${F('tiktokshop.get_shop_performance.sub_conversion')} subscribe, not synced to Klaviyo.` : 'Not connected to this run.',
      great: 'Every order ships with a subscribe insert card, and buyers flow into Klaviyo.',
      plays: [{ text: 'Insert card and Klaviyo sync', opportunityId: 'o4' }] },
  ];
  const connected = stack.filter((t) => !t.source || t.source === 'shopify' || has(t.source as never));
  return { why, maturity: Math.round((connected.reduce((s, t) => s + t.maturity, 0) / (connected.length * 4)) * 100), stack };
}
