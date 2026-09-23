/**
 * "Build this for me" / "Walk me through it": for each move, the full build — Skio
 * configuration, the paired Klaviyo and Postscript comms with finished copy and
 * Quick Action links, the A/B test, a tracking baseline pulled from today's numbers,
 * and a click-by-click walkthrough. Feature and event names are Skio's real ones
 * (cancel flow Treatments and A/B tests, Quick Actions V3 stacks, "Skio: …" Klaviyo
 * events, skio_* profile properties, Payment Recovery, Winbacks, Post-purchase upsell).
 * Nothing here is sent anywhere: this is the demo's build preview.
 */

import type { ScoredOpportunity, TestPlan } from '../v2/types.js';
import type { Ctx } from './ctx.js';
import type { BuildAsset, BuildPackage, EmailAsset, SmsAsset, WalkStep } from './types.js';

const FROM = 'Maya at Bramble & Bean <hello@brambleandbean.example>';
const FIRST = "{{ first_name|default:'there' }}";

export function buildPackages(x: Ctx, ranked: ScoredOpportunity[], tests: Map<string, TestPlan>): BuildPackage[] {
  const { R, F, V, has } = x;
  const site = `https://${x.store.domain}`;
  const qa = (stack: string, sub = true) =>
    `${site}/a/account/quick-action-v3?stackId=${stack}${sub ? '&subscriptionId={{ event.subscriptionId }}' : ''}&qaToken={{ person.skio_qaToken|default:'' }}`;
  const sms = has('sms');
  const t = (id: string) => tests.get(id);
  const testLine = (id: string, fallback: string) => {
    const tp = t(id);
    return tp ? `About ${tp.nPerArm.toLocaleString('en-US')} people per group, so roughly ${Math.round(tp.totalWeeks)} weeks to a clear answer.` : fallback;
  };
  const footer = (): EmailAsset['blocks'][number] => ({ type: 'footer', text: `Bramble & Bean Coffee Co. · Roasted in small batches · {% unsubscribe 'Unsubscribe' %}` });
  const smsFooter = 'Reply STOP to opt out';

  const P: Record<string, () => Omit<BuildPackage, 'opportunityId' | 'title'>> = {
    // ---------------------------------------------------------------- o8
    o8: () => ({
      summary: 'Subscribe & save becomes the first thing a shopper sees and picks on every product page, with the price shown up front and a subscriber review underneath.',
      plainCase: [
        `On a laptop, ${F('shopify.get_pdp_performance.first_order_sub_share_desktop')} of first orders are subscriptions ${R('shopify.get_pdp_performance.first_order_sub_share_desktop')}. On a phone it's ${F('shopify.get_pdp_performance.first_order_sub_share_mobile')} ${R('shopify.get_pdp_performance.first_order_sub_share_mobile')}, because the option is hidden below the fold.`,
        `${Math.round(V('shopify.get_funnel.sessions', { device: 'mobile' }) / V('shopify.get_funnel.sessions', { device: 'all' }) * 100)}% of your visitors are on a phone ${R('shopify.get_funnel.sessions', { device: 'mobile' })}, so this is where most first orders are decided.`,
        `Each first order that starts as a subscription is worth about $${x.subLtv - x.oneLtv} more in its first year.`,
        'It is a settings change in your theme and Skio, not a new tool, and it can be switched back in a minute.',
      ],
      comms: 'Paired with a Klaviyo welcome-email update and an SMS welcome update that both lead with subscribe & save, so the popup, the product page and the first messages all say the same thing.',
      assets: [
        { kind: 'config', id: 'o8-pdp', name: 'Product page subscription widget', platform: 'Shopify', where: 'Online Store → Themes → Customize → Product page → Subscription widget (Skio selling plans)', settings: [
          { label: 'Default option', value: 'Subscribe & save 10% (was: One-time purchase)' },
          { label: 'Position', value: 'Directly under the price, above "Add to cart" (mobile and desktop)' },
          { label: 'Price shown before selecting', value: 'Yes: "$15.30 with Subscribe & save (was $17.00)"' },
          { label: 'Reassurance line', value: 'Skip, change or cancel anytime. Free shipping on every subscription order.' },
          { label: 'Default frequency', value: 'Every 4 weeks, with 2 / 3 / 6 weeks as options' },
          { label: 'One-time option', value: 'Kept, shown second: "Buy once · $17.00"' },
        ] },
        { kind: 'config', id: 'o8-checkout', name: 'Checkout Upgrade and Save', platform: 'Skio', where: 'Skio → Settings → Checkout → Checkout Upgrade and Save', settings: [
          { label: 'Status', value: 'On' },
          { label: 'Offer', value: '"Make this a subscription and save 10% on this and every order"' },
          { label: 'Eligible products', value: 'All subscription-eligible coffee (31 SKUs)' },
        ] },
        { kind: 'config', id: 'o8-review', name: 'Subscriber review under the widget', platform: 'Shopify', where: 'Theme → Product page → Okendo reviews block → Filter', settings: [
          { label: 'Filter', value: 'Verified subscriber · 5 stars · mentions "fresh"' },
          { label: 'Example', value: '"Never run out and it always tastes like it was roasted yesterday." — Jamie R., subscriber since March' },
        ] },
        { kind: 'email', id: 'o8-welcome', name: 'Welcome series · email 1 (updated)', platform: 'Klaviyo', timing: 'Right after popup sign-up', from: FROM,
          subject: 'Your 15% is inside (and an even better deal)', preview: 'Or save on every bag, not just the first one.', blocks: [
            { type: 'hero', art: 'bag', text: 'Fresh-roasted, delivered before you run out' },
            { type: 'heading', text: `Welcome, ${FIRST}` },
            { type: 'text', text: 'Here\'s your code for 15% off your first bag: WELCOME15. It\'s yours to use anytime this week.' },
            { type: 'text', text: 'Most of our regulars do it differently: they subscribe, save 10% on every bag, and never think about running out. Skip or cancel whenever you like, right from your account.' },
            { type: 'button', text: 'Start a subscription', href: `${site}/products/house-blend?selling_plan=every-4-weeks`, note: 'Opens the product page with Subscribe & save selected' },
            { type: 'button', text: 'Use my 15% on one bag', href: `${site}/discount/WELCOME15` },
            { type: 'quote', text: '"Never run out and it always tastes like it was roasted yesterday." — Jamie R., subscriber' },
            footer(),
          ] },
        ...(sms ? [{ kind: 'sms' as const, id: 'o8-sms', name: 'SMS welcome (updated)', platform: 'Postscript' as const, timing: 'Right after SMS sign-up',
          body: `Bramble & Bean: welcome! WELCOME15 = 15% off. Or subscribe & save 10% on every bag, skip anytime: ${site}/s/sub ${smsFooter}`, link: { href: `${site}/products/house-blend?selling_plan=every-4-weeks`, note: 'Product page with subscription preselected' } }] : []),
      ],
      test: { name: 'Subscription-first product page', split: 'Phones get the new page; laptops keep today\'s page for 3 weeks as the comparison, then everyone switches', metric: 'Share of first orders placed as a subscription', guardrail: 'Overall conversion rate and average order value', runFor: testLine('o8', 'About 3 weeks'), tool: 'Shopify theme settings (no new tools)' },
      tracking: {
        baseline: [
          { metric: 'First orders as subscription, phone', value: F('shopify.get_pdp_performance.first_order_sub_share_mobile'), ref: x.RID('shopify.get_pdp_performance.first_order_sub_share_mobile') },
          { metric: 'First orders as subscription, laptop', value: F('shopify.get_pdp_performance.first_order_sub_share_desktop'), ref: x.RID('shopify.get_pdp_performance.first_order_sub_share_desktop') },
          { metric: 'Phone conversion rate', value: F('shopify.get_funnel.conversion', { device: 'mobile' }), ref: x.RID('shopify.get_funnel.conversion', { device: 'mobile' }) },
          { metric: 'Average order value', value: `$${V('shopify.get_store_profile.aov')}`, ref: x.RID('shopify.get_store_profile.aov') },
        ],
        watch: ['First orders as subscription, by device, weekly', 'Conversion rate, by device', 'Average order value'],
        compare: `Compare phone vs laptop for the 3 weeks, then phone before vs after. Ship it everywhere if phone subscription share rises by 3 points or more with conversion flat.`,
        events: ['Shopify: orders with a selling plan (subscription) vs without', 'Skio: "Skio: New Subscription Created" with first-order flag'],
      },
      walkthrough: [
        { title: 'Save today\'s numbers', where: 'This plan → Tests & tracking', minutes: 2, do: ['Note the baseline numbers on the right. They are your "before".'], why: 'So in three weeks you can see exactly what changed.' },
        { title: 'Make subscription the default', where: 'Shopify → Online Store → Themes → Customize → Product page', minutes: 10, do: ['Click the subscription widget block.', 'Set the default option to Subscribe & save.', 'Drag the block up so it sits right under the price.', 'Turn on "Show subscription price before selection".'], values: [{ label: 'Reassurance line', value: 'Skip, change or cancel anytime. Free shipping on every subscription order.' }], assets: ['o8-pdp'], why: 'Shoppers pick what\'s already picked. Right now that\'s one-time.' },
        { title: 'Add a subscriber review under it', where: 'Theme → Product page → Okendo reviews block', minutes: 5, do: ['Add a small reviews block under the widget.', 'Filter to verified subscribers, 5 stars.'], assets: ['o8-review'], why: 'People trust other subscribers more than they trust us.' },
        { title: 'Turn on Checkout Upgrade and Save', where: 'Skio → Settings → Checkout', minutes: 3, do: ['Switch Checkout Upgrade and Save on.', 'Paste the offer text.'], values: [{ label: 'Offer text', value: 'Make this a subscription and save 10% on this and every order' }], assets: ['o8-checkout'], why: 'A second chance for anyone who still picked one-time.' },
        { title: 'Update the welcome email and text', where: 'Klaviyo → Flows → Welcome series → Email 1' + (sms ? '; Postscript → Flows → Welcome' : ''), minutes: 15, do: ['Replace the email body with the new copy.', 'Add both buttons.', ...(sms ? ['Update the SMS text.'] : [])], assets: ['o8-welcome', ...(sms ? ['o8-sms'] : [])], why: 'So the first message a new customer gets tells the same story as the product page.' },
        { title: 'Start the comparison', where: 'Theme settings', minutes: 2, do: ['Apply the new widget to mobile only for 3 weeks.', 'Put the readout date in your calendar.'], values: [{ label: 'Readout date', value: x.date(3) }], why: 'Laptop visitors act as the comparison group, so you know the change caused the lift.' },
      ],
      buildLog: ['Reading your product page on a phone', 'Moving the subscription widget above "Add to cart"', 'Writing the reassurance line', 'Picking a subscriber review from Okendo', 'Turning on Skio Checkout Upgrade and Save', 'Rewriting welcome email 1', ...(sms ? ['Rewriting the SMS welcome'] : []), 'Setting up the phone vs laptop comparison', 'Saving today\'s baseline'],
    }),
    // ---------------------------------------------------------------- o1
    o1: () => ({
      summary: 'Turn the order someone just placed into a subscription on the thank-you page, then ask again at day 10, just before their bag runs out, with a one-click link.',
      plainCase: [
        `${V('shopify.get_store_profile.first_time_buyers_per_month').toLocaleString('en-US')} people buy from you for the first time every month ${R('shopify.get_store_profile.first_time_buyers_per_month')}. Only ${F('shopify.get_cohorts.first_to_sub_60d')} of the one-time buyers ever subscribe ${R('shopify.get_cohorts.first_to_sub_60d')}.`,
        `Nothing asks them: the thank-you page has no offer ${R('storefront.open_page.thanks_sub_offer', { path: '/thank-you' })} and the only follow-up email never mentions subscribing ${R('klaviyo.get_flow_performance.sub_offer', { flowId: 'post_purchase' })}.`,
        `A bag lasts about ${V('shopify.get_products.bag_days_supply')} days ${R('shopify.get_products.bag_days_supply')}, so day 10 is when "running low?" is true, not pushy.`,
        `A subscriber is worth $${x.subLtv} in year one, against $${x.oneLtv} for a one-time buyer.`,
      ],
      comms: `Day-10 Klaviyo email with a Skio Quick Action ("One-time to subscription") button${sms ? ', plus a day-12 Postscript text for anyone who didn\'t open it' : ''}.`,
      assets: [
        { kind: 'config', id: 'o1-sync', name: 'Skio → Klaviyo integration', platform: 'Skio', where: 'Skio → Integrations → Klaviyo', settings: [
          { label: 'Sync subscriber properties', value: 'On (adds skio_hasActiveSubscription, skio_nextBillingDate, skio_qaToken to each profile)' },
          { label: 'Send events', value: 'On ("Skio: New Subscription Created", "Skio: Billing Reminder Notification", …)' },
        ] },
        { kind: 'config', id: 'o1-ppu', name: 'Post-purchase upsell', platform: 'Skio', where: 'Skio → Upsells → Post-purchase upsell', settings: [
          { label: 'Offer', value: 'Convert this order to a subscription' },
          { label: 'Headline', value: 'Want this every 4 weeks? Save 10% starting today.' },
          { label: 'Discount', value: x.brief.constraints.includes('max_discount_15') ? '10% (inside your 15% cap)' : '10%' },
          { label: 'Show to', value: 'First-time buyers of subscription-eligible coffee' },
        ] },
        { kind: 'config', id: 'o1-qa', name: 'Quick Action stack: make it a subscription', platform: 'Skio', where: 'Skio → Quick Actions → New stack', settings: [
          { label: 'Action', value: 'One-time to subscription (smart billing: next order in 4 weeks)' },
          { label: 'Discount', value: 'Apply discount: 10% on every order' },
          { label: 'Link type', value: 'Klaviyo · Flow' },
          { label: 'Landing page', value: 'On: "You\'re all set, your next bag ships in 4 weeks"' },
          { label: 'Limit', value: 'Once per customer · link expires after 14 days' },
          { label: 'Link', value: qa('qa_ppsub', false) },
        ] },
        { kind: 'flow', id: 'o1-flow', name: 'Post-Purchase: Thank you (updated)', platform: 'Klaviyo', trigger: 'Placed Order (first order)', filters: ['skio_hasActiveSubscription is false', 'Has not received this flow in the last 60 days'], steps: [
          { kind: 'email', label: 'Day 3 · "How to brew it" (existing)' },
          { kind: 'delay', label: 'Wait until day 10' },
          { kind: 'split', label: 'A/B: 50% get email 2, 50% get nothing (the test)' },
          { kind: 'email', label: 'Day 10 · "Running low?" with one-click subscribe' },
          ...(sms ? [{ kind: 'delay' as const, label: 'Wait 2 days' }, { kind: 'sms' as const, label: 'Day 12 · Postscript text if email 2 not opened' }] : []),
          { kind: 'exit', label: 'Exit when skio_hasActiveSubscription becomes true' },
        ] },
        { kind: 'email', id: 'o1-email', name: 'Day 10 · Running low?', platform: 'Klaviyo', timing: 'Day 10 after first order', from: FROM,
          subject: 'Running low on {{ event.extra.line_items.0.product.title|default:\'coffee\' }}?', preview: 'One click and your next bag is on its way before you run out.', blocks: [
            { type: 'hero', art: 'calendar', text: 'Day 10 of 14: about 4 days of coffee left' },
            { type: 'heading', text: `${FIRST}, your bag is almost empty` },
            { type: 'text', text: 'A 12oz bag lasts about two weeks at two cups a day. So you\'re probably getting close.' },
            { type: 'text', text: 'Make it a subscription and the next bag arrives before you run out, 10% cheaper, every time. Skip, change or cancel whenever you want.' },
            { type: 'button', text: 'Yes, send it every 4 weeks', href: qa('qa_ppsub', false), note: 'Skio Quick Action · One-time to subscription + 10% off. No login needed.' },
            { type: 'products', items: [{ name: 'House Blend 12oz', price: '$15.30', note: 'every 4 weeks (save $1.70)' }, { name: 'Ethiopia Guji 12oz', price: '$17.10', note: 'swap anytime' }] },
            { type: 'quote', text: '"I stopped buying grocery-store coffee the week I subscribed." — Priya S., subscriber' },
            { type: 'text', text: 'Rather order just one more bag? That works too: reply to this email and we\'ll sort it.' },
            footer(),
          ] },
        ...(sms ? [{ kind: 'sms' as const, id: 'o1-sms', name: 'Day 12 · Running low? (text)', platform: 'Postscript' as const, timing: 'Day 12, only if email 2 not opened',
          body: `Bramble & Bean: running low? Get a bag every 4 weeks, 10% off, skip anytime. One tap: ${site}/qa/sub ${smsFooter}`, link: { href: qa('qa_ppsub', false), note: 'Same Skio Quick Action, shortened for SMS' } }] : []),
      ],
      test: { name: 'Day-10 subscribe email', split: 'Klaviyo flow split 50/50 at email 2 (email vs no email)', metric: 'Subscription starts within 60 days of first order', guardrail: 'Unsubscribe rate and one-time repeat orders', runFor: testLine('o1', 'About 8 weeks'), tool: 'Klaviyo A/B split in the flow' },
      tracking: {
        baseline: [
          { metric: 'One-time buyers who subscribe within 60 days', value: F('shopify.get_cohorts.first_to_sub_60d'), ref: x.RID('shopify.get_cohorts.first_to_sub_60d') },
          { metric: 'Post-purchase flow revenue per recipient', value: `$${V('klaviyo.get_flow_performance.revenue_per_recipient', { flowId: 'post_purchase' })}`, ref: x.RID('klaviyo.get_flow_performance.revenue_per_recipient', { flowId: 'post_purchase' }) },
          { metric: 'Post-purchase recipients (90 days)', value: V('klaviyo.get_flow_performance.recipients', { flowId: 'post_purchase' }).toLocaleString('en-US'), ref: x.RID('klaviyo.get_flow_performance.recipients', { flowId: 'post_purchase' }) },
        ],
        watch: ['Quick Action clicks and completions (Skio → Quick Actions analytics)', 'Post-purchase upsell take rate (Skio)', 'Subscription starts within 60 days, email group vs no-email group'],
        compare: 'Early read at 3 weeks on subscriptions started within 14 days of email 2; final read at 60 days. Ship if the email group is at least 1 point higher and unsubscribes rise less than 0.2 points.',
        events: ['Klaviyo: Placed Order, Opened/Clicked Email (email 2)', 'Skio: "Skio: New Subscription Created"', 'Skio: Quick Action completed (stack qa_ppsub)'],
      },
      walkthrough: [
        { title: 'Connect Skio to Klaviyo', where: 'Skio → Integrations → Klaviyo', minutes: 5, do: ['Click Connect and sign in to Klaviyo.', 'Turn on "Sync subscriber properties" and "Send events".'], assets: ['o1-sync'], why: 'Without this, Klaviyo can\'t tell who already subscribes, so it would pester your subscribers.' },
        { title: 'Turn on the thank-you page offer', where: 'Skio → Upsells → Post-purchase upsell', minutes: 5, do: ['Choose "Convert this order to a subscription".', 'Paste the headline, set 10% off, limit it to first-time buyers.'], assets: ['o1-ppu'], why: 'Right after buying is when people are most likely to say yes.' },
        { title: 'Create the one-click subscribe link', where: 'Skio → Quick Actions → New stack', minutes: 5, do: ['Add the action "One-time to subscription".', 'Add "Apply discount" at 10%.', 'Set link type to Klaviyo · Flow, once per customer, expires in 14 days.', 'Copy the link.'], assets: ['o1-qa'], why: 'One click from the email and they\'re subscribed. No login, no cart.' },
        { title: 'Add the day-10 email', where: 'Klaviyo → Flows → Post-Purchase: Thank you', minutes: 20, do: ['After the day-3 email, add a delay until day 10.', 'Add an A/B split (50/50).', 'In one branch, add the new email and paste the copy and the Quick Action link on the button.', 'Add the filter skio_hasActiveSubscription is false.'], assets: ['o1-flow', 'o1-email'], why: 'The split is your test: half get the email, half don\'t, so you know what the email itself did.' },
        ...(sms ? [{ title: 'Add the day-12 text', where: 'Postscript → Flows', minutes: 10, do: ['Trigger: 12 days after first order, only if email 2 wasn\'t opened.', 'Paste the text and the short link.'], assets: ['o1-sms'], why: `Texts get opened; ${F('sms.get_sms_campaign_performance.click_rate')} of your texts get a click ${R('sms.get_sms_campaign_performance.click_rate')}.` } as WalkStep] : []),
        { title: 'Turn it on and set the readout', where: 'Klaviyo', minutes: 2, do: ['Set the flow to Live.', 'Put the early readout in your calendar.'], values: [{ label: 'Early readout', value: x.date(3) }, { label: 'Final readout', value: x.date(Math.round(t('o1')?.totalWeeks ?? 8) + 5) }], why: 'Two dates: an early signal, and the full 60-day answer.' },
      ],
      buildLog: ['Connecting Skio events and properties to Klaviyo', 'Configuring Skio Post-purchase upsell', 'Creating Quick Action stack qa_ppsub (One-time to subscription + 10%)', 'Writing day-10 email: subject, body, buttons', 'Adding a 50/50 split to the flow', ...(sms ? ['Writing the day-12 Postscript text'] : []), 'Adding the "already subscribed" exit', 'Saving today\'s baseline'],
    }),
    // ---------------------------------------------------------------- o2
    o2: () => ({
      summary: 'When a subscriber says "too much coffee", Skio offers fewer bags, a slower schedule or a skip before anything else, and A/B tests it against today\'s flow.',
      plainCase: [
        `A third of the people who cancel say they have too much coffee ${R('skio.get_cancel_reasons.reason_too_much')}. They like the coffee. They just get too much of it.`,
        `Today the only offer is 10% off, which doesn't fix that, so the flow keeps ${F('skio.get_cancel_reasons.save_rate')} of people ${R('skio.get_cancel_reasons.save_rate')}.`,
        `Skip is buried two menus down in the portal, and only ${F('skio.get_skip_swap_usage.skip_usage')} of subscribers have ever used it ${R('skio.get_skip_swap_usage.skip_usage')}.`,
        `A saved subscriber places about ${V('skio.get_cancel_reasons.saved_extra_orders')} more orders ${R('skio.get_cancel_reasons.saved_extra_orders')}, roughly $${Math.round(V('skio.get_cancel_reasons.saved_extra_orders') * V('skio.get_subscription_summary.sub_order_value'))} each.`,
      ],
      comms: `Klaviyo flow on "Skio: Subscription Went Through Cancel Flow": saved subscribers get a "your new plan" email with Quick Action links to adjust it${sms ? ', and a Postscript text reminding them they can reply SKIP anytime' : ''}.`,
      assets: [
        { kind: 'cancel-flow', id: 'o2-flow', name: 'Cancel flow · variant "Flexibility first"', platform: 'Skio', where: 'Skio → Cancel Flow → editor', reasons: [
          { reason: 'I have too much coffee', share: F('skio.get_cancel_reasons.reason_too_much'), ref: x.RID('skio.get_cancel_reasons.reason_too_much'), offers: [
            { type: 'Edit frequency', label: 'Get coffee every 6 weeks instead' },
            { type: 'Swap product', label: 'Switch to 1 bag per delivery' },
            { type: 'Skip next order', label: 'Skip my next delivery' },
          ] },
          { reason: "It's too expensive", share: F('skio.get_cancel_reasons.reason_price'), ref: x.RID('skio.get_cancel_reasons.reason_price'), offers: [
            { type: 'Offer discount', label: `10% off your next 3 orders${x.brief.constraints.includes('max_discount_15') ? ' (inside your 15% cap)' : ''}` },
            { type: 'Swap product', label: 'Try House Blend at $15.30' },
          ] },
          { reason: 'I want to try something different', share: F('skio.get_cancel_reasons.reason_taste'), ref: x.RID('skio.get_cancel_reasons.reason_taste'), offers: [
            { type: 'Swap product', label: 'Pick a different roast for your next bag' },
            { type: 'Offer gift', label: 'Free sampler with your next order' },
          ] },
          { reason: "I'm moving / other", share: F('skio.get_cancel_reasons.reason_other'), ref: x.RID('skio.get_cancel_reasons.reason_other'), offers: [
            { type: 'Pause', label: 'Pause for 1, 2 or 3 months' },
            { type: 'Change next order date', label: 'Ship to your new address later' },
          ] },
        ], variants: [
          { name: 'Control', split: 50, description: 'Today\'s flow: every reason gets 10% off' },
          { name: 'Variant: Flexibility first', split: 50, description: 'Reason-specific Treatments above' },
        ] },
        { kind: 'config', id: 'o2-ab', name: 'Cancel flow A/B test', platform: 'Skio', where: 'Skio → Cancel Flow → Create A/B Test', settings: [
          { label: 'Control', value: 'Current cancel flow' },
          { label: 'Variant', value: 'Flexibility first' },
          { label: 'Traffic split', value: '50 / 50, assigned by subscription' },
          { label: 'Goal', value: 'Churn reduction (save rate)' },
          { label: 'Stop when', value: '95% statistical significance, or on ' + x.date(8) },
          { label: 'Notify me', value: 'On' },
          { label: 'Note', value: 'Cancel flow A/B testing may need to be switched on for your store by Skio support.' },
        ] },
        { kind: 'config', id: 'o2-portal', name: 'Portal shortcuts', platform: 'Skio', where: 'Skio → Customer Portal → Settings', settings: [
          { label: 'Show on portal home', value: '"Skip next order" and "Change frequency" buttons (were under Manage)' },
          { label: 'Frequency options', value: 'Every 2, 4, 6 or 8 weeks' },
        ] },
        { kind: 'flow', id: 'o2-klaviyo-flow', name: 'Saved in cancel flow', platform: 'Klaviyo', trigger: '"Skio: Subscription Went Through Cancel Flow"', filters: ['Outcome is saved', 'skio_hasActiveSubscription is true'], steps: [
          { kind: 'email', label: 'Immediately · "Your new plan"' },
          ...(sms ? [{ kind: 'delay' as const, label: 'Wait 1 day' }, { kind: 'sms' as const, label: 'Postscript · "Reply SKIP anytime"' }] : []),
          { kind: 'exit', label: 'Exit' },
        ] },
        { kind: 'email', id: 'o2-email', name: 'Your new plan', platform: 'Klaviyo', timing: 'Right after a save', from: FROM,
          subject: 'Done: your coffee now arrives every 6 weeks', preview: 'Change it again anytime, with one click.', blocks: [
            { type: 'hero', art: 'cups', text: 'Less coffee, same great coffee' },
            { type: 'heading', text: `Thanks for staying, ${FIRST}` },
            { type: 'text', text: 'Your next bag ships on {{ person.skio_nextBillingDate|date:"M j" }}. If it\'s still too much, or not enough, change it in one click:' },
            { type: 'button', text: 'Skip my next delivery', href: qa('qa_skip'), note: 'Skio Quick Action · Skip' },
            { type: 'button', text: 'Every 8 weeks instead', href: qa('qa_every8'), note: 'Skio Quick Action · Change interval (8 weeks)' },
            { type: 'text', text: 'No logins, no forms. Just tap.' },
            footer(),
          ] },
        ...(sms ? [{ kind: 'sms' as const, id: 'o2-sms', name: 'Reply SKIP anytime', platform: 'Postscript' as const, timing: '1 day after a save',
          body: `Bramble & Bean: your plan is updated. Getting too much again? Just reply SKIP and we'll skip your next delivery. ${smsFooter}` }] : []),
      ],
      test: { name: 'Cancel flow: Flexibility first', split: 'Skio cancel flow A/B test, 50/50 by subscription', metric: 'Save rate (Skio Cancel Flow analytics)', guardrail: 'Subscribers who cancel again within 30 days', runFor: testLine('o2', 'About 6 weeks'), tool: 'Skio Cancel Flow A/B test (stops at 95% significance)' },
      tracking: {
        baseline: [
          { metric: 'Cancel-flow save rate', value: F('skio.get_cancel_reasons.save_rate'), ref: x.RID('skio.get_cancel_reasons.save_rate') },
          { metric: 'Cancel sessions per month', value: V('skio.get_cancel_reasons.cancel_sessions').toLocaleString('en-US'), ref: x.RID('skio.get_cancel_reasons.cancel_sessions') },
          { metric: 'Monthly churn', value: F('skio.get_churn.monthly_churn'), ref: x.RID('skio.get_churn.monthly_churn') },
          { metric: 'Subscribers who use skip', value: F('skio.get_skip_swap_usage.skip_usage'), ref: x.RID('skio.get_skip_swap_usage.skip_usage') },
        ],
        watch: ['Save rate per variant and p-value (Skio A/B test results)', 'Saved sessions by reason', 'Re-cancels within 30 days', 'Skip and frequency changes per month'],
        compare: 'Skio stops the test at 95% confidence and shows the save-rate change in points. Promote the variant if it wins and 30-day re-cancels stay under 25%.',
        events: ['Skio: "Skio: Subscription Went Through Cancel Flow"', 'Skio: "Skio: Subscription Skipped"', 'Skio: "Skio: Subscription Cancelled"'],
      },
      walkthrough: [
        { title: 'Copy today\'s flow as the control', where: 'Skio → Cancel Flow', minutes: 3, do: ['Duplicate the active cancel flow and name the copy "Flexibility first".'], why: 'You keep the old flow running for half your subscribers, so the test is fair.' },
        { title: 'Add a Treatment for "too much coffee"', where: 'Skio → Cancel Flow → editor → Reason: Too much coffee', minutes: 15, do: ['Click the reason and add a Treatment.', 'Add three actions: Edit frequency (6 weeks), Swap product (1 bag), Skip next order.', 'Put them before any discount.'], assets: ['o2-flow'], why: 'Give people the thing they actually asked for: less coffee.' },
        { title: 'Tidy the other reasons', where: 'Same editor', minutes: 10, do: ['Price: 10% off the next 3 orders.', 'Taste: Swap product and a free sampler.', 'Moving: Pause.'], assets: ['o2-flow'], why: 'Each reason gets the answer that fits it.' },
        { title: 'Start the A/B test', where: 'Skio → Cancel Flow → Create A/B Test', minutes: 5, do: ['Control: current flow. Variant: Flexibility first.', 'Split 50/50 by subscription.', 'Goal: Churn reduction. Stop at 95% significance.'], assets: ['o2-ab'], why: 'Skio does the statistics for you and tells you when there\'s a winner.' },
        { title: 'Put skip and frequency on the portal home', where: 'Skio → Customer Portal → Settings', minutes: 5, do: ['Show "Skip next order" and "Change frequency" on the home screen.'], assets: ['o2-portal'], why: 'Fewer people reach the cancel button when the easier fix is right there.' },
        { title: 'Add the "your new plan" message', where: 'Klaviyo → Flows → Create flow', minutes: 15, do: ['Trigger: "Skio: Subscription Went Through Cancel Flow", outcome saved.', 'Paste the email with its two Quick Action buttons.', ...(sms ? ['Add the Postscript text a day later.'] : [])], assets: ['o2-klaviyo-flow', 'o2-email', ...(sms ? ['o2-sms'] : [])], why: 'A saved subscriber who feels in control stays saved.' },
      ],
      buildLog: ['Duplicating your cancel flow as the control', 'Adding Treatment: Edit frequency, Swap product, Skip next order', 'Adding reason-specific offers for price, taste and moving', 'Creating Skio A/B test (50/50, 95% significance)', 'Moving skip and frequency to the portal home', 'Creating Quick Action stacks qa_skip and qa_every8', 'Writing the "your new plan" email', ...(sms ? ['Writing the "reply SKIP" text'] : []), 'Saving today\'s baseline'],
    }),
    // ---------------------------------------------------------------- o9
    o9: () => ({
      summary: 'Support offers a skip or a slower schedule before cancelling, straight from Skio\'s Gorgias sidebar, with Quick Action links customers can tap themselves.',
      plainCase: [
        `About ${Math.round(V('gorgias.get_ticket_summary.tickets') * V('gorgias.get_ticket_reasons.cancel_request'))} people a month email support to cancel ${R('gorgias.get_ticket_summary.tickets')}${R('gorgias.get_ticket_reasons.cancel_request')}, and agents cancel straight away.`,
        `Only ${F('gorgias.get_macros.cancel_ticket_saves')} of those subscriptions are kept ${R('gorgias.get_macros.cancel_ticket_saves')}. Teams that offer a skip first keep 20–30%.`,
        `Another ${F('gorgias.get_ticket_reasons.change_skip')} of tickets are "please skip" or "please change" ${R('gorgias.get_ticket_reasons.change_skip')}, which customers could do themselves with one link.`,
        'Your agents already use Gorgias. This adds a sidebar and two macros, nothing new to learn.',
      ],
      comms: `The macro itself is the message: it includes Skio Quick Action links. A Klaviyo confirmation email follows every save${sms ? ', and Postscript "reply SKIP" handles the rest by text' : ''}.`,
      assets: [
        { kind: 'config', id: 'o9-widget', name: 'Skio sidebar in Gorgias', platform: 'Gorgias', where: 'Gorgias → Settings → Integrations → Skio', settings: [
          { label: 'Widget', value: 'On: shows each subscription, next billing date, frequency, items and cancel reasons' },
          { label: 'Agent actions', value: 'Skip, get now, apply discount code, cancel (with reason), update payment' },
        ] },
        { kind: 'macro', id: 'o9-macro-cancel', name: 'Cancel request · offer first', platform: 'Gorgias', when: 'Ticket tagged "cancel" (auto-tag rule on words like cancel, stop, unsubscribe me)', body: `Hi {{ticket.customer.firstname}},\n\nThanks for letting us know. Before I cancel, would one of these fix it? Each one is a single tap, no login:\n\n• Skip your next delivery: ${qa('qa_skip')}\n• Get coffee every 8 weeks instead: ${qa('qa_every8')}\n• Pause for a month: ${qa('qa_pause1')}\n\nIf you'd still like to cancel, just reply "cancel" and I'll do it right away, no questions asked.\n\nMaya, Bramble & Bean`, actions: ['Add tag: save-offer-sent', 'Set status: pending (auto-close in 3 days)'] },
        { kind: 'macro', id: 'o9-macro-skip', name: 'Skip or change · do it for them', platform: 'Gorgias', when: 'Ticket tagged "skip" or "change frequency"', body: `Hi {{ticket.customer.firstname}},\n\nAll done: I've skipped your next delivery. Your next bag now ships on {{ticket.customer.integrations.skio.next_billing_date}}.\n\nNext time you can do it yourself in one tap: ${qa('qa_skip')}\n\nMaya`, actions: ['Skio: Skip (from the sidebar)', 'Add tag: self-serve-link-sent', 'Close ticket'] },
        { kind: 'config', id: 'o9-rule', name: 'Auto-tag rule', platform: 'Gorgias', where: 'Gorgias → Automation → Rules', settings: [
          { label: 'When', value: 'Ticket created and message contains "cancel", "stop my subscription", "unsubscribe me"' },
          { label: 'Then', value: 'Add tag "cancel" and suggest macro "Cancel request · offer first"' },
        ] },
        { kind: 'email', id: 'o9-email', name: 'Saved by support · confirmation', platform: 'Klaviyo', timing: 'When the customer taps a Quick Action from the macro', from: FROM,
          subject: 'You\'re all set', preview: 'Your plan is updated. Change it again anytime.', blocks: [
            { type: 'hero', art: 'heart', text: 'Thanks for sticking with us' },
            { type: 'text', text: `${FIRST}, your change is done. Your next delivery is on {{ person.skio_nextBillingDate|date:"M j" }}.` },
            { type: 'button', text: 'Manage my subscription', href: `${site}/a/account/login`, note: 'Skio customer portal' },
            footer(),
          ] },
      ],
      test: { name: 'Save-first macros', split: 'Alternate weeks: macro on for odd weeks, today\'s process on even weeks (support tickets can\'t be randomised per person easily)', metric: 'Cancel tickets that end with the subscription kept', guardrail: 'CSAT and first response time', runFor: testLine('o9', 'About 6 weeks'), tool: 'Gorgias tags and macros' },
      tracking: {
        baseline: [
          { metric: 'Cancel tickets saved', value: F('gorgias.get_macros.cancel_ticket_saves'), ref: x.RID('gorgias.get_macros.cancel_ticket_saves') },
          { metric: 'Cancel-request share of tickets', value: F('gorgias.get_ticket_reasons.cancel_request'), ref: x.RID('gorgias.get_ticket_reasons.cancel_request') },
          { metric: 'CSAT', value: F('gorgias.get_ticket_summary.csat'), ref: x.RID('gorgias.get_ticket_summary.csat') },
          { metric: 'First response time', value: F('gorgias.get_ticket_summary.first_response'), ref: x.RID('gorgias.get_ticket_summary.first_response') },
        ],
        watch: ['Tickets tagged save-offer-sent → still subscribed 30 days later', 'Quick Action clicks from Gorgias links', 'Skip/change tickets per month (should fall)'],
        compare: 'Compare saved share on macro weeks vs normal weeks. Keep it if at least 15% of cancel tickets are saved and CSAT holds.',
        events: ['Gorgias: tag save-offer-sent', 'Skio: Quick Action completed (qa_skip, qa_every8, qa_pause1)', 'Skio: "Skio: Subscription Cancelled"'],
      },
      walkthrough: [
        { title: 'Install the Skio sidebar', where: 'Gorgias → Settings → Integrations → Skio', minutes: 5, do: ['Connect Skio.', 'Check a subscriber ticket shows their subscription on the right.'], assets: ['o9-widget'], why: 'Agents see the subscription without switching tabs, and can skip it in one click.' },
        { title: 'Create the Quick Action links', where: 'Skio → Quick Actions', minutes: 10, do: ['Create three stacks: Skip, Change interval (8 weeks), Pause (1 month).', 'Link type: Universal.'], why: 'Customers can fix it themselves right from the reply.' },
        { title: 'Add the two macros', where: 'Gorgias → Macros', minutes: 10, do: ['Paste both macros.', 'Swap in the three links.'], assets: ['o9-macro-cancel', 'o9-macro-skip'], why: 'Everyone on the team gives the same, well-worded answer.' },
        { title: 'Auto-tag cancel requests', where: 'Gorgias → Automation → Rules', minutes: 5, do: ['Create the rule so cancel requests get tagged and the macro is suggested.'], assets: ['o9-rule'], why: 'Nothing slips through on a busy day.' },
        { title: 'Add the confirmation email', where: 'Klaviyo → Flows', minutes: 10, do: ['Trigger on the Quick Action events.', 'Paste the email.'], assets: ['o9-email'], why: 'Closes the loop so the customer knows it worked.' },
      ],
      buildLog: ['Connecting Skio to the Gorgias sidebar', 'Creating Quick Action stacks: skip, every 8 weeks, pause 1 month', 'Writing macro "Cancel request · offer first"', 'Writing macro "Skip or change · do it for them"', 'Creating the auto-tag rule', 'Writing the confirmation email', 'Saving today\'s baseline'],
    }),
    // ---------------------------------------------------------------- o3
    o3: () => ({
      summary: 'A three-touch winback for customers who haven\'t ordered in 60 days that leads with a subscription, plus Skio Winbacks for cancelled subscribers.',
      plainCase: [
        `${V('shopify.get_cohorts.lapsed_customers').toLocaleString('en-US')} customers haven\'t ordered in 120 days ${R('shopify.get_cohorts.lapsed_customers')}, and about ${V('shopify.get_cohorts.newly_lapsed_per_month').toLocaleString('en-US')} more join them every month ${R('shopify.get_cohorts.newly_lapsed_per_month')}.`,
        `Only ${F('shopify.get_cohorts.organic_reactivation_rate')} come back on their own ${R('shopify.get_cohorts.organic_reactivation_rate')}. There is no winback email today ${R('klaviyo.list_flows.missing_standard_flows')}.`,
        `The Decaf is overstocked (${F('shopify.get_inventory_levels.decaf_days_cover')} of cover ${R('shopify.get_inventory_levels.decaf_days_cover')}), so a free bag of it is a cheaper thank-you than a bigger discount.`,
      ],
      comms: `Klaviyo winback flow (60/90/120 days) with a Quick Action "One-time to subscription" button${sms ? ' and a Postscript text on day 90' : ''}; Skio Winbacks handles cancelled subscribers with its own emails.`,
      assets: [
        { kind: 'flow', id: 'o3-flow', name: 'Winback: lapsed customers', platform: 'Klaviyo', trigger: '60 days since last order (metric: Placed Order)', filters: ['skio_hasActiveSubscription is false', 'Not in the holdout (random 50%)'], steps: [
          { kind: 'email', label: 'Day 60 · "We roasted something new"' },
          { kind: 'delay', label: 'Wait 30 days' },
          { kind: 'email', label: 'Day 90 · "Come back on a subscription, save 10%"' },
          ...(sms ? [{ kind: 'sms' as const, label: 'Day 90 · Postscript text' }] : []),
          { kind: 'delay', label: 'Wait 30 days' },
          { kind: 'email', label: 'Day 120 · "Last call + free Decaf"' },
          { kind: 'exit', label: 'Exit when they order' },
        ] },
        { kind: 'email', id: 'o3-e1', name: 'Day 60 · We roasted something new', platform: 'Klaviyo', timing: '60 days after last order', from: FROM,
          subject: 'It\'s been a while, so we roasted something new', preview: 'Ethiopia Guji is back, while it lasts.', blocks: [
            { type: 'hero', art: 'bag', text: 'New this month' },
            { type: 'heading', text: `Hi ${FIRST}, we miss you` },
            { type: 'text', text: 'Since your last order we\'ve roasted a few new coffees. Here are the two our regulars are drinking right now.' },
            { type: 'products', items: [{ name: 'Ethiopia Guji 12oz', price: '$19.00', note: 'bright, berry, limited' }, { name: 'House Blend 12oz', price: '$17.00', note: 'your last order' }] },
            { type: 'button', text: 'See what\'s fresh', href: `${site}/collections/new` },
            footer(),
          ] },
        { kind: 'email', id: 'o3-e2', name: 'Day 90 · Come back on a subscription', platform: 'Klaviyo', timing: '90 days after last order', from: FROM,
          subject: 'Your House Blend, every 4 weeks, 10% off', preview: 'One click, skip anytime.', blocks: [
            { type: 'hero', art: 'calendar', text: 'Never run out again' },
            { type: 'text', text: `${FIRST}, you ordered House Blend last time. Want it to just show up? Subscribe in one click and save 10% on every bag.` },
            { type: 'button', text: 'Start my subscription', href: qa('qa_winsub', false), note: 'Skio Quick Action · One-time to subscription + 10%' },
            { type: 'text', text: 'Skip, swap or cancel anytime from your account.' },
            footer(),
          ] },
        { kind: 'email', id: 'o3-e3', name: 'Day 120 · Last call', platform: 'Klaviyo', timing: '120 days after last order', from: FROM,
          subject: 'Last call: a free bag of Decaf on us', preview: 'With your next order or subscription.', blocks: [
            { type: 'hero', art: 'gift', text: 'A little thank-you' },
            { type: 'text', text: 'Order anything this week and we\'ll add a bag of our Swiss Water Decaf, free. Start a subscription and it\'s in your first box.' },
            { type: 'button', text: 'Claim my free Decaf', href: `${site}/discount/DECAFONUS`, note: 'Free-gift discount code' },
            footer(),
          ] },
        ...(sms ? [{ kind: 'sms' as const, id: 'o3-sms', name: 'Day 90 · Winback text', platform: 'Postscript' as const, timing: 'Day 90',
          body: `Bramble & Bean: your House Blend, every 4 weeks, 10% off, skip anytime. Start in one tap: ${site}/qa/winsub ${smsFooter}` }] : []),
        { kind: 'config', id: 'o3-skio-winback', name: 'Winbacks for cancelled subscribers', platform: 'Skio', where: 'Skio → Winbacks', settings: [
          { label: 'Audience', value: 'Subscribers cancelled 30+ days ago' },
          { label: 'Offer', value: '10% off, percentage' },
          { label: 'Emails', value: 'Skio Winback template, via Klaviyo ("Skio: Winback Initiated")' },
        ] },
      ],
      test: { name: 'Winback holdout', split: 'Half of lapsing customers get the flow, half get nothing (holdout)', metric: 'Orders or subscription starts within 90 days of entering', guardrail: 'Discount cost as a share of won-back revenue', runFor: testLine('o3', 'About 10 weeks'), tool: 'Klaviyo random-sample filter' },
      tracking: {
        baseline: [
          { metric: 'Lapsed customers who come back on their own (90 days)', value: F('shopify.get_cohorts.organic_reactivation_rate'), ref: x.RID('shopify.get_cohorts.organic_reactivation_rate') },
          { metric: 'Customers lapsing per month', value: V('shopify.get_cohorts.newly_lapsed_per_month').toLocaleString('en-US'), ref: x.RID('shopify.get_cohorts.newly_lapsed_per_month') },
          { metric: 'Decaf days of cover', value: F('shopify.get_inventory_levels.decaf_days_cover'), ref: x.RID('shopify.get_inventory_levels.decaf_days_cover') },
        ],
        watch: ['Reactivation rate, flow vs holdout', 'Share of reactivations that start a subscription', 'Decaf stock level'],
        compare: 'Early read at 30 days, final at 90. Keep it if reactivation is at least 1.5 points higher than the holdout.',
        events: ['Klaviyo: Placed Order after flow entry', 'Skio: "Skio: New Subscription Created"', 'Skio: "Skio: Winback Redeemed"'],
      },
      walkthrough: [
        { title: 'Create the winback flow', where: 'Klaviyo → Flows → Create → Winback', minutes: 10, do: ['Trigger: 60 days since last Placed Order.', 'Filter: skio_hasActiveSubscription is false.', 'Add a random 50% filter for the holdout.'], assets: ['o3-flow'], why: 'The holdout tells you how many would have come back anyway.' },
        { title: 'Add the three emails', where: 'Same flow', minutes: 30, do: ['Paste each email.', 'Put the Quick Action link on the day-90 button.'], assets: ['o3-e1', 'o3-e2', 'o3-e3'], why: 'Story first, then the subscription, then a last call.' },
        ...(sms ? [{ title: 'Add the day-90 text', where: 'Postscript → Flows', minutes: 5, do: ['Paste the text and link.'], assets: ['o3-sms'], why: 'A second channel for the one ask that matters.' } as WalkStep] : []),
        { title: 'Turn on Skio Winbacks', where: 'Skio → Winbacks', minutes: 10, do: ['Target cancelled subscribers, 10% off.'], assets: ['o3-skio-winback'], why: 'Cancelled subscribers get their own tailored offer.' },
      ],
      buildLog: ['Building the 60/90/120 winback flow', 'Writing three winback emails', 'Creating Quick Action stack qa_winsub', ...(sms ? ['Writing the day-90 text'] : []), 'Setting up a 50% holdout', 'Configuring Skio Winbacks', 'Saving today\'s baseline'],
    }),
    // ---------------------------------------------------------------- o10
    o10: () => ({
      summary: 'Three days before each charge, subscribers get a "your coffee is coming" email and text with one-click skip, change and add-a-bag buttons.',
      plainCase: [
        `Subscribers get no heads-up before they're charged ${R('skio.get_notifications.upcoming_order_reminder')}, and ${F('skio.get_notifications.regret_cancels')} of cancels happen within two days of a charge ${R('skio.get_notifications.regret_cancels')}.`,
        `Only ${F('skio.get_portal_usage.addon_attach')} of subscription orders include an extra item ${R('skio.get_portal_usage.addon_attach')}; the average add-on is $${V('skio.get_portal_usage.addon_value')} ${R('skio.get_portal_usage.addon_value')}.`,
        `Skio already sends Klaviyo the "Billing Reminder Notification" event before every charge. Nothing uses it yet.`,
      ],
      comms: `A Klaviyo flow on "Skio: Billing Reminder Notification" with Quick Action buttons${sms ? ', plus a Postscript text where subscribers can reply SKIP' : ''}.`,
      assets: [
        { kind: 'config', id: 'o10-reminder', name: 'Billing reminder timing', platform: 'Skio', where: 'Skio → Settings → Notifications → Billing reminder', settings: [
          { label: 'Send', value: '3 days before each billing date' },
          { label: 'Channel', value: 'Klaviyo event "Skio: Billing Reminder Notification"' },
        ] },
        { kind: 'flow', id: 'o10-flow', name: 'Upcoming order', platform: 'Klaviyo', trigger: '"Skio: Billing Reminder Notification"', filters: ['skio_hasActiveSubscription is true'], steps: [
          { kind: 'split', label: 'A/B: 50% get add-on buttons, 50% get skip/change only' },
          { kind: 'email', label: '3 days before · "Your coffee ships Thursday"' },
          ...(sms ? [{ kind: 'sms' as const, label: 'Same day · Postscript "reply SKIP"' }] : []),
          { kind: 'exit', label: 'Exit' },
        ] },
        { kind: 'email', id: 'o10-email', name: 'Your coffee ships soon', platform: 'Klaviyo', timing: '3 days before each charge', from: FROM,
          subject: 'Your coffee ships {{ event.nextBillingDate|date:"l" }}', preview: 'Need to skip, change, or add a bag? One tap.', blocks: [
            { type: 'hero', art: 'box', text: 'Roasting your order this week' },
            { type: 'heading', text: `${FIRST}, your next delivery is on its way soon` },
            { type: 'products', items: [{ name: '2 × House Blend 12oz', price: '$34.00', note: 'every 4 weeks' }] },
            { type: 'button', text: 'Add a bag of Ethiopia Guji (+$17.10)', href: qa('qa_addguji'), note: 'Skio Quick Action · Add one-time upsell' },
            { type: 'button', text: 'Skip this delivery', href: qa('qa_skip'), note: 'Skio Quick Action · Skip' },
            { type: 'button', text: 'Every 6 weeks instead', href: qa('qa_every6'), note: 'Skio Quick Action · Change interval' },
            { type: 'text', text: 'Too much coffee piling up? Skipping takes one tap and you won\'t be charged.' },
            footer(),
          ] },
        ...(sms ? [{ kind: 'sms' as const, id: 'o10-sms', name: 'Reply SKIP', platform: 'Postscript' as const, timing: '3 days before each charge',
          body: `Bramble & Bean: House Blend ships Thu ($34). Too much? Reply SKIP to skip it. Add Guji: ${site}/qa/add ${smsFooter}` }] : []),
      ],
      test: { name: 'Add-on buttons in the reminder', split: 'Klaviyo split 50/50: with add-on button vs skip/change only', metric: 'Subscription orders with an add-on', guardrail: 'Skips per order (a skip is fine; a cancel is not)', runFor: testLine('o10', 'About 3 weeks'), tool: 'Klaviyo A/B split' },
      tracking: {
        baseline: [
          { metric: 'Orders with an add-on', value: F('skio.get_portal_usage.addon_attach'), ref: x.RID('skio.get_portal_usage.addon_attach') },
          { metric: 'Cancels within 48 h of a charge', value: F('skio.get_notifications.regret_cancels'), ref: x.RID('skio.get_notifications.regret_cancels') },
          { metric: 'Subscription orders per month', value: V('skio.get_subscription_summary.orders_per_month').toLocaleString('en-US'), ref: x.RID('skio.get_subscription_summary.orders_per_month') },
        ],
        watch: ['Add-on attach rate by group', 'Skips vs cancels after the reminder', 'Refund requests after charges'],
        compare: 'Keep the add-on button if attach rises to 6% or more and cancels right after a charge fall.',
        events: ['Skio: "Skio: Billing Reminder Notification"', 'Skio: Quick Action completed (qa_addguji, qa_skip, qa_every6)', 'Skio: "Skio: Subscription Skipped"'],
      },
      walkthrough: [
        { title: 'Set the reminder timing', where: 'Skio → Settings → Notifications', minutes: 3, do: ['Send the billing reminder 3 days before each charge.'], assets: ['o10-reminder'], why: 'Three days is enough time to skip before roasting starts.' },
        { title: 'Make the buttons', where: 'Skio → Quick Actions', minutes: 10, do: ['Create stacks: Add one-time upsell (Guji), Skip, Change interval (6 weeks).', 'Link type: Klaviyo · Flow.'], why: 'Each button does one thing, with no login.' },
        { title: 'Build the flow', where: 'Klaviyo → Flows → Create', minutes: 20, do: ['Trigger: "Skio: Billing Reminder Notification".', 'Add a 50/50 split.', 'Paste the email; keep the add-on button only in one branch.'], assets: ['o10-flow', 'o10-email'], why: 'The split shows how much the add-on button earns.' },
        ...(sms ? [{ title: 'Add the text', where: 'Postscript → Flows', minutes: 5, do: ['Paste the text. Skio reads SKIP replies and skips the order.'], assets: ['o10-sms'], why: 'The easiest possible skip: reply one word.' } as WalkStep] : []),
      ],
      buildLog: ['Setting the Skio billing reminder to 3 days', 'Creating Quick Action stacks: add Guji, skip, every 6 weeks', 'Writing the "your coffee ships soon" email', ...(sms ? ['Writing the reply-SKIP text'] : []), 'Adding a 50/50 split', 'Saving today\'s baseline'],
    }),
    // ---------------------------------------------------------------- o4
    o4: () => ({
      summary: 'Every TikTok Shop order ships with a "make it a subscription" card, and buyers flow into Klaviyo so they get your post-purchase emails.',
      plainCase: [
        `TikTok Shop sells ${F('tiktokshop.get_shop_performance.gmv')} ${R('tiktokshop.get_shop_performance.gmv')} to ${V('tiktokshop.get_shop_performance.first_time_buyers')} new buyers a month ${R('tiktokshop.get_shop_performance.first_time_buyers')}, and none of them subscribe ${R('tiktokshop.get_shop_performance.sub_conversion')}.`,
        `They never hear from you again: TikTok Shop isn't connected to Klaviyo ${R('shopify.get_installed_apps.tiktokshop_klaviyo_sync')}.`,
        'A printed card costs a few cents and reaches every buyer.',
      ],
      comms: 'An insert card with a QR code, and once synced, the same day-10 Klaviyo email as your own-site buyers with a TikTok-specific first line.',
      assets: [
        { kind: 'print', id: 'o4-card', name: 'Insert card (A6)', platform: 'TikTok Shop', front: 'Loved it? Never run out. Scan to get this coffee every 4 weeks, 10% off, skip anytime.', back: 'Roasted to order in small batches · brambleandbean.example/tiktok · Your code: TIKTOK10' },
        { kind: 'config', id: 'o4-sync', name: 'TikTok Shop → Klaviyo', platform: 'Klaviyo', where: 'Klaviyo → Integrations → TikTok Shop', settings: [{ label: 'Sync buyers', value: 'On (buyers with an email on the order)' }, { label: 'Add to flow', value: 'Post-Purchase: Thank you, with source = TikTok Shop' }] },
      ],
      test: { name: 'Insert card', split: 'Alternate weeks: card on odd weeks, no card on even weeks', metric: 'TikTok Shop buyers who subscribe within 60 days', guardrail: 'Card cost per subscription', runFor: testLine('o4', 'About 8 weeks'), tool: 'Packing process' },
      tracking: { baseline: [{ metric: 'TikTok Shop buyers who subscribe', value: F('tiktokshop.get_shop_performance.sub_conversion'), ref: x.RID('tiktokshop.get_shop_performance.sub_conversion') }], watch: ['QR scans (UTM source=tiktok-card)', 'Subscriptions with code TIKTOK10'], compare: 'Card weeks vs no-card weeks.', events: ['Shopify: orders with discount TIKTOK10', 'Skio: "Skio: New Subscription Created"'] },
      walkthrough: [
        { title: 'Print the card', where: 'Your printer', minutes: 20, do: ['Use the front and back copy.', 'Point the QR at /tiktok.'], assets: ['o4-card'], why: 'The card is the only way to reach these buyers today.' },
        { title: 'Sync buyers to Klaviyo', where: 'Klaviyo → Integrations', minutes: 10, do: ['Connect TikTok Shop.'], assets: ['o4-sync'], why: 'So they get the same follow-up as your own-site customers.' },
      ],
      buildLog: ['Writing the insert card', 'Connecting TikTok Shop to Klaviyo', 'Adding TikTok buyers to the post-purchase flow', 'Saving today\'s baseline'],
    }),
    // ---------------------------------------------------------------- o5
    o5: () => ({
      summary: 'Move a quarter of prospecting spend to an ad set optimised for subscription starts, with three new subscription-led ads.',
      plainCase: [
        `Meta brings ${V('meta.get_account_performance.new_customers_per_month')} new customers a month ${R('meta.get_account_performance.new_customers_per_month')} at $${V('meta.get_account_performance.cac')} each ${R('meta.get_account_performance.cac')}, but only ${F('meta.get_account_performance.new_customer_sub_rate')} subscribe ${R('meta.get_account_performance.new_customer_sub_rate')}.`,
        `Only ${F('meta.get_top_creatives.sub_creative_share')} of spend goes to ads that mention subscribing ${R('meta.get_top_creatives.sub_creative_share')}.`,
        'This moves money, it doesn\'t add any.',
      ],
      comms: 'The new ads land on the subscription-first product page (#1 on this plan), so the ad and the page make the same promise.',
      assets: [
        { kind: 'ad', id: 'o5-ad1', name: 'Never run out', platform: 'Meta Ads', format: '9:16 video, 15 s', primary: 'Fresh-roasted coffee that shows up before you run out. Subscribe, save 10% on every bag, skip anytime.', headline: 'Never run out of good coffee', cta: 'Shop now', visual: 'Kitchen counter, bag nearly empty, doorbell, new bag arrives' },
        { kind: 'ad', id: 'o5-ad2', name: 'Roasted yesterday', platform: 'Meta Ads', format: '1:1 image', primary: '4.7★ from 1,240 reviews. "Always tastes like it was roasted yesterday." Subscribe & save 10%.', headline: 'Roasted to order, every 4 weeks', cta: 'Subscribe', visual: 'Roast date stamp close-up' },
        { kind: 'ad', id: 'o5-ad3', name: 'Your schedule', platform: 'Meta Ads', format: 'Carousel', primary: 'Every 2, 4 or 6 weeks. Skip with one tap. Your coffee, your schedule.', headline: 'Coffee on your schedule', cta: 'Learn more', visual: 'Three cards: 2 / 4 / 6 weeks' },
        { kind: 'config', id: 'o5-event', name: 'Subscription-start conversion', platform: 'Meta Ads', where: 'Events Manager → Custom conversions', settings: [{ label: 'Rule', value: 'Purchase where order contains a subscription (selling plan)' }, { label: 'New ad set', value: `$11k/mo moved from ${F('meta.get_account_performance.prospecting_spend')} prospecting, optimised for this conversion` }] },
      ],
      test: { name: 'Sub-start ad set', split: 'Two ad sets, budget split 50/50 within the moved $11k', metric: 'Cost per subscription start', guardrail: 'Blended CAC', runFor: testLine('o5', 'About 11 weeks'), tool: 'Meta Ads Manager' },
      tracking: { baseline: [{ metric: 'Meta buyers who subscribe', value: F('meta.get_account_performance.new_customer_sub_rate'), ref: x.RID('meta.get_account_performance.new_customer_sub_rate') }, { metric: 'Meta CAC', value: `$${V('meta.get_account_performance.cac')}`, ref: x.RID('meta.get_account_performance.cac') }], watch: ['Cost per subscription start by ad set', 'Blended CAC'], compare: 'Move more budget if cost per subscription start falls 20% with CAC up less than 10%.', events: ['Meta: custom conversion "Subscription started"', 'Skio: "Skio: New Subscription Created"'] },
      walkthrough: [
        { title: 'Create the conversion', where: 'Meta Events Manager', minutes: 10, do: ['Add a custom conversion for subscription purchases.'], assets: ['o5-event'], why: 'Meta finds more of whatever you tell it to count.' },
        { title: 'Launch three ads', where: 'Ads Manager', minutes: 30, do: ['Duplicate the best prospecting ad set.', 'Optimise it for the new conversion.', 'Add the three ads.'], assets: ['o5-ad1', 'o5-ad2', 'o5-ad3'], why: 'Ads that sell the subscription attract people who want one.' },
      ],
      buildLog: ['Defining the subscription-start conversion', 'Writing three subscription-led ads', 'Planning the $11k budget move', 'Saving today\'s baseline'],
    }),
    // ---------------------------------------------------------------- o6
    o6: () => ({
      summary: 'A one-email browse-abandonment flow that shows the product with its subscription price.',
      plainCase: [`${V('klaviyo.get_list_health.identified_browsers_per_month').toLocaleString('en-US')} known visitors a month look at a product and leave ${R('klaviyo.get_list_health.identified_browsers_per_month')}, and nothing follows up.`],
      comms: 'One Klaviyo email at 4 hours; no SMS (it would feel pushy for a browse).',
      assets: [
        { kind: 'email', id: 'o6-email', name: 'Still thinking about it?', platform: 'Klaviyo', timing: '4 hours after viewing a product', from: FROM, subject: 'Still thinking about {{ event.ProductName }}?', preview: 'Here\'s what subscribers say.', blocks: [
          { type: 'hero', art: 'bag', text: '{{ event.ProductName }}' },
          { type: 'text', text: `${FIRST}, good choice. On a subscription it's 10% less and it arrives before you run out.` },
          { type: 'button', text: 'Take another look', href: '{{ event.URL }}?selling_plan=every-4-weeks' },
          footer(),
        ] },
      ],
      test: { name: 'Browse abandonment', split: '80/20 holdout', metric: 'Orders within 7 days of browsing', guardrail: 'Unsubscribes', runFor: 'About 2 weeks', tool: 'Klaviyo' },
      tracking: { baseline: [{ metric: 'Identified browsers per month', value: V('klaviyo.get_list_health.identified_browsers_per_month').toLocaleString('en-US'), ref: x.RID('klaviyo.get_list_health.identified_browsers_per_month') }], watch: ['Orders from the flow vs holdout'], compare: 'Keep if at least 1% order within 7 days.', events: ['Klaviyo: Viewed Product'] },
      walkthrough: [{ title: 'Clone the template', where: 'Klaviyo → Flows → Browse abandonment', minutes: 15, do: ['Use one email at 4 hours; paste the copy.'], assets: ['o6-email'], why: 'Quick to set up, low risk.' }],
      buildLog: ['Creating the browse-abandonment flow', 'Writing the email', 'Adding a 20% holdout'],
    }),
    // ---------------------------------------------------------------- o7
    o7: () => ({
      summary: 'Retry failed payments at smarter times and text a one-click "update your card" link on the first failure.',
      plainCase: [`${V('skio.get_dunning_performance.failed_per_month')} payments fail every month ${R('skio.get_dunning_performance.failed_per_month')}; ${F('skio.get_dunning_performance.recovery_rate')} are recovered ${R('skio.get_dunning_performance.recovery_rate')}.`, 'These are customers who didn\'t choose to leave.'],
      comms: `A Klaviyo flow on "Skio: Billing Attempt Failed" with a "Change subscription credit card" Quick Action${sms ? ', plus a Postscript text' : ''}.`,
      assets: [
        { kind: 'config', id: 'o7-retry', name: 'Payment Recovery', platform: 'Skio', where: 'Skio → Payment Recovery', settings: [{ label: 'Retry phases', value: 'Day 1, 3, 7 and 14 (was 2 attempts in 5 days)' }, { label: 'Smart Retries', value: 'On (business hours, 1st/15th of the month)' }] },
        { kind: 'email', id: 'o7-email', name: 'Your card didn\'t go through', platform: 'Klaviyo', timing: 'On "Skio: Billing Attempt Failed"', from: FROM, subject: 'Quick one: your card didn\'t go through', preview: 'Update it in 20 seconds so your coffee ships.', blocks: [
          { type: 'text', text: `${FIRST}, we tried to charge your card for your next coffee and it didn't go through. It happens. Update it here and we'll ship right away.` },
          { type: 'button', text: 'Update my card', href: qa('qa_card'), note: 'Skio Quick Action · Change subscription credit card' },
          footer(),
        ] },
        ...(sms ? [{ kind: 'sms' as const, id: 'o7-sms', name: 'Card update text', platform: 'Postscript' as const, timing: 'Day 1 of dunning', body: `Bramble & Bean: your card didn't go through for your coffee. Update it in 20 seconds: ${site}/qa/card ${smsFooter}` }] : []),
      ],
      test: { name: 'Smarter recovery', split: 'Before vs after, 8 weeks each (volume is too low to split)', metric: 'Dunning recovery rate (Skio Dunning analytics)', guardrail: 'Complaints', runFor: 'About 8 weeks', tool: 'Skio Payment Recovery' },
      tracking: { baseline: [{ metric: 'Dunning recovery', value: F('skio.get_dunning_performance.recovery_rate'), ref: x.RID('skio.get_dunning_performance.recovery_rate') }], watch: ['Recovered vs churned (Skio Dunning analytics)'], compare: 'Keep if recovery reaches 53% or more.', events: ['Skio: "Skio: Billing Attempt Failed"'] },
      walkthrough: [{ title: 'Change the retry schedule', where: 'Skio → Payment Recovery', minutes: 10, do: ['Set the four retry phases and turn on Smart Retries.'], assets: ['o7-retry'], why: 'Cards often work on payday.' }, { title: 'Add the card-update message', where: 'Klaviyo → Flows', minutes: 15, do: ['Trigger on "Skio: Billing Attempt Failed" and paste the email.'], assets: ['o7-email', ...(sms ? ['o7-sms'] : [])], why: 'One tap fixes it.' }],
      buildLog: ['Updating Skio Payment Recovery phases', 'Turning on Smart Retries', 'Creating Quick Action stack qa_card', 'Writing the card-update email', 'Saving today\'s baseline'],
    }),
  };

  return ranked
    .filter((o) => P[o.id])
    .map((o) => ({ opportunityId: o.id, title: o.title, ...P[o.id]() }));
}

export type { BuildAsset, SmsAsset };
