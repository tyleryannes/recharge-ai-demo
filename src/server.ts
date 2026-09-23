/**
 * The visualizer's local server: one page, a run list, and a per-run SSE stream
 * that replays what has happened so far and then follows the run live. Finished
 * runs come off disk; live ones off their RunBus.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { RunBus, type RunEvent } from './events.js';
import { listStoredRuns, readRunEvents, runDir, summariseEvents, type RunSummary } from './run-store.js';
import { fixture } from './connectors/demo-tools.js';
import { EXAMPLE_QUESTIONS, buildIntake, normaliseRunBrief } from './v2/intake.js';
import type { RunBrief } from './v2/types.js';

const PAGE_URL = new URL('../ui/index.html', import.meta.url);
const OFFICE_URL = new URL('../ui/office.js', import.meta.url);
/** V3 plan workspace, served next to the page. */
const UI_ASSETS: Record<string, string> = { '/workspace.js': 'text/javascript', '/workspace.css': 'text/css' };
/** Comments, notes, statuses and edited assumptions a merchant adds to a plan. */
const WORKSPACE_MAX_BYTES = 512_000;
/** Keeps proxies and browsers from closing a quiet stream while an agent thinks. */
const HEARTBEAT_MS = 15_000;

export class RunRegistry {
  private readonly live = new Map<string, RunBus>();

  add(bus: RunBus): void {
    this.live.set(bus.runId, bus);
  }

  get(runId: string): RunBus | undefined {
    return this.live.get(runId);
  }

  list(): RunSummary[] {
    const stored = listStoredRuns();
    const storedIds = new Set(stored.map((r) => r.runId));
    const liveOnly = [...this.live.values()]
      .filter((bus) => !storedIds.has(bus.runId))
      .map((bus) => summariseEvents(bus.runId, bus.events))
      .filter((s): s is RunSummary => s !== null);
    return [...liveOnly, ...stored].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}

export interface ResearchServerOptions {
  registry: RunRegistry;
  /** Starts a run from the page; resolves to its id once queued. */
  startRun: (brief: string) => string;
  /** V2: starts a scripted growth-planner run (demo data) from a Run Brief. */
  startDemoRun?: (brief: RunBrief, speed: number) => string;
  /** V2: flushes a demo run's remaining events. */
  skipRun?: (runId: string) => boolean;
  /** When true, a bare { brief } never launches real (paid) agents. */
  demoOnly?: boolean;
}

/** Optional demo password (DEMO_PASSWORD) and a simple per-IP rate limit on starting runs. */
const RUN_LIMIT = { windowMs: 10 * 60_000, max: 20 };
const runStarts = new Map<string, number[]>();

export function createResearchApp({ registry, startRun, startDemoRun, skipRun, demoOnly }: ResearchServerOptions): Hono {
  const app = new Hono();

  // Read per request so edits to the page show on refresh during development.
  app.get('/', (c) => c.html(readFileSync(PAGE_URL, 'utf8')));
  app.get('/office.js', (c) => c.body(readFileSync(OFFICE_URL, 'utf8'), 200, { 'content-type': 'text/javascript; charset=utf-8' }));
  // Locally the page talks to its own origin; the static Vercel build ships a config.js that points here.
  app.get('/config.js', (c) => c.body('window.RESEARCH_API = "";', 200, { 'content-type': 'text/javascript; charset=utf-8' }));
  app.get('/favicon.ico', (c) => c.body(null, 204));
  for (const [path, type] of Object.entries(UI_ASSETS)) {
    app.get(path, (c) => c.body(readFileSync(new URL(`../ui${path}`, import.meta.url), 'utf8'), 200, { 'content-type': `${type}; charset=utf-8` }));
  }
  // The demo page may be served from another origin (Vercel) with this server behind a tunnel.
  app.use('/api/*', cors());

  app.use('/api/*', async (c, next) => {
    const password = process.env.DEMO_PASSWORD;
    if (password && c.req.method !== 'GET' && c.req.header('x-demo-password') !== password) {
      return c.json({ error: 'This demo needs a password.', needsPassword: true }, 401);
    }
    await next();
  });

  app.get('/api/runs', (c) => c.json(registry.list()));

  // V2: the demo store the Connect screen shows, and the Intake agent's follow-up questions.
  app.get('/api/store', (c) =>
    c.json({ store: fixture.store, sources: fixture.sources, examples: EXAMPLE_QUESTIONS, demo: true, passwordRequired: !!process.env.DEMO_PASSWORD }),
  );
  app.post('/api/intake', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { question?: unknown };
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question) return c.json({ error: 'Ask a question first.' }, 400);
    return c.json(buildIntake(question));
  });

  app.post('/api/runs', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';
    const now = Date.now();
    const recent = (runStarts.get(ip) ?? []).filter((t) => now - t < RUN_LIMIT.windowMs);
    if (recent.length >= RUN_LIMIT.max) return c.json({ error: 'Too many runs started; try again in a few minutes.' }, 429);
    const body = (await c.req.json().catch(() => ({}))) as { brief?: unknown; runBrief?: Partial<RunBrief>; speed?: unknown };
    if (body.runBrief && typeof body.runBrief.question === 'string' && body.runBrief.question.trim()) {
      if (!startDemoRun) return c.json({ error: 'This server does not run the growth planner.' }, 400);
      const speed = typeof body.speed === 'number' && body.speed > 0 && body.speed <= 50 ? body.speed : 5;
      runStarts.set(ip, [...recent, now]);
      return c.json({ runId: startDemoRun(normaliseRunBrief({ ...body.runBrief, question: body.runBrief.question.trim() }), speed) }, 201);
    }
    const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
    if (!brief) return c.json({ error: 'Write the brief first.' }, 400);
    if (demoOnly) return c.json({ error: 'Live agent runs are off in demo mode.' }, 400);
    runStarts.set(ip, [...recent, now]);
    return c.json({ runId: startRun(brief) }, 201);
  });

  // The merchant's own layer on a plan. Stored beside the run; the run's events never change.
  const workspaceFile = (runId: string) => (/^[\w~-]+$/.test(runId) ? join(runDir(runId), 'workspace.json') : null);
  app.get('/api/runs/:id/workspace', (c) => {
    const file = workspaceFile(c.req.param('id'));
    if (!file) return c.json({ error: 'Bad run id.' }, 400);
    return c.json(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
  });
  app.put('/api/runs/:id/workspace', async (c) => {
    const runId = c.req.param('id');
    const file = workspaceFile(runId);
    if (!file) return c.json({ error: 'Bad run id.' }, 400);
    if (!registry.get(runId) && readRunEvents(runId).length === 0) return c.json({ error: 'No run with that id.' }, 404);
    const text = await c.req.text();
    if (text.length > WORKSPACE_MAX_BYTES) return c.json({ error: 'Workspace too large.' }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return c.json({ error: 'Not JSON.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Expected an object.' }, 400);
    mkdirSync(runDir(runId), { recursive: true });
    writeFileSync(file, JSON.stringify(body));
    return c.json({ ok: true });
  });

  app.post('/api/runs/:id/skip', (c) => {
    const ok = skipRun?.(c.req.param('id')) ?? false;
    return ok ? c.json({ ok }) : c.json({ error: 'Nothing to skip.' }, 404);
  });

  app.get('/api/runs/:id/events', (c) => {
    const runId = c.req.param('id');
    const bus = registry.get(runId);
    const stored = bus ? null : readRunEvents(runId);
    if (!bus && stored!.length === 0) return c.json({ error: 'No run with that id.' }, 404);

    return streamSSE(c, async (stream) => {
      const send = (event: RunEvent) =>
        stream.writeSSE({ id: String(event.seq), data: JSON.stringify(event) });

      if (!bus) {
        for (const event of stored!) await send(event);
        await stream.writeSSE({ event: 'done', data: '' });
        return;
      }

      // Snapshot first, then subscribe: anything emitted in between is caught by seq.
      let sent = 0;
      for (const event of bus.events) {
        await send(event);
        sent = event.seq + 1;
      }
      if (bus.isFinished) {
        await stream.writeSSE({ event: 'done', data: '' });
        return;
      }

      await new Promise<void>((resolve) => {
        const queue: RunEvent[] = [];
        let draining = false;
        const drain = async () => {
          if (draining) return;
          draining = true;
          while (queue.length) {
            const event = queue.shift()!;
            if (event.seq < sent) continue;
            await send(event);
            sent = event.seq + 1;
            if (event.type === 'run.completed' || event.type === 'run.failed') {
              await stream.writeSSE({ event: 'done', data: '' });
              finish();
            }
          }
          draining = false;
        };
        const unsubscribe = bus.subscribe((event) => {
          queue.push(event);
          void drain();
        });
        const heartbeat = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), HEARTBEAT_MS);
        const finish = () => {
          unsubscribe();
          clearInterval(heartbeat);
          resolve();
        };
        stream.onAbort(finish);
      });
    });
  });

  return app;
}
