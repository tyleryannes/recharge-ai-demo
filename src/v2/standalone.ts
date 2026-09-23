/**
 * Builds the V2 demo as one self-contained HTML file: the page, the pixel office, and
 * the demo engine bundled inline. Opens straight from disk; only the web font and the
 * Markdown library come from a CDN, and the page has fallbacks for both.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const inlineScript = (code: string) => `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;

export async function buildStandalone(out: string): Promise<string> {
  const entry = fileURLToPath(new URL('./browser.ts', import.meta.url));
  const bundle = await build({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', write: false, minify: true, logLevel: 'silent' });
  const engine = bundle.outputFiles[0].text;
  const page = readFileSync(new URL('../../ui/index.html', import.meta.url), 'utf8');
  const office = readFileSync(new URL('../../ui/office.js', import.meta.url), 'utf8');
  const workspaceJs = readFileSync(new URL('../../ui/workspace.js', import.meta.url), 'utf8');
  const workspaceCss = readFileSync(new URL('../../ui/workspace.css', import.meta.url), 'utf8');
  const html = page
    .replace('<script src="/config.js"></script>', () => `${inlineScript('window.RESEARCH_API = ""; window.DEMO_STANDALONE = true;')}\n${inlineScript(engine)}`)
    .replace('<script src="/office.js"></script>', () => inlineScript(office))
    .replace('<link rel="stylesheet" href="/workspace.css">', () => `<style>\n${workspaceCss}\n</style>`)
    .replace('<script src="/workspace.js"></script>', () => inlineScript(workspaceJs));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return out;
}
