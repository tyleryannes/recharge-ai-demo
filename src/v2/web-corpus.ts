/**
 * The web side of the demo run: what the three researchers "found". Every source is
 * labelled illustrative and points at example.com, because none of this was actually
 * researched. Claims about named competitors stay at the level of their publicly
 * visible business model; anything more specific goes to "could not verify".
 */

import type { SourceRef } from '../events.js';

export type ResearchAgentId = 'research-benchmarks' | 'research-competitors' | 'research-trends' | 'followup-1';

export interface WebFinding {
  key: string;
  agent: ResearchAgentId;
  claim: string;
  evidence: string;
  confidence: 'high' | 'medium' | 'low';
  source: SourceRef;
  /** The fact-checker's verdict when the planner cites it. */
  verdict: 'supported' | 'unsupported';
  verdictNote: string;
}

const src = (slug: string, title: string): SourceRef => ({
  title: `${title} (illustrative)`,
  url: `https://example.com/demo-sources/${slug}`,
});

export const SOURCES = {
  lifecycle: src('lifecycle-benchmarks-consumables-2026', 'Lifecycle email benchmarks for consumables brands, 2026'),
  replenish: src('replenishment-timing-study', 'Replenishment timing and conversion: a study of send-day'),
  flowShare: src('flow-vs-campaign-revenue', 'Flow vs campaign revenue share at DTC brands'),
  cart: src('abandoned-cart-benchmarks', 'Abandoned cart benchmarks by vertical'),
  cancel: src('cancel-flow-save-offers', 'Cancel-flow save offers in consumable subscriptions'),
  winback: src('winback-cadence', 'Winback cadence and reactivation rates'),
  dunning: src('dunning-recovery', 'Recovering failed subscription payments'),
  browse: src('browse-abandonment', 'Browse abandonment flow performance'),
  metaEvent: src('optimising-for-downstream-events', 'Optimising paid social for downstream conversion events'),
  metaSubRate: src('subscription-led-acquisition', 'Subscription-led acquisition: first-order to subscription rates'),
  ltv: src('subscriber-vs-one-time-ltv', 'Subscriber vs one-time buyer value in consumables'),
  coffeeModels: src('coffee-subscription-models', 'How US coffee subscriptions sell: quiz, club and replenishment models'),
  coffeeGifting: src('coffee-holiday-gifting', 'Coffee gift subscriptions and the holiday season'),
  flexibility: src('subscription-flexibility-features', 'Subscription flexibility features at leading coffee brands'),
  forum: src('forum-thread-cancelling-a-coffee-subscription', 'Forum thread: cancelling a coffee subscription'),
  q4: src('coffee-subscription-seasonality', 'Coffee subscription starts by month'),
  tooMuch: src('why-people-cancel-consumables', 'Why shoppers cancel consumable subscriptions'),
  prices: src('green-coffee-prices-2025', 'Green coffee costs and retail pricing, 2025–26'),
  tiktokShop: src('tiktok-shop-to-owned-channels', 'Moving marketplace buyers to owned channels'),
  sendDay: src('days-before-run-out', 'Days-before-run-out timing for replenishment prompts'),
};

export const WEB_FINDINGS: WebFinding[] = [
  // Benchmarks, briefed with the audit's gaps
  { key: 'b_pp', agent: 'research-benchmarks', claim: 'Consumables brands that add a subscribe offer to the post-purchase flow typically convert 6–9% of first-time buyers to subscription within 60 days.', evidence: 'Range across benchmark sets for consumables DTC; 7% is the conservative midpoint used for targets.', confidence: 'medium', source: SOURCES.lifecycle, verdict: 'supported', verdictNote: 'Benchmarks finding: 6–9% within 60 days; 7% is inside the range.' },
  { key: 'b_timing', agent: 'research-benchmarks', claim: 'Replenishment-timed prompts, sent a few days before a product typically runs out, convert better than fixed-day sends.', evidence: 'Send-day comparisons favour "before run-out" timing for consumables.', confidence: 'medium', source: SOURCES.replenish, verdict: 'supported', verdictNote: 'Benchmarks finding on replenishment timing.' },
  { key: 'b_flowshare', agent: 'research-benchmarks', claim: 'Flows typically drive 30–45% of email revenue at mature DTC brands; under 25% usually means standard flows are missing.', evidence: 'Flow vs campaign revenue splits across DTC brands.', confidence: 'high', source: SOURCES.flowShare, verdict: 'supported', verdictNote: 'Benchmarks finding: 30–45% typical.' },
  { key: 'b_cart', agent: 'research-benchmarks', claim: 'Abandoned cart flows typically place orders for 3–5% of recipients.', evidence: 'Placed-order rate by vertical; food and beverage sits in the same range.', confidence: 'high', source: SOURCES.cart, verdict: 'supported', verdictNote: 'Benchmarks finding: 3–5% placed-order rate.' },
  { key: 'b_cancel', agent: 'research-benchmarks', claim: 'Offering a cadence change or a skip before cancel saves 25–35% of "too much product" cancellations in consumable subscriptions.', evidence: 'Reason-specific save offers outperform a single discount offer for oversupply reasons.', confidence: 'medium', source: SOURCES.cancel, verdict: 'supported', verdictNote: 'Benchmarks finding: 25–35%; the plan uses 30%.' },
  { key: 'b_winback', agent: 'research-benchmarks', claim: 'Winback flows with 60/90/120-day touches reactivate 4–6% of lapsed customers.', evidence: 'Reactivation within 90 days of entering a winback flow.', confidence: 'medium', source: SOURCES.winback, verdict: 'supported', verdictNote: 'Benchmarks finding: 4–6%; the plan uses 5%.' },
  { key: 'b_dunning', agent: 'research-benchmarks', claim: 'Smart retries plus a card-update prompt by email and SMS lift dunning recovery to 55–70%.', evidence: 'Recovery rates with and without retry scheduling and card-update messages.', confidence: 'medium', source: SOURCES.dunning, verdict: 'supported', verdictNote: 'Benchmarks finding: 55–70%.' },
  { key: 'b_browse', agent: 'research-benchmarks', claim: 'Browse abandonment flows convert around 1–2% of identified browsers.', evidence: 'Small sample of published flow reports; wide spread.', confidence: 'low', source: SOURCES.browse, verdict: 'supported', verdictNote: 'Benchmarks finding: 1–2% (low confidence).' },
  { key: 'b_meta_event', agent: 'research-benchmarks', claim: 'Optimising paid social for a downstream event, such as a subscription start, rather than any purchase shifts delivery toward buyers more likely to take that action.', evidence: 'Platform documentation and case write-ups on custom conversion optimisation.', confidence: 'medium', source: SOURCES.metaEvent, verdict: 'supported', verdictNote: 'Benchmarks finding on downstream-event optimisation.' },
  { key: 'b_meta_rate', agent: 'research-benchmarks', claim: 'Brands that lead paid social with the subscription offer typically see 10–14% of new buyers subscribe within 60 days.', evidence: 'Subscription-led acquisition write-ups in consumables.', confidence: 'medium', source: SOURCES.metaSubRate, verdict: 'supported', verdictNote: 'Benchmarks finding: 10–14%; the plan uses 11%.' },
  { key: 'b_ltv', agent: 'research-benchmarks', claim: 'In consumables, a subscriber is typically worth 3–4× a one-time buyer over 12 months.', evidence: 'Cohort comparisons across subscription consumables brands.', confidence: 'medium', source: SOURCES.ltv, verdict: 'supported', verdictNote: 'Benchmarks finding: 3–4×.' },
  // Competitors (only the ones the merchant picked are kept)
  { key: 'comp_Trade Coffee', agent: 'research-competitors', claim: 'Trade Coffee leads new customers through a taste quiz straight into a subscription, so the first purchase is the subscription.', evidence: 'Visible on the storefront: the primary call to action is the quiz, which ends in a subscription.', confidence: 'high', source: SOURCES.coffeeModels, verdict: 'supported', verdictNote: 'Competitors finding: quiz-to-subscription model.' },
  { key: 'comp_Atlas Coffee Club', agent: 'research-competitors', claim: 'Atlas Coffee Club sells a subscription-first club built around a different origin each shipment; one-time purchases are secondary.', evidence: 'Storefront and plan pages lead with the club.', confidence: 'high', source: SOURCES.coffeeModels, verdict: 'supported', verdictNote: 'Competitors finding: club model.' },
  { key: 'comp_Onyx Coffee Lab', agent: 'research-competitors', claim: 'Onyx Coffee Lab sells subscriptions alongside one-time bags and offers gift subscriptions.', evidence: 'Subscription and gift pages on the storefront.', confidence: 'medium', source: SOURCES.coffeeGifting, verdict: 'supported', verdictNote: 'Competitors finding: subscriptions and gift subscriptions.' },
  { key: 'comp_Blue Bottle', agent: 'research-competitors', claim: 'Blue Bottle promotes gift subscriptions in the holiday season.', evidence: 'Seasonal gift pages feature the subscription.', confidence: 'medium', source: SOURCES.coffeeGifting, verdict: 'supported', verdictNote: 'Competitors finding: seasonal gift subscriptions.' },
  { key: 'comp_flex', agent: 'research-competitors', claim: 'Leading coffee subscriptions let subscribers change frequency, bag size or skip from their account page.', evidence: 'Account and FAQ pages across the named set.', confidence: 'medium', source: SOURCES.flexibility, verdict: 'supported', verdictNote: 'Competitors finding on flexibility features.' },
  { key: 'comp_trade_cancel', agent: 'research-competitors', claim: "Trade Coffee's cancel flow offers a delivery-frequency change before it lets you cancel.", evidence: 'One forum comment ("I think they asked if I wanted fewer bags"). Not confirmed anywhere else.', confidence: 'low', source: SOURCES.forum, verdict: 'unsupported', verdictNote: 'The only evidence is one hedged forum comment; not enough to state as fact. Moved to "What we couldn\'t verify".' },
  // Consumer trends
  { key: 't_q4', agent: 'research-trends', claim: 'Q4 is the peak season for US coffee subscription starts, driven by gifting.', evidence: 'Subscription start volumes by month across the category.', confidence: 'medium', source: SOURCES.q4, verdict: 'supported', verdictNote: 'Trends finding on Q4 seasonality.' },
  { key: 't_toomuch', agent: 'research-trends', claim: '"Too much product piling up" is one of the most common reasons shoppers give for cancelling consumable subscriptions.', evidence: 'Survey and review sampling of cancellation reasons.', confidence: 'high', source: SOURCES.tooMuch, verdict: 'supported', verdictNote: 'Trends finding on oversupply as a cancel reason.' },
  { key: 't_prices', agent: 'research-trends', claim: 'Green coffee costs rose sharply through 2025 and many specialty roasters raised retail prices, making shoppers more price-aware.', evidence: 'Commodity price reporting and roaster price-change announcements.', confidence: 'medium', source: SOURCES.prices, verdict: 'supported', verdictNote: 'Trends finding on the pricing climate.' },
  { key: 't_tiktok', agent: 'research-trends', claim: 'Brands commonly move marketplace buyers to their own site with in-package insert cards and a QR code, because marketplaces limit direct contact.', evidence: 'Marketplace-to-owned-channel playbooks.', confidence: 'medium', source: SOURCES.tiktokShop, verdict: 'supported', verdictNote: 'Trends finding on insert cards.' },
  // Follow-up 1 (web)
  { key: 'f_sendday', agent: 'followup-1', claim: 'Replenishment prompts perform best when sent 3–5 days before the typical run-out date.', evidence: 'Send-day tests for consumables; earlier sends read as spam, later sends lose to the store shelf.', confidence: 'medium', source: SOURCES.sendDay, verdict: 'supported', verdictNote: 'Follow-up 1: 3–5 days before run-out.' },
];
