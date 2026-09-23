/**
 * One agent's turn: a Claude Agent SDK query whose stream is translated into run
 * events (thoughts, searches, results) so the visualizer can follow it live, and
 * whose structured output is validated before the pipeline trusts it.
 */

import { query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { z } from 'zod';
import type { AgentDescriptor, RunBus, SourceRef } from './events.js';
import type { SourceId } from './v2/types.js';
import { jsonSchemaOf } from './schemas.js';

export interface AgentTurnSpec<T> {
  agent: AgentDescriptor;
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Claude Code tool names; empty means the agent only reads its prompt. */
  tools: string[];
  maxTurns: number;
  effort: 'low' | 'medium' | 'high';
  cwd: string;
  signal?: AbortSignal;
  /** V2 store tools: in-process demo MCP servers today, real MCP configs later. */
  mcpServers?: Record<string, McpServerConfig>;
  /** e.g. ['mcp__shopify__get_repurchase_rates']; required for MCP tools to be callable. */
  allowedTools?: string[];
}

/** Deltas are batched so a fast typist doesn't turn into thousands of SSE frames. */
const TEXT_FLUSH_MS = 250;

// The SDK's stream events are the beta Messages stream shape; we only touch the
// handful of fields below, so a narrow local view avoids importing beta types.
interface StreamEventView {
  type: string;
  index?: number;
  content_block?: { type: string };
  delta?: { type: string; text?: string; thinking?: string };
}

interface SearchResultView {
  query?: string;
  results?: Array<string | { content?: SourceRef[] }>;
}

export async function runAgentTurn<T>(bus: RunBus, spec: AgentTurnSpec<T>): Promise<T> {
  const agentId = spec.agent.id;
  const started = Date.now();
  bus.emit({ type: 'agent.started', agentId });

  const abortController = new AbortController();
  spec.signal?.addEventListener('abort', () => abortController.abort(), { once: true });

  const stream = query({
    prompt: spec.prompt,
    options: {
      model: spec.model,
      effort: spec.effort,
      systemPrompt: spec.system,
      tools: spec.tools,
      cwd: spec.cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      maxTurns: spec.maxTurns,
      includePartialMessages: true,
      // Summarized so the trace can show what the agent is reasoning about; the default hides it.
      thinking: { type: 'adaptive', display: 'summarized' },
      abortController,
      outputFormat: { type: 'json_schema', schema: jsonSchemaOf(spec.schema) },
      ...(spec.mcpServers
        ? {
            mcpServers: spec.mcpServers,
            allowedTools: spec.allowedTools,
            // Ignore MCP servers from the local Claude Code config: the SDK runs on the operator's login.
            strictMcpConfig: true,
          }
        : {}),
    },
  });
  // tool_use id -> the MCP call it was, so the matching result can be reported.
  const mcpCalls = new Map<string, { source: SourceId; tool: string }>();

  const blocks = new Map<number, { kind: 'thinking' | 'text'; text: string }>();
  let pendingText = '';
  let flushTimer: NodeJS.Timeout | null = null;
  const flushText = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (pendingText) bus.emit({ type: 'agent.text', agentId, text: pendingText });
    pendingText = '';
  };
  const queueText = (text: string) => {
    pendingText += text;
    if (!flushTimer) flushTimer = setTimeout(flushText, TEXT_FLUSH_MS);
  };

  const handleStreamEvent = (event: StreamEventView) => {
    const index = event.index ?? 0;
    if (event.type === 'content_block_start' && event.content_block) {
      const kind = event.content_block.type;
      if (kind === 'thinking' || kind === 'text') blocks.set(index, { kind, text: '' });
      return;
    }
    if (event.type === 'content_block_delta' && event.delta) {
      const block = blocks.get(index);
      if (event.delta.type === 'thinking_delta' && block?.kind === 'thinking') {
        block.text += event.delta.thinking ?? '';
      } else if (event.delta.type === 'text_delta' && event.delta.text) {
        if (block) block.text += event.delta.text;
        queueText(event.delta.text);
      }
      return;
    }
    if (event.type === 'content_block_stop') {
      const block = blocks.get(index);
      blocks.delete(index);
      if (block?.kind === 'thinking' && block.text.trim()) {
        bus.emit({ type: 'agent.thinking', agentId, text: block.text.trim() });
      } else if (block?.kind === 'text') {
        flushText();
      }
    }
  };

  let output: T | null = null;
  let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0 };

  try {
    for await (const message of stream) {
      // Subagent chatter (parent_tool_use_id set) isn't part of this agent's own trace.
      if ('parent_tool_use_id' in message && message.parent_tool_use_id) continue;

      if (message.type === 'stream_event') {
        handleStreamEvent(message.event as StreamEventView);
      } else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type !== 'tool_use') continue;
          const input = block.input as Record<string, unknown>;
          if (block.name === 'WebSearch' && typeof input.query === 'string') {
            flushText();
            bus.emit({ type: 'agent.search', agentId, query: input.query });
          } else if (block.name === 'WebFetch' && typeof input.url === 'string') {
            flushText();
            bus.emit({ type: 'agent.fetch', agentId, url: input.url });
          } else if (block.name.startsWith('mcp__')) {
            // mcp__<source>__<tool>: a store tool. Shown as "Pulled … from <source>" in the trace.
            const [, source, name] = block.name.split('__');
            flushText();
            mcpCalls.set(block.id, { source: source as SourceId, tool: `${source}.${name}` });
            bus.emit({
              type: 'tool.call',
              agentId,
              source: source as SourceId,
              tool: `${source}.${name}`,
              args: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v)])),
              callId: block.id,
            });
          }
        }
      } else if (message.type === 'user' && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (typeof block !== 'object' || block.type !== 'tool_result') continue;
          const call = mcpCalls.get(block.tool_use_id);
          if (!call) continue;
          const text = Array.isArray(block.content)
            ? block.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
            : String(block.content ?? '');
          const ledgerIds = [...text.matchAll(/"id":"(d\d+)"/g)].map((m) => m[1]);
          bus.emit({ type: 'tool.result', agentId, source: call.source, tool: call.tool, callId: block.tool_use_id, ledgerIds });
        }
        if (message.tool_use_result) {
          const result = message.tool_use_result as SearchResultView;
          if (typeof result.query === 'string' && Array.isArray(result.results)) {
            const results = result.results.flatMap((r) => (typeof r === 'string' ? [] : r.content ?? []));
            bus.emit({ type: 'agent.search.results', agentId, query: result.query, results });
          }
        }
      } else if (message.type === 'user' && message.tool_use_result) {
        const result = message.tool_use_result as SearchResultView;
        if (typeof result.query === 'string' && Array.isArray(result.results)) {
          const results = result.results.flatMap((r) => (typeof r === 'string' ? [] : r.content ?? []));
          bus.emit({ type: 'agent.search.results', agentId, query: result.query, results });
        }
      } else if (message.type === 'result') {
        usage = {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          costUsd: message.total_cost_usd,
          turns: message.num_turns,
        };
        if (message.subtype !== 'success') {
          throw new Error(`${message.subtype}: ${message.errors.join('; ') || 'no detail'}`);
        }
        output = parseOutput(spec.schema, message.structured_output, message.result);
      }
    }
    flushText();
    if (output === null) throw new Error('the agent finished without returning its result');
    bus.emit({ type: 'agent.completed', agentId, durationMs: Date.now() - started, usage });
    return output;
  } catch (err) {
    flushText();
    const error = err instanceof Error ? err.message : String(err);
    bus.emit({ type: 'agent.failed', agentId, error });
    throw err;
  }
}

function parseOutput<T>(schema: z.ZodType<T>, structured: unknown, fallbackText: string): T {
  const direct = schema.safeParse(structured);
  if (direct.success) return direct.data;
  // Structured output occasionally arrives only in the text result; take the last JSON object.
  const match = fallbackText.match(/\{[\s\S]*\}/);
  if (match) {
    const fromText = schema.safeParse(JSON.parse(match[0]));
    if (fromText.success) return fromText.data;
  }
  throw new Error(`the agent's output did not match its schema: ${direct.error.message}`);
}
