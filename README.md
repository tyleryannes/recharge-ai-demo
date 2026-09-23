# Research crew → Growth Planner (V2)

## V2 demo: the Merchant Growth Planner (demo data, no agents, no cost)

A merchant asks one question, answers a few follow-ups with suggested answers drawn from their store's data,
picks which sources are connected, and then watches a crew audit the store (Shopify, Klaviyo, Postscript,
Meta, TikTok Ads, TikTok Shop, Skio), research around what it found, and return a **ranked plan**: what to do
first, why (every store number cited `[dN]`, every web claim cited `[cN]`), exactly how, and how to test it.

The store, **Bramble & Bean Coffee Co.**, is fictional. Every store number is demo data from one fixture file,
and every web source is illustrative (example.com).

```sh
./demo.sh                 # installs if needed, serves http://localhost:4100 and opens it
./demo.sh --play 5        # …and starts a run straight away at 5×
pnpm research demo        # same, without the install step
pnpm research export-demo --out growth-planner-demo.html   # one self-contained HTML file, runs offline
```

The flow: **Ask → Clarify → Connect → Watch → Plan**. The plan has five tabs: Summary, Store context (with the
Klaviyo flows map and best/worst products by quarter), Ranked plan (scoring maths, action steps, 30/60/90
roadmap), Test plan (sample sizes computed in code, plus tests that can't be run as asked), and Sources (the
data ledger and web claims with fact-check verdicts). Try switching Klaviyo or Skio off on Connect: the
dependent recommendations lock and the ranking changes. "Skip to the plan" jumps to the end of a run.

Where the V2 pieces live:

- `fixtures/bramble-and-bean.json`: the demo store, keyed by source → MCP tool name. Change numbers here only.
- `src/connectors/`: the connector layer. `demo-tools.ts` answers store tools from the fixture and records every
  metric in the data ledger (`ledger.ts`); `mcp.ts` exposes the same tools as in-process MCP servers
  (`mcp__shopify__get_repurchase_rates`, …) for when real agents run. Going live means swapping a server config.
- `src/agent-turn.ts`: now accepts `mcpServers` / `allowedTools` (with `strictMcpConfig`) and emits
  `tool.call` / `tool.result` for `mcp__*` tools. v1 behaviour is unchanged when they're not passed.
- `src/v2/`: `intake.ts` (follow-up questions), `scoring.ts` (impact, score, sample size), `demo-run.ts` (the
  scripted pipeline as a timed event stream), `web-corpus.ts` (illustrative research), `playback.ts`,
  `standalone.ts` (single-file build), `types.ts` (Run Brief, ledger, audit, opportunity, plan, test contracts).
- `src/events.ts`: new stages and events (`ledger.entry`, `audit.findings`, `priorities`, `plan.draft`, …);
  `run.started` now carries the stage list so the page draws whatever the backend sends.
- `src/server.ts`: `GET /api/store`, `POST /api/intake`, `POST /api/runs {runBrief, speed}`,
  `POST /api/runs/:id/skip`, an optional `DEMO_PASSWORD` gate and a rate limit on starting runs.
- `ui/index.html`: the V2 screens, trace renderers, `[d]`/`[c]` popovers and plan tabs, alongside v1.

Not built yet (spec phases 3–5 with real agents): the V2 pipeline running live Claude agents against the MCP
servers. The scripted run shows exactly what that pipeline emits.

---

## v1: the research crew

A multi-agent system you can watch. Give it a brand's question and a crew of Claude agents researches it:
three analysts in parallel (macro, consumer trends, competitors), an **assembly** pass that finds
contradictions and gaps, one round of **follow-up** agents on those gaps, a second assembly pass that
writes the report, and a **fact-checker** that never saw the drafting and marks every claim
supported, unsupported or contradicted.

The page shows the crew working two ways: a **pixel office** where each agent is a sprite that walks to
the search counter, the library, or its desk, and hands its paper to the next desk when it finishes —
and a **pipeline** map, CI-style. Every run is recorded and replays at 1×–20× with a scrubber.

## Run it locally

```sh
pnpm install
pnpm research run "We're a UK specialty coffee subscription brand, about 40,000 subscribers at £18 a month, planning to launch in Germany in Q1 2027. What do German consumers expect from a coffee subscription, who would we be competing with, and what regulation or logistics could trip us up?"
```

The first line printed is the page URL. Agents run through the Claude Agent SDK on your local Claude
Code login; no API key needed. A run takes 10–15 minutes and roughly $20 on `claude-opus-5`.

- `pnpm research serve` — the page alone, listing past runs (new runs can be started from the page)
- `pnpm research replay <runId> --speed 4` — replay a recorded run from the CLI
- `pnpm research sample` — a built-in, made-up run for checking the page without any API calls

Runs live in `data/research/<runId>/` (`events.jsonl` and `report.md`).

## Hosting the page while the agents run on your machine

The agents need your Claude Code login, so the run server stays on your laptop. The page is static and
can live anywhere; it just needs the server's public URL.

```sh
pnpm research serve                                   # the run server, port 4100
cloudflared tunnel --url http://localhost:4100        # a public URL for it (prints https://….trycloudflare.com)
```

On Vercel, set `RESEARCH_API` to that URL and deploy: the build runs `pnpm research export`, which
writes `site/` with the page and a `config.js` pointing at your tunnel. If the tunnel URL changes, either
update the env var and redeploy, or open the page with `?api=https://new-url` — it remembers.

## Layout

- `src/pipeline.ts` — the stages and how they hand off
- `src/agent-turn.ts` — one agent's turn through the Agent SDK, streamed into run events
- `src/prompts.ts`, `src/schemas.ts` — what each agent is told and must return
- `src/server.ts` — Hono server: page, run list, per-run SSE stream
- `src/cli.ts` — `run`, `serve`, `replay`, `sample`, `export`
- `ui/index.html` — the page (pipeline map, all-agents trace, report with claim verdicts, replay controls)
- `ui/office.js` — the pixel office
