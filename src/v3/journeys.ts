/**
 * Shopper-journey agents: each walks the storefront as one kind of customer and notes
 * what works and what gets in the way, from the shopper's side. Steps are tagged with
 * the goals they bear on, so the plan can lead with what matters for this merchant's
 * question while still showing everything else it saw.
 */

import type { SourceId } from '../v2/types.js';
import type { Ctx } from './ctx.js';
import type { Journey, JourneyStep } from './types.js';

interface Call {
  source: SourceId;
  tool: string;
  args?: Record<string, string>;
}

export interface JourneyAgent {
  id: string;
  journey: Journey['id'];
  label: string;
  task: string;
  calls: Call[];
  think: string;
}

const G = {
  convert: 'convert_one_time_to_sub',
  churn: 'reduce_churn',
  acquire: 'acquire_direct',
  rev: 'raise_rev_per_sub',
};

export const JOURNEY_AGENTS: JourneyAgent[] = [
  {
    id: 'journey-first-time',
    journey: 'first-time',
    label: 'First-time shopper',
    task: 'Shops on a phone from a Meta ad, buys once, and reads every email that follows',
    think: 'I am a new customer on an iPhone who tapped a "20% off your first bag" ad. I want to see what the store asks of me, where subscription shows up, and what arrives after I buy.',
    calls: [
      { source: 'storefront', tool: 'open_page', args: { path: '/collections/all' } },
      { source: 'klaviyo', tool: 'get_signup_forms' },
      { source: 'storefront', tool: 'open_page', args: { path: '/products/house-blend' } },
      { source: 'shopify', tool: 'get_pdp_performance' },
      { source: 'okendo', tool: 'get_review_summary' },
      { source: 'shopify', tool: 'get_page_speed' },
      { source: 'storefront', tool: 'open_page', args: { path: '/cart' } },
      { source: 'storefront', tool: 'open_page', args: { path: '/thank-you' } },
    ],
  },
  {
    id: 'journey-returning',
    journey: 'returning',
    label: 'Returning customer',
    task: 'A one-time buyer from 10 weeks ago comes back from a campaign email on a laptop',
    think: 'I bought House Blend once, ten weeks ago, and never subscribed. A campaign email brings me back. Does the store remember me and make buying again, or subscribing, easy?',
    calls: [
      { source: 'klaviyo', tool: 'get_deliverability' },
      { source: 'storefront', tool: 'open_page', args: { path: '/account' } },
      { source: 'shopify', tool: 'get_customer_mix' },
    ],
  },
  {
    id: 'journey-subscriber',
    journey: 'subscriber',
    label: 'Subscriber',
    task: 'An active subscriber with too much coffee tries to change their plan, then contacts support',
    think: 'I subscribe to 2 bags every 4 weeks and I have a backlog. I want fewer bags or a skip. Can I do that myself before I get charged, and what happens if I ask support instead?',
    calls: [
      { source: 'skio', tool: 'get_notifications' },
      { source: 'storefront', tool: 'open_page', args: { path: '/portal' } },
      { source: 'skio', tool: 'get_portal_usage' },
      { source: 'gorgias', tool: 'get_macros' },
      { source: 'okendo', tool: 'get_review_themes' },
    ],
  },
];

export function buildJourneys(x: Ctx): Journey[] {
  const { R, F, V, has } = x;
  const step = (s: Omit<JourneyStep, 'n'>, i: number): JourneyStep => ({ ...s, n: i + 1 });
  type S = Omit<JourneyStep, 'n'> | false;
  const ok = (s: S): s is Omit<JourneyStep, 'n'> => !!s;
  /** A shopper sees the page either way; the numbers behind it need the source connected. */
  const need = (src: SourceId, text: string) => (has(src) ? text : `Connect ${src === 'sms' ? 'Postscript' : src[0].toUpperCase() + src.slice(1)} to see how many customers this affects.`);

  const first: S[] = [
    {
      place: 'Meta ad → collection page', path: '/collections/all', device: 'mobile', sketch: 'ad', mark: 0.18,
      saw: 'The ad promised 20% off the first bag. The landing page shows a 15% popup instead, and never mentions the 20%.',
      verdict: 'issue', severity: 'med',
      why: `Message mismatch ${R('storefront.open_page.ad_offer_match', { path: '/collections/all' })}: shoppers who don't see the offer they clicked for tend to bounce. Pick one first-order offer and use it in both places.`,
      goals: [G.acquire, G.convert], opportunityId: 'o5',
    },
    {
      place: 'Email popup', path: '/collections/all', device: 'mobile', sketch: 'popup', mark: 0.45,
      saw: `The popup opens ${F('storefront.open_page.popup_delay', { path: '/collections/all' })} after landing and covers the screen.`,
      verdict: 'info',
      why: need('klaviyo', `It signs up ${F('klaviyo.get_signup_forms.popup_conversion')} of visitors ${R('klaviyo.get_signup_forms.popup_conversion')}, which is healthy, but it only ever sells a one-time discount. It could say "Subscribe and save 10% every order" as the second option.`),
      goals: [G.convert],
    },
    {
      place: 'Product page · House Blend 12oz', path: '/products/house-blend', device: 'mobile', sketch: 'pdp', mark: 0.82,
      saw: `One-time purchase is preselected. The subscribe option sits ${F('storefront.open_page.sub_widget_depth', { path: '/products/house-blend' })} down the page, below the fold, and its price only appears after tapping it.`,
      verdict: 'issue', severity: 'high',
      why: `Only ${F('shopify.get_pdp_performance.first_order_sub_share_mobile')} of mobile first orders are subscriptions ${R('shopify.get_pdp_performance.first_order_sub_share_mobile')}, against ${F('shopify.get_pdp_performance.first_order_sub_share_desktop')} on desktop ${R('shopify.get_pdp_performance.first_order_sub_share_desktop')}, where the option is visible without scrolling. This is the single biggest subscription leak on the site.`,
      goals: [G.convert, G.acquire], opportunityId: 'o8',
    },
    has('okendo') && {
      place: 'Product page · reviews', path: '/products/house-blend', device: 'mobile', sketch: 'reviews', mark: 0.2,
      saw: `${F('okendo.get_review_summary.rating')}★ from ${Math.round(V('okendo.get_review_summary.reviews')).toLocaleString('en-US')} reviews, shown right under the title.`,
      verdict: 'good',
      why: `Strong social proof ${R('okendo.get_review_summary.rating')}${R('okendo.get_review_summary.reviews')}. It never says what subscribers think, though: none of the highlighted reviews are from subscribers ${R('okendo.get_review_summary.sub_reviews_on_pdp')}.`,
      goals: [G.convert, G.acquire],
    },
    {
      place: 'Page speed', path: '/products/house-blend', device: 'mobile', sketch: 'speed', mark: 0.5,
      saw: `The main image takes ${F('shopify.get_page_speed.lcp_mobile')} to appear on a phone (${F('shopify.get_page_speed.lcp_desktop')} on a laptop).`,
      verdict: 'issue', severity: 'med',
      why: `Mobile is slow ${R('shopify.get_page_speed.lcp_mobile')} and converts at ${F('shopify.get_funnel.conversion', { device: 'mobile' })} ${R('shopify.get_funnel.conversion', { device: 'mobile' })} against ${F('shopify.get_funnel.conversion', { device: 'desktop' })} on desktop ${R('shopify.get_funnel.conversion', { device: 'desktop' })}. The heaviest thing on the page is a 4.1 MB hero video on the collection page.`,
      goals: [G.acquire, G.convert],
    },
    {
      place: 'Cart drawer', path: '/cart', device: 'mobile', sketch: 'cart', mark: 0.55,
      saw: `A free-shipping bar at $${V('storefront.open_page.free_ship_threshold', { path: '/cart' })} nudges one more item. Nothing offers to switch the bag to subscribe and save.`,
      verdict: 'issue', severity: 'med',
      why: `The shipping bar is well set against a $${V('shopify.get_store_profile.aov')} average order ${R('shopify.get_store_profile.aov')}${R('storefront.open_page.free_ship_threshold', { path: '/cart' })}. The missing "switch to subscription" toggle ${R('storefront.open_page.cart_sub_upsell', { path: '/cart' })} is a second chance to convert that the store doesn't take.`,
      goals: [G.convert], opportunityId: 'o8',
    },
    {
      place: 'Checkout', path: '/checkout', device: 'mobile', sketch: 'checkout', mark: 0.4,
      saw: 'Shop Pay and Apple Pay are offered at the top. Two taps to pay.',
      verdict: 'good',
      why: 'Checkout is not the problem: shoppers who reach it mostly finish. The losses happen earlier, on the product page and in the cart.',
      goals: [G.acquire],
    },
    {
      place: 'Thank-you page', path: '/thank-you', device: 'mobile', sketch: 'thanks', mark: 0.6,
      saw: 'Order confirmed. The page suggests following on Instagram. There is no offer to turn this order into a subscription.',
      verdict: 'issue', severity: 'high',
      why: `This is the moment a new customer is most likely to say yes ${R('storefront.open_page.thanks_sub_offer', { path: '/thank-you' })}. Skio's Post-purchase upsell can convert the order they just placed into a subscription with one tap.`,
      goals: [G.convert], opportunityId: 'o1',
    },
    {
      place: 'Emails after the order', path: 'inbox', device: 'mobile', sketch: 'email', mark: 0.35,
      saw: 'An order confirmation, a shipping email, then one "thanks for your order" story email on day 3. Nothing arrives when the bag runs low.',
      verdict: 'issue', severity: 'high',
      why: `The bag lasts about ${V('shopify.get_products.bag_days_supply')} days ${R('shopify.get_products.bag_days_supply')}, so day 10 to 12 is when a "running low?" email would land. Only ${F('shopify.get_cohorts.first_to_sub_60d')} of one-time buyers subscribe later ${R('shopify.get_cohorts.first_to_sub_60d')}.`,
      goals: [G.convert], opportunityId: 'o1',
    },
  ];

  const returning: S[] = [
    {
      place: 'Campaign email', path: 'inbox', device: 'desktop', sketch: 'email', mark: 0.3,
      saw: 'A "New: Ethiopia Guji" launch email with a good photo and one button.',
      verdict: 'issue', severity: 'med',
      why: need('klaviyo', `Opens are fine at ${F('klaviyo.get_deliverability.open_rate')} ${R('klaviyo.get_deliverability.open_rate')}, but Guji has only ${F('shopify.get_inventory_levels.guji_days_cover')} of stock left ${R('shopify.get_inventory_levels.guji_days_cover')}. A campaign that sells out in a week sends people to a "sold out" page.`),
      goals: [G.acquire, G.rev],
    },
    {
      place: 'Account page', path: '/account', device: 'desktop', sketch: 'account', mark: 0.45,
      saw: 'Order history is there, but there is no "Buy again" button and no "Subscribe to what you bought" prompt.',
      verdict: 'issue', severity: 'high',
      why: `A returning buyer has already chosen their coffee ${R('storefront.open_page.reorder', { path: '/account' })}${R('storefront.open_page.sub_prompt', { path: '/account' })}. A Skio Quick Action ("One-time to subscription") turns their last order into a plan in one click, from the account page or from an email.`,
      goals: [G.convert], opportunityId: 'o3',
    },
    {
      place: 'Product page · desktop', path: '/products/house-blend', device: 'desktop', sketch: 'pdp', mark: 0.4,
      saw: `The page loads in ${F('shopify.get_page_speed.lcp_desktop')} and the subscribe option is visible without scrolling.`,
      verdict: 'good',
      why: `Desktop is where the store's product page already works: ${F('shopify.get_pdp_performance.first_order_sub_share_desktop')} of desktop first orders are subscriptions ${R('shopify.get_pdp_performance.first_order_sub_share_desktop')}. Mobile should look like this.`,
      goals: [G.convert],
    },
    {
      place: 'Checkout · discount', path: '/checkout', device: 'desktop', sketch: 'checkout', mark: 0.55,
      saw: 'The shopper tries last month\'s 15% code again and it works.',
      verdict: 'info',
      why: `${F('shopify.get_margins.discount_share')} of orders use a code ${R('shopify.get_margins.discount_share')}, at ${F('shopify.get_margins.avg_discount')} off on average ${R('shopify.get_margins.avg_discount')}. Repeat buyers are being trained to wait for codes. Subscribe-and-save is a better "discount" because it comes with a second order.`,
      goals: [G.rev, G.convert],
    },
    {
      place: 'After the second order', path: 'inbox', device: 'desktop', sketch: 'email', mark: 0.6,
      saw: 'Same single post-purchase email as a first-time buyer. Nothing recognises this is their second order.',
      verdict: 'issue', severity: 'med',
      why: need('klaviyo', `Second-order customers are the best subscription prospects the store has, and there are no segments split by subscription status ${R('klaviyo.get_deliverability.segments_by_sub_status')}, so Klaviyo can't talk to them differently yet.`),
      goals: [G.convert], opportunityId: 'o1',
    },
  ];

  const subscriber: S[] = [
    {
      place: 'Before the charge', path: 'inbox', device: 'mobile', sketch: 'email', mark: 0.3,
      saw: 'No reminder arrives before the card is charged. The first the subscriber hears is the shipping email.',
      verdict: 'issue', severity: 'high',
      why: need('skio', `No upcoming-order reminder is set up ${R('skio.get_notifications.upcoming_order_reminder')}, and ${F('skio.get_notifications.regret_cancels')} of cancels happen within 48 hours of a charge ${R('skio.get_notifications.regret_cancels')}. Skio already sends the "Billing Reminder Notification" event to Klaviyo; nothing uses it.`),
      goals: [G.churn, G.rev], opportunityId: 'o10',
    },
    {
      place: 'Customer portal', path: '/portal', device: 'mobile', sketch: 'portal', mark: 0.5,
      saw: `Logging in is passwordless and quick. Skip is ${V('storefront.open_page.skip_depth', { path: '/portal' })} taps deep and changing frequency is ${V('storefront.open_page.frequency_depth', { path: '/portal' })} taps deep, under "Manage".`,
      verdict: 'issue', severity: 'high',
      why: need('skio', `${F('skio.get_cancel_reasons.reason_too_much')} of cancels are "too much coffee" ${R('skio.get_cancel_reasons.reason_too_much')}, yet only ${F('skio.get_skip_swap_usage.skip_usage')} of subscribers ever skip ${R('skio.get_skip_swap_usage.skip_usage')}. The fix for the top cancel reason is hidden two menus down.`),
      goals: [G.churn], opportunityId: 'o2',
    },
    {
      place: 'Portal · swap and add', path: '/portal', device: 'mobile', sketch: 'portal', mark: 0.72,
      saw: 'Swapping House Blend for Guji works well. Adding a one-time bag to the next order is possible but not suggested anywhere.',
      verdict: 'good',
      why: need('skio', `Swap is used by ${F('skio.get_skip_swap_usage.swap_usage')} ${R('skio.get_skip_swap_usage.swap_usage')}. Only ${F('skio.get_portal_usage.addon_attach')} of subscription orders carry an add-on ${R('skio.get_portal_usage.addon_attach')}; a Quick Action button in the reminder email would lift that.`),
      goals: [G.rev], opportunityId: 'o10',
    },
    {
      place: 'Cancel flow', path: '/portal/cancel', device: 'mobile', sketch: 'cancel', mark: 0.55,
      saw: 'The subscriber picks "Too much coffee". The only offer is 10% off the next order.',
      verdict: 'issue', severity: 'high',
      why: need('skio', `A discount doesn't solve "too much coffee": the flow saves ${F('skio.get_cancel_reasons.save_rate')} of sessions ${R('skio.get_cancel_reasons.save_rate')}. Skio's cancel flow can answer this reason with "Edit frequency" and "Skip next order" instead, and A/B test the change.`),
      goals: [G.churn], opportunityId: 'o2',
    },
    has('gorgias') && {
      place: 'Support ticket', path: 'helpdesk', device: 'mobile', sketch: 'support', mark: 0.5,
      saw: 'The subscriber emails support instead: "Please cancel, I have too much coffee." The agent cancels it and replies "All done, sorry to see you go".',
      verdict: 'issue', severity: 'high',
      why: `Only ${F('gorgias.get_macros.cancel_ticket_saves')} of cancel tickets end with the subscription kept ${R('gorgias.get_macros.cancel_ticket_saves')}. Skio's Gorgias widget lets the agent skip or change frequency from the sidebar, and a macro can offer that first.`,
      goals: [G.churn], opportunityId: 'o9',
    },
    has('okendo') && {
      place: 'Reviews from subscribers', path: 'reviews', device: 'mobile', sketch: 'reviews', mark: 0.4,
      saw: 'Subscribers love the freshness. A few mention boxes piling up.',
      verdict: 'good',
      why: `${F('okendo.get_review_themes.fresh')} of reviews praise freshness ${R('okendo.get_review_themes.fresh')}; ${F('okendo.get_review_themes.too_much')} of subscriber reviews mention too much coffee ${R('okendo.get_review_themes.too_much')}. Freshness is the story to tell in every subscription email.`,
      goals: [G.churn, G.convert],
    },
  ];

  const journeys: Journey[] = [
    { id: 'first-time', agentId: 'journey-first-time', persona: 'First-time shopper', who: 'New customer on an iPhone', entry: 'Tapped a Meta ad: "20% off your first bag"', steps: first.filter(ok).map(step), headline: 'Buying once is easy. Subscribing is hidden on mobile, and nothing asks again after the order.' },
    { id: 'returning', agentId: 'journey-returning', persona: 'Returning customer', who: 'One-time buyer, 10 weeks since first order', entry: 'Clicked a campaign email on a laptop', steps: returning.filter(ok).map(step), headline: 'The store doesn\'t recognise a returning buyer: no "buy again", no "make it a subscription".' },
    { id: 'subscriber', agentId: 'journey-subscriber', persona: 'Subscriber', who: 'Active subscriber, 2 bags every 4 weeks', entry: 'Has a backlog of coffee and wants fewer bags', steps: subscriber.filter(ok).map(step), headline: 'Subscribers who want less coffee can\'t easily get less coffee, so they cancel.' },
  ];
  return journeys;
}
