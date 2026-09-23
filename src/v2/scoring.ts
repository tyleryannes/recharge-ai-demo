/**
 * The maths the merchant can follow (spec §4, §6.4). Models pick the inputs; code does
 * the multiplying, so scores and sample sizes are exact and the fact-checker has less
 * to catch.
 */

import type { Confidence, Effort } from './types.js';

export const CONFIDENCE_WEIGHT: Record<Confidence, number> = { H: 1, M: 0.7, L: 0.4 };
export const EFFORT_WEIGHT: Record<Effort, number> = { S: 1, M: 2, L: 4 };

/** Audience per month × (target − current) × value per conversion × 12. */
export function annualImpact(audiencePerMonth: number, currentRate: number, targetRate: number, valuePerConversion: number): number {
  return audiencePerMonth * (targetRate - currentRate) * valuePerConversion * 12;
}

/** RICE-style, in dollars: impact × confidence weight ÷ effort weight. */
export function score(impact: number, confidence: Confidence, effort: Effort): number {
  return (impact * CONFIDENCE_WEIGHT[confidence]) / EFFORT_WEIGHT[effort];
}

const Z_ALPHA = 1.96; // two-sided 95%
const Z_BETA = 0.84; // 80% power

/**
 * Per-arm sample size to tell two conversion rates apart:
 * n ≈ (1.96 + 0.84)² × [p₁(1−p₁) + p₂(1−p₂)] ÷ (p₂ − p₁)²
 */
export function sampleSizePerArm(p1: number, p2: number): number {
  const variance = p1 * (1 - p1) + p2 * (1 - p2);
  return Math.ceil(((Z_ALPHA + Z_BETA) ** 2 * variance) / (p2 - p1) ** 2);
}

/** Weeks to enrol both arms at a monthly flow of eligible people. */
export function weeksToEnrol(nPerArm: number, eligiblePerMonth: number): number {
  return (2 * nPerArm) / eligiblePerMonth * (52 / 12);
}

export function usd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `$${Math.round(n / 1000)}k`;
  if (abs >= 1_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function pct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits).replace(/\.0$/, '')}%`;
}

export function count(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** How a ledger value reads in prose and on a stat tile. */
export function formatValue(value: number, unit: string): string {
  switch (unit) {
    case 'usd':
      return value >= 10_000 ? usd(value) : `$${value.toLocaleString('en-US')}`;
    case 'usd_per_month':
      return `${usd(value)}/mo`;
    case 'ratio':
      return value < 0 ? `−${pct(-value, value > -0.1 ? 1 : 0)}` : pct(value, value < 0.1 && value > 0 ? 1 : 0);
    case 'count_per_month':
      return `${count(value)}/mo`;
    case 'days':
      return `${value} days`;
    case 'orders':
      return `${value} orders`;
    case 'bool':
      return value ? 'Yes' : 'No';
    case 'px':
      return `${count(value)} px`;
    case 'seconds':
      return `${value} s`;
    case 'hours':
      return `${value} h`;
    case 'score':
      return `${value}`;
    case 'x':
      return `${value}×`;
    default:
      return count(value);
  }
}
