/**
 * Quick review: every ranked move as a "profile" with 2–3 versions to choose between.
 * A version's yearly value scales the move's own impact by how much of the lift that
 * version is expected to capture, so the numbers stay tied to the same maths.
 */

import type { ScoredOpportunity } from '../v2/types.js';
import type { Ctx } from './ctx.js';
import type { ReviewCard, ReviewOption } from './types.js';

type Opt = Omit<ReviewOption, 'impact'> & { share: number };

export function buildReviewDeck(x: Ctx, ranked: ScoredOpportunity[]): ReviewCard[] {
  const { F, V, has } = x;
  const OPTIONS: Record<string, { bio: string; options: Opt[] }> = {
    o8: {
      bio: 'Your product page already sells subscriptions on a laptop. This makes the phone version do the same.',
      options: [
        { id: 'default', label: 'Subscribe & save preselected', share: 1, effort: 'S', recommended: true,
          pitch: 'Subscription is picked by default and priced up front; one-time is right under it.',
          pros: ['Biggest lift', 'Same setup on every product'], cons: ['A few shoppers may feel nudged'],
          bestIf: 'You want the most subscriptions and are happy for one-time to be the second choice.' },
        { id: 'side-by-side', label: 'Side-by-side, subscription highlighted', share: 0.7, effort: 'S',
          pitch: 'Both options shown as equal cards, with subscription marked "Most popular · save 10%".',
          pros: ['Feels like a fair choice', 'Still moves it above the fold'], cons: ['Smaller lift than a default'],
          bestIf: 'Your brand is careful about feeling pushy.' },
        { id: 'hero-only', label: 'Start with your 3 best sellers', share: 0.5, effort: 'S',
          pitch: 'Default to subscription only on House Blend, Guji and Decaf first, then roll out.',
          pros: ['Lowest risk', 'Quick read on the effect'], cons: ['Only part of the upside to start'],
          bestIf: 'You want to see it work on a few products before changing them all.' },
      ],
    },
    o1: {
      bio: 'New customers are most likely to subscribe right after buying and when their bag runs low. Nobody asks them today.',
      options: [
        { id: 'full', label: 'Thank-you page + day-10 email + text', share: 1, effort: 'S', recommended: true, needs: ['sms'],
          pitch: 'Skio Post-purchase upsell on the thank-you page, then a "running low?" email on day 10 and a text on day 12.',
          pros: ['Asks at both best moments', 'One-click Quick Action link'], cons: ['Three pieces to set up'],
          bestIf: 'You want the full effect and can spend an afternoon on setup.' },
        { id: 'email-only', label: 'Day-10 email only', share: 0.6, effort: 'S',
          pitch: 'Just add the "running low?" email with the one-click subscribe button.',
          pros: ['About 20 minutes of work', 'Nothing changes at checkout'], cons: ['Misses the thank-you moment'],
          bestIf: 'You want the quickest possible start.' },
        { id: 'thanks-only', label: 'Thank-you page offer only', share: 0.5, effort: 'S',
          pitch: 'Only turn on Skio\'s Post-purchase upsell, so the order someone just placed can become a subscription in one tap.',
          pros: ['Five minutes in Skio', 'No emails to write'], cons: ['One chance only, no follow-up'],
          bestIf: 'Your email calendar is already full.' },
      ],
    },
    o2: {
      bio: `A third of cancels are "too much coffee" (${F('skio.get_cancel_reasons.reason_too_much')}). They like you, they just need less.`,
      options: [
        { id: 'flex', label: 'Flexibility first', share: 1, effort: 'S', recommended: true,
          pitch: 'Offer fewer bags, a slower schedule and a skip before any discount; A/B test it against today\'s flow.',
          pros: ['Fixes the actual reason', 'Skio runs the A/B test for you'], cons: ['Some people take the slower plan'],
          bestIf: 'You want to keep people without training them to expect discounts.' },
        { id: 'skip-gift', label: 'Skip first, then a free gift', share: 0.85, effort: 'S',
          pitch: 'Lead with "Skip my next delivery"; anyone who still wants to leave is offered a free sampler with their next order.',
          pros: ['Simple, one clear offer', 'A gift feels generous'], cons: ['Costs a sampler per save'],
          bestIf: 'You like the idea of surprising people who stay.' },
        { id: 'pause', label: 'Pause for 1–3 months', share: 0.7, effort: 'S',
          pitch: 'Offer a pause as the main answer to "too much coffee".',
          pros: ['Easy to understand'], cons: ['Paused subscribers bring no revenue while paused', 'Some never come back'],
          bestIf: 'Your customers tend to go away for long stretches.' },
      ],
    },
    o9: {
      bio: 'People who email to cancel are asking for help as much as for an exit. Right now support just cancels.',
      options: [
        { id: 'offer-first', label: 'Save-first reply with one-tap links', share: 1, effort: 'S', recommended: true,
          pitch: 'A Gorgias macro offers skip, every 8 weeks or pause as one-tap Skio Quick Action links, and still cancels if they ask again.',
          pros: ['Customers fix it themselves', 'Same answer from every agent'], cons: ['One extra message before a cancel'],
          bestIf: 'You want to save more without adding agent time.' },
        { id: 'do-it', label: 'Agents do it for them', share: 0.8, effort: 'S',
          pitch: 'Agents use the Skio sidebar to skip or slow the subscription themselves, then confirm.',
          pros: ['Very personal', 'No links to click'], cons: ['More agent time per ticket'],
          bestIf: 'Your support team loves a personal touch and has time.' },
        { id: 'auto', label: 'Automatic first reply', share: 0.6, effort: 'S',
          pitch: 'A Gorgias rule auto-replies to cancel requests with the self-serve links before an agent picks it up.',
          pros: ['Zero agent time', 'Instant'], cons: ['Less personal', 'Lower save rate'],
          bestIf: 'Your team is stretched thin.' },
      ],
    },
    o3: {
      bio: `${Math.round(V('shopify.get_cohorts.lapsed_customers') / 1000)}k past customers haven't ordered in four months, and nothing invites them back.`,
      options: [
        { id: 'three', label: 'Three touches: story, subscription, last call', share: 1, effort: 'M', recommended: true,
          pitch: 'Day 60 "new roast", day 90 a one-click subscription offer, day 120 a free bag of Decaf.',
          pros: ['Uses overstocked Decaf instead of discounts', 'Leads with the subscription'], cons: ['Three emails to write'],
          bestIf: 'You want to win back as many as possible.' },
        { id: 'two', label: 'Two touches, subscription only', share: 0.8, effort: 'S',
          pitch: 'Skip the story email; go straight to the subscription offer, then a last call.',
          pros: ['Less to write', 'Quicker to launch'], cons: ['Less warm-up'],
          bestIf: 'You want it live this week.' },
        { id: 'sms-led', label: 'Text-led winback', share: 0.7, effort: 'S', needs: ['sms'],
          pitch: 'A Postscript text is the main touch, with one follow-up email.',
          pros: ['Texts get read'], cons: ['Only reaches SMS subscribers'],
          bestIf: 'Your SMS list is engaged.' },
      ],
    },
    o10: {
      bio: 'Subscribers get charged without warning, then cancel. A heads-up with one-tap buttons fixes both.',
      options: [
        { id: 'email-text', label: 'Email + text, with an add-a-bag button', share: 1, effort: 'S', recommended: true, needs: ['sms'],
          pitch: 'Three days before each charge: an email with Add, Skip and Change buttons, and a text where they can reply SKIP.',
          pros: ['Earns add-on revenue', 'Cuts cancels right after a charge'], cons: ['One more message a month'],
          bestIf: 'You want both more revenue and fewer surprise cancels.' },
        { id: 'churn', label: 'Email with skip and change only', share: 0.4, effort: 'S',
          pitch: 'A calm heads-up with Skip and Change buttons; no selling.',
          pros: ['Feels like pure service'], cons: ['No add-on revenue'],
          bestIf: 'Keeping subscribers happy matters more than extra revenue right now.' },
        { id: 'text-first', label: 'Text first: reply SKIP or ADD', share: 0.8, effort: 'S', needs: ['sms'],
          pitch: 'The main reminder is a Postscript text; Skio reads SKIP replies and skips the order.',
          pros: ['Fastest for customers'], cons: ['Only SMS subscribers get it'],
          bestIf: 'Your subscribers live in their texts.' },
      ],
    },
    o4: {
      bio: `TikTok Shop sells ${F('tiktokshop.get_shop_performance.gmv')} and none of those buyers ever hear from you again.`,
      options: [
        { id: 'card-sync', label: 'Insert card + Klaviyo sync', share: 1, effort: 'M', recommended: true,
          pitch: 'A "make it a subscription" card in every order, and buyers flow into your post-purchase emails.',
          pros: ['Reaches every buyer twice'], cons: ['Printing and a sync to set up'],
          bestIf: 'TikTok Shop is a channel you want to grow.' },
        { id: 'card', label: 'Insert card only', share: 0.6, effort: 'S',
          pitch: 'Just the printed card with a QR code and a code.',
          pros: ['No tech work'], cons: ['One chance to convert'],
          bestIf: 'You want to try it for a few cents an order.' },
      ],
    },
    o5: {
      bio: 'Meta finds lots of new customers, but mostly one-time buyers who never pay back what they cost.',
      options: [
        { id: 'shift', label: 'Move $11k to a subscription ad set', share: 1, effort: 'M', recommended: true,
          pitch: 'A new ad set optimised for subscription starts, with three subscription-led ads. Same total budget.',
          pros: ['Changes who Meta finds'], cons: ['A few weeks of learning'],
          bestIf: 'You want paid growth that pays back.' },
        { id: 'creative', label: 'New subscription ads only', share: 0.5, effort: 'S',
          pitch: 'Swap in three subscription-led ads; keep today\'s optimisation.',
          pros: ['Quick to launch'], cons: ['Meta still hunts for any purchase'],
          bestIf: 'Your agency needs a small first step.' },
        { id: 'retarget', label: 'Subscription ads for retargeting', share: 0.4, effort: 'S',
          pitch: 'Show subscription ads only to past visitors and one-time buyers.',
          pros: ['Small, safe budget'], cons: ['Smallest upside'],
          bestIf: 'You don\'t want to touch prospecting yet.' },
      ],
    },
    o6: {
      bio: 'Thousands of known visitors look at a product and leave each month. One gentle email brings some back.',
      options: [
        { id: 'email', label: 'One email at 4 hours', share: 1, effort: 'S', recommended: true,
          pitch: 'Shows the product they looked at with its subscription price.',
          pros: ['Low effort', 'Not pushy'], cons: ['Modest upside'], bestIf: 'You want a quick, safe win.' },
        { id: 'two', label: 'Two emails (4 hours and 2 days)', share: 1.2, effort: 'S',
          pitch: 'Adds a second reminder with a subscriber review.',
          pros: ['A bit more upside'], cons: ['More emails in the inbox'], bestIf: 'Your list is used to hearing from you.' },
      ],
    },
    o7: {
      bio: 'Some subscribers leave only because their card failed. Smarter retries and a one-tap card update keep them.',
      options: [
        { id: 'full', label: 'Smart Retries + email and text', share: 1, effort: 'S', recommended: true,
          pitch: 'Skio Payment Recovery retries on paydays, and a card-update Quick Action goes out by email and text.',
          pros: ['Recovers people who never chose to leave'], cons: ['A little setup in two tools'], bestIf: 'You want every save you can get.' },
        { id: 'retries', label: 'Smarter retries only', share: 0.6, effort: 'S',
          pitch: 'Just change the retry schedule in Skio and turn on Smart Retries.',
          pros: ['Ten minutes'], cons: ['No nudge to update the card'], bestIf: 'You want the fastest fix.' },
      ],
    },
  };

  const goal = x.brief.goal;
  const cards: ReviewCard[] = [];
  for (const o of ranked) {
    const def = OPTIONS[o.id];
    if (!def) continue;
    const why: string[] = [];
    let match = 55;
    if (goal && o.goals.includes(goal)) { match += 20; why.push('Fits the goal you picked'); }
    match += { H: 12, M: 7, L: 0 }[o.confidence];
    why.push({ H: 'High confidence: it\'s your own data', M: 'Solid evidence behind it', L: 'Some uncertainty, so test it small' }[o.confidence]);
    match += { S: 10, M: 4, L: 0 }[o.effort];
    if (o.effort === 'S') why.push('Small effort for your team');
    if (x.brief.capacity === 'solo' && o.effort !== 'S') { match -= 6; why.push('A bigger lift for a team of one'); }
    if (x.isQ4 && ['Storefront', 'Email & SMS'].includes(o.area)) { match += 4; why.push('Can be live before Black Friday'); }
    if (o.rank) match += Math.max(0, 6 - o.rank);
    cards.push({
      opportunityId: o.id,
      bio: def.bio,
      match: Math.max(40, Math.min(98, match)),
      matchWhy: why,
      options: withRecommendation(def.options.map(({ share, needs, ...opt }) => {
        // `needs` on the card lists only the sources that are switched off for this run.
        const missing = (needs ?? []).filter((n) => !has(n as never));
        return { ...opt, impact: Math.round(o.annualImpact * share), recommended: !!opt.recommended && !missing.length, ...(missing.length ? { needs: missing } : {}) };
      })),
    });
  }
  return cards;
}

/** If the crew's pick needs a source that's off, recommend the first version that can be picked. */
function withRecommendation(options: ReviewOption[]): ReviewOption[] {
  if (options.some((o) => o.recommended)) return options;
  const i = options.findIndex((o) => !o.needs);
  return options.map((o, k) => (k === i ? { ...o, recommended: true } : o));
}
