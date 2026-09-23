/**
 * V2 (Merchant Growth Planner) data contracts: the Run Brief the merchant builds in
 * Ask → Clarify → Connect, the store-data ledger that backs every [dN] citation,
 * and the audit → opportunity → priority → plan → test shapes the run emits.
 * See research-crew-v2-build-spec.md §5.
 */

export type SourceId = 'shopify' | 'klaviyo' | 'sms' | 'meta' | 'tiktok' | 'tiktokshop' | 'skio';

export const SOURCE_IDS: readonly SourceId[] = ['shopify', 'klaviyo', 'sms', 'meta', 'tiktok', 'tiktokshop', 'skio'];

export interface RunBrief {
  question: string;
  goal: string | null;
  timeframe: string | null;
  competitors: string[];
  capacity: string | null;
  constraints: string[];
  /** "Type your own" answers, keyed by question id. */
  freeText: Record<string, string>;
  sources: Record<SourceId, boolean>;
  store: string;
}

export interface IntakeOption {
  id: string;
  label: string;
  /** One line under the chip saying why it's suggested, from store data. */
  why?: string;
  /** Which connected source the `why` comes from. */
  whySource?: SourceId;
  suggested?: boolean;
}

export interface IntakeQuestion {
  id: 'goal' | 'timeframe' | 'competitors' | 'capacity' | 'constraints';
  text: string;
  select: 'single' | 'multi';
  options: IntakeOption[];
  allowOther: boolean;
}

export interface LedgerEntry {
  id: string;
  source: SourceId;
  /** Tool as the agent saw it, e.g. "shopify.get_repurchase_rates". */
  tool: string;
  args: Record<string, string>;
  field: string;
  value: number;
  unit: string;
  window?: string;
  label: string;
  asOf: string;
  demo: true;
}

export type Severity = 'high' | 'med' | 'low';

export interface AuditFinding {
  /** Carries [dN] markers inline. */
  claim: string;
  dataRefs: string[];
  severity: Severity;
  area: string;
  /** Positive findings are "what's working", not problems. */
  positive?: boolean;
}

export interface StatTile {
  label: string;
  display: string;
  dataRef: string;
}

export interface AuditSection {
  area: string;
  agentId: string;
  source: SourceId[];
  headline: string;
  tiles: StatTile[];
  findings: AuditFinding[];
}

export interface FlowStatus {
  id: string;
  name: string;
  status: 'live' | 'warn' | 'missing';
  note: string;
  dataRef?: string;
}

export interface QuarterRow {
  quarter: string;
  best: string;
  bestNote: string;
  bestRef?: string;
  worst: string;
  worstNote: string;
  worstRef?: string;
}

export interface SourceContradiction {
  topic: string;
  first: { source: SourceId; claim: string };
  second: { source: SourceId; claim: string };
  resolution: string;
}

export interface StoreProfile {
  name: string;
  domain: string;
  category: string;
  market: string;
  asOf: string;
  demo: true;
  headline: string;
  tiles: StatTile[];
  sections: AuditSection[];
  flows: FlowStatus[] | null;
  quarters: QuarterRow[];
  contradictions: SourceContradiction[];
  researchQuestions: string[];
  missing: string[];
}

export type Confidence = 'H' | 'M' | 'L';
export type Effort = 'S' | 'M' | 'L';

export interface Input {
  value: number;
  display: string;
  ref?: string;
  note?: string;
}

export interface Opportunity {
  id: string;
  title: string;
  area: string;
  goals: string[];
  audience: Input;
  currentRate: Input;
  targetRate: Input;
  valuePerConversion: Input;
  rationale: string;
  citeRefs: string[];
  dataRefs: string[];
  confidence: Confidence;
  confidenceWhy: string;
  effort: Effort;
  effortWhy: string;
  requires: SourceId[];
  overlapNote?: string;
}

export interface ScoredOpportunity extends Opportunity {
  rank: number | null;
  annualImpact: number;
  /** The impact sum written out, e.g. "3,100 × 3 pts × $292 × 12". */
  maths: string;
  score: number;
  timeToSignalWeeks: number | null;
  goalFit: boolean;
  /** Set when a needed source is toggled off. */
  locked?: { missing: SourceId[]; message: string };
  /** Set when a merchant constraint rules it out. */
  excluded?: { constraint: string; message: string };
}

export interface Initiative {
  opportunityId: string;
  rank: number;
  title: string;
  why: string;
  steps: string[];
  owner: string;
  tools: string[];
  dependencies: string[];
  success: { metric: string; target: string; by: string };
}

export interface RoadmapItem {
  title: string;
  opportunityId?: string;
  kind: 'build' | 'test' | 'readout' | 'enabler';
}

export interface Roadmap {
  capacityNote: string;
  days30: RoadmapItem[];
  days60: RoadmapItem[];
  days90: RoadmapItem[];
  later: RoadmapItem[];
}

export interface TestPlan {
  opportunityId: string;
  rank: number;
  title: string;
  hypothesis: string;
  design: string;
  primaryMetric: string;
  guardrails: string[];
  baseline: number;
  target: number;
  nPerArm: number;
  eligiblePerMonth: number;
  eligibleNote: string;
  weeksToEnrol: number;
  readoutLagWeeks: number;
  totalWeeks: number;
  decisionRule: string;
  proxy?: string;
}

export interface FeasibilityCheck {
  name: string;
  baseline: number;
  target: number;
  nPerArm: number;
  available: number;
  availableLabel: string;
  feasible: boolean;
  instead: string;
}

export type DataVerdict = 'recomputed' | 'mismatch';

export interface ReportCounts {
  web: { supported: number; unsupported: number; contradicted: number };
  data: { recomputed: number; mismatch: number };
}
