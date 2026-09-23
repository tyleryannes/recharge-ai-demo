// Run with: ./node_modules/.bin/tsx scripts/smoke-run.ts
// Builds the scripted run under several source toggles and prints the ranking and sanity checks.
import { buildDemoRun } from '../src/v2/demo-run.js';
import { defaultRunBrief } from '../src/v2/intake.js';

const base = defaultRunBrief('How do I get more of my customers onto subscription?');
for (const off of [[], ['klaviyo'], ['skio'], ['gorgias', 'okendo'], ['meta', 'tiktok', 'tiktokshop']] as string[][]) {
  const b = { ...base, sources: { ...base.sources } };
  for (const s of off) (b.sources as Record<string, boolean>)[s] = false;
  const ev = buildDemoRun('x', b);
  const get = (t: string) => ev.find((e) => e.type === t) as any;
  const done = get('run.completed');
  const kinds = ['journey.done', 'analytics.pack', 'strategy.stack', 'build.packages', 'priorities', 'report.final'];
  console.log(`OFF ${off.join(',') || 'none'} | events ${ev.length} | ledger ${ev.filter((e) => e.type === 'ledger.entry').length} | ${Math.round(done.t / 1000)}s $${done.costUsd} | has: ${kinds.filter((k) => get(k)).length}/${kinds.length}`);
  for (const o of get('priorities').items) console.log(`   ${o.rank ?? '-'} ${o.id.padEnd(3)} ${o.title.slice(0, 52).padEnd(52)} ${Math.round(o.annualImpact / 1000)}k score ${Math.round(o.score / 1000)}k ${o.locked ? 'LOCKED' : ''}${o.excluded ? 'EXCL' : ''}`);
  console.log('   journeys:', ev.filter((e) => e.type === 'journey.done').map((e: any) => `${e.journey.id}(${e.journey.steps.length})`).join(' '), '| charts:', get('analytics.pack').pack.charts.map((c: any) => c.id).join(','), '| kits:', get('build.packages').packages.length, '| counts', JSON.stringify(get('report.final').counts));
  for (let i = 1; i < ev.length; i++) if (ev[i].t < ev[i - 1].t) throw new Error('events out of order');
  const txt = JSON.stringify(ev);
  const bad = txt.match(/.{50}(undefined|NaN|\[d?undefined\]| \.).{20}/g);
  if (bad) console.log('   !! suspicious:', bad.slice(0, 3));
}
