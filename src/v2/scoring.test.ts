import { describe, expect, it } from 'vitest';
import { metric } from '../connectors/demo-tools.js';
import { annualImpact, sampleSizePerArm, score } from './scoring.js';

describe('scoring', () => {
  it('matches the spec worked example for the post-purchase offer (~$326k)', () => {
    const audience = metric('shopify', 'get_store_profile', 'first_time_buyers_per_month').value;
    const current = metric('shopify', 'get_cohorts', 'first_to_sub_60d').value;
    const value = metric('skio', 'get_ltv_comparison', 'sub_ltv').value - metric('skio', 'get_ltv_comparison', 'one_time_ltv').value;
    expect(audience).toBe(3100);
    expect(value).toBe(292);
    expect(Math.round(annualImpact(audience, current, 0.07, value) / 1000)).toBe(326);
  });

  it('weights confidence and effort', () => {
    expect(score(100_000, 'M', 'S')).toBeCloseTo(70_000);
    expect(score(100_000, 'H', 'M')).toBeCloseTo(50_000);
  });

  it('computes the spec sample sizes', () => {
    expect(sampleSizePerArm(0.06, 0.075)).toBeGreaterThan(4380);
    expect(sampleSizePerArm(0.06, 0.075)).toBeLessThan(4400);
    // Churn 7.8% → 6.8% needs more subscribers per arm than the store has in total.
    expect(sampleSizePerArm(0.078, 0.068)).toBeGreaterThan(metric('skio', 'get_subscription_summary', 'active_subscribers').value);
    // Cancel-flow save rate 12% → 18% is ~550 per arm.
    expect(Math.abs(sampleSizePerArm(0.12, 0.18) - 551)).toBeLessThanOrEqual(2);
  });

  it('keeps the fixture internally consistent', () => {
    // Subscription revenue share ≈ subscribers × order value × ~0.93 orders a month × 12.
    const subs = metric('skio', 'get_subscription_summary', 'active_subscribers').value;
    const aov = metric('skio', 'get_subscription_summary', 'sub_order_value').value;
    const revenue = metric('shopify', 'get_store_profile', 'revenue').value;
    const share = (subs * aov * 0.93 * 12) / revenue;
    expect(share).toBeCloseTo(metric('skio', 'get_subscription_summary', 'sub_revenue_share').value, 1);
    // Revenue ≈ orders × AOV.
    const orders = metric('shopify', 'get_store_profile', 'orders').value;
    expect(Math.abs(orders * 46 - revenue) / revenue).toBeLessThan(0.01);
  });
});
