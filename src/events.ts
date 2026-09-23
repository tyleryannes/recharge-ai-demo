/**
 * The event stream one research run produces. Every agent, search, thought and
 * verdict becomes an event here; the pipeline emits them, the JSONL sink stores
 * them, and the visualizer replays them — live or recorded — from the same shape.
 */

import type {
  AuditFinding,
  DataVerdict,
  FeasibilityCheck,
  Initiative,
  LedgerEntry,
  Opportunity,
  ReportCounts,
  Roadmap,
  RunBrief,
  ScoredOpportunity,
  SourceId,
  StoreProfile,
  TestPlan,
} from './v2/types.js';
import type { AnalyticsPack, AreaScore, BuildPackage, Journey, JourneyStep, ReviewCard, SubscriptionStrategy } from './v3/types.js';

export type StageId =
  | 'brief'
  | 'research'
  | 'assembly'
  | 'followup'
  | 'assembly-2'
  | 'factcheck'
  | 'report'
  // V2 (growth planner) stages
  | 'intake'
  | 'audit'
  | 'audit-assembly'
  | 'opportunities'
  | 'prioritise'
  | 'plan'
  // V3
  | 'journeys';

/** Left-to-right order of the pipeline map. */
export const STAGE_ORDER: readonly StageId[] = [
  'brief',
  'research',
  'assembly',
  'followup',
  'assembly-2',
  'factcheck',
  'report',
];

export const STAGE_LABELS: Record<StageId, string> = {
  brief: 'Brief',
  research: 'Research',
  assembly: 'Assembly',
  followup: 'Follow-up',
  'assembly-2': 'Assembly, second pass',
  factcheck: 'Fact-check',
  report: 'Report',
  intake: 'Brief',
  audit: 'Store audit',
  'audit-assembly': 'Store profile',
  opportunities: 'Opportunities',
  prioritise: 'Prioritise',
  plan: 'Plan',
  journeys: 'Shopper journeys',
};

/** V2 map order. Sent in run.started so the page stops hard-coding stages. */
export const V2_STAGE_ORDER: readonly StageId[] = [
  'intake',
  'audit',
  'journeys',
  'audit-assembly',
  'research',
  'opportunities',
  'followup',
  'prioritise',
  'plan',
  'factcheck',
  'report',
];

export interface AgentDescriptor {
  id: string;
  stage: StageId;
  /** Short name shown on the map, e.g. "Competitors". */
  label: string;
  /** One sentence, in plain words, of what this agent is doing. */
  task: string;
  /** Agents whose output this one waits for; drawn as edges on the map. */
  dependsOn: string[];
  /** Per-agent model, when the run mixes tiers (V2). */
  model?: string;
}

export interface SourceRef {
  title: string;
  url: string;
}

export interface Finding {
  /** V2: the web-claim id [cN] this finding is cited as. */
  id?: string;
  claim: string;
  evidence: string;
  sources: SourceRef[];
  confidence: 'high' | 'medium' | 'low';
}

export interface Contradiction {
  topic: string;
  first: { agent: string; claim: string };
  second: { agent: string; claim: string };
}

export interface Gap {
  question: string;
  why: string;
}

export interface Claim {
  id: string;
  text: string;
}

export type Verdict = 'supported' | 'unsupported' | 'contradicted' | DataVerdict;

export interface ClaimVerdict {
  id: string;
  verdict: Verdict;
  evidence: string;
  source_url: string | null;
  /** Data claims only: the draft's number was wrong and the final report uses the ledger value. */
  corrected?: boolean;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
}

export type RunEventBody =
  | {
      type: 'run.started';
      runId: string;
      brief: string;
      model: string;
      startedAt: string;
      // V2 only: the page draws whatever stages the backend sends.
      stages?: readonly StageId[];
      stageLabels?: Partial<Record<StageId, string>>;
      runBrief?: RunBrief;
      store?: { name: string; domain: string; demo: boolean };
      /** Demo playback compression; the clock runs this many times faster than the recorded run. */
      playback?: number;
    }
  | { type: 'run.completed'; durationMs: number; costUsd: number }
  | { type: 'run.failed'; error: string }
  /** Re-emitting for an existing id updates the descriptor (used to rewire edges). */
  | { type: 'agent.queued'; agent: AgentDescriptor }
  | { type: 'agent.started'; agentId: string }
  | { type: 'agent.thinking'; agentId: string; text: string }
  | { type: 'agent.text'; agentId: string; text: string }
  | { type: 'agent.search'; agentId: string; query: string }
  | { type: 'agent.search.results'; agentId: string; query: string; results: SourceRef[] }
  | { type: 'agent.fetch'; agentId: string; url: string }
  | { type: 'agent.completed'; agentId: string; durationMs: number; usage: AgentUsage }
  | { type: 'agent.failed'; agentId: string; error: string }
  | { type: 'findings'; agentId: string; headline: string; findings: Finding[] }
  | { type: 'assembly.result'; summary: string; contradictions: Contradiction[]; gaps: Gap[] }
  | { type: 'followup.answer'; agentId: string; question: string; answer: string; findings: Finding[] }
  /** V2 adds dataClaims: sentences carrying [dN] markers, which fact-check recomputes from the ledger. */
  | { type: 'report.draft'; markdown: string; claims: Claim[]; dataClaims?: Claim[] }
  | { type: 'factcheck.verdicts'; verdicts: ClaimVerdict[] }
  | {
      type: 'report.final';
      markdown: string;
      supported: number;
      unsupported: number;
      contradicted: number;
      /** V2: counts split by web [cN] and store-data [dN] claims. */
      counts?: ReportCounts;
    }
  // ---- V2: store tools, the data ledger, and the planner's outputs ----
  | { type: 'tool.call'; agentId: string; source: SourceId; tool: string; args: Record<string, string>; callId: string }
  | { type: 'tool.result'; agentId: string; source: SourceId; tool: string; callId: string; ledgerIds: string[] }
  | { type: 'ledger.entry'; agentId: string; entry: LedgerEntry }
  | { type: 'audit.findings'; agentId: string; area: string; headline: string; findings: AuditFinding[] }
  | { type: 'audit.profile'; profile: StoreProfile }
  | { type: 'opportunities'; items: Opportunity[]; followups: { question: string; kind: 'web' | 'data'; why: string }[] }
  | { type: 'priorities'; items: ScoredOpportunity[] }
  | { type: 'plan.draft'; initiatives: Initiative[]; roadmap: Roadmap }
  | { type: 'tests.draft'; tests: TestPlan[]; feasibility: FeasibilityCheck[] }
  // ---- V3: shopper journeys, analytics, subscription strategy, build kits ----
  | { type: 'journey.step'; agentId: string; journey: Journey['id']; step: JourneyStep }
  | { type: 'journey.done'; agentId: string; journey: Journey }
  | { type: 'analytics.pack'; pack: AnalyticsPack; scorecard: AreaScore[] }
  | { type: 'strategy.stack'; strategy: SubscriptionStrategy }
  | { type: 'build.packages'; packages: BuildPackage[] }
  /** Quick review: 2–3 versions of each ranked move for the merchant to pick from. */
  | { type: 'review.deck'; cards: ReviewCard[] };

export type RunEvent = RunEventBody & {
  /** Position in the run's stream; the SSE id and the replay cursor. */
  seq: number;
  /** Milliseconds since the run started; drives replay pacing and the trace clock. */
  t: number;
};

export type RunEventSink = (event: RunEvent) => void;

export class RunBus {
  readonly events: RunEvent[] = [];
  private readonly listeners = new Set<RunEventSink>();
  private finished = false;

  constructor(
    readonly runId: string,
    private readonly startedAt: number = Date.now(),
    private readonly sink?: RunEventSink,
  ) {}

  emit(body: RunEventBody): RunEvent {
    const event = { ...body, seq: this.events.length, t: Date.now() - this.startedAt } as RunEvent;
    this.push(event);
    return event;
  }

  /** Replay path: the event already carries its seq and t. */
  push(event: RunEvent): void {
    this.events.push(event);
    if (event.type === 'run.completed' || event.type === 'run.failed') this.finished = true;
    this.sink?.(event);
    for (const listener of this.listeners) listener(event);
  }

  get isFinished(): boolean {
    return this.finished;
  }

  subscribe(listener: RunEventSink): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
