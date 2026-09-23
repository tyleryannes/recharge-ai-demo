/**
 * Entry point for the single-file demo: the same engine the local server uses,
 * bundled onto window.DemoEngine so the page runs with no server at all.
 */

import { fixture } from '../connectors/demo-tools.js';
import { buildDemoRun } from './demo-run.js';
import { EXAMPLE_QUESTIONS, buildIntake, normaliseRunBrief } from './intake.js';

(globalThis as unknown as { DemoEngine: unknown }).DemoEngine = {
  store: fixture.store,
  sources: fixture.sources,
  examples: EXAMPLE_QUESTIONS,
  intake: buildIntake,
  normalise: normaliseRunBrief,
  buildRun: buildDemoRun,
};
