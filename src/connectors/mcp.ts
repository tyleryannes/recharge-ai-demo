/**
 * The same demo tools, exposed to agents as in-process MCP servers (one per source),
 * so an agent sees `mcp__shopify__get_repurchase_rates` exactly as it would with a
 * real Shopify MCP. Not used by the scripted demo run; this is the seam for when the
 * V2 pipeline runs real agents. Going live means swapping a server here for a real
 * config such as { type: 'http', url }.
 */

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { RunBus } from '../events.js';
import type { SourceId } from '../v2/types.js';
import { TOOL_PHRASES, callTool, fixture, toolNames } from './demo-tools.js';
import type { Ledger } from './ledger.js';

/** Argument values each parameterised tool accepts, read off the fixture's cases. */
function argShape(source: SourceId, name: string): Record<string, z.ZodType> {
  const entry = (fixture[source] as Record<string, { $args?: string; cases?: Record<string, unknown> }>)[name];
  if (!entry?.$args || !entry.cases) return {};
  const values = Object.keys(entry.cases) as [string, ...string[]];
  return { [entry.$args]: z.enum(values) };
}

export function createDemoMcpServers(
  ledger: Ledger,
  sources: SourceId[],
  opts: { bus?: RunBus; agentId?: string } = {},
): Record<string, McpSdkServerConfigWithInstance> {
  const servers: Record<string, McpSdkServerConfigWithInstance> = {};
  for (const source of sources) {
    servers[source] = createSdkMcpServer({
      name: source,
      version: '0.1.0',
      tools: toolNames(source).map((name) =>
        tool(
          name,
          `${fixture.sources[source].label}: ${TOOL_PHRASES[`${source}.${name}`] ?? name} (demo data)`,
          argShape(source, name),
          async (args) => {
            const result = callTool(ledger, source, name, args as Record<string, string>);
            if (opts.bus && opts.agentId) {
              for (const entry of result.entries) opts.bus.emit({ type: 'ledger.entry', agentId: opts.agentId, entry });
            }
            return { content: [{ type: 'text', text: JSON.stringify(result.data) }] };
          },
          { alwaysLoad: true },
        ),
      ),
    });
  }
  return servers;
}

/** The allowedTools list for a set of sources, in the SDK's mcp__<server>__<tool> form. */
export function allowedToolsFor(sources: SourceId[]): string[] {
  return sources.flatMap((source) => toolNames(source).map((name) => `mcp__${source}__${name}`));
}
