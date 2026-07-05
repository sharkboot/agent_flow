import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import type { SessionTool } from './sessionScanner.js';

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'thinking' | 'meta';

export interface SessionMessage {
  index: number;
  role: MessageRole;
  timestamp?: string;
  text?: string;                     // primary text content
  thinking?: string;                  // model reasoning trace (assistant)
  toolCalls?: {                       // tool invocations bundled in the message
    id?: string;
    name: string;
    arguments?: unknown;
    result?: string;
  }[];
  meta?: Record<string, unknown>;    // small badges (model, usage, turn_id ...)
}

export interface ReadResult {
  tool: SessionTool;
  file: string;
  truncated: boolean;               // hit a limit — client can offer "load more"
  totalScanned: number;             // raw lines/entries consumed
  messages: SessionMessage[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 400;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

interface ReadOpts {
  limit?: number;
  maxBytes?: number;
}

function toText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join('\n');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    if (typeof o.content === 'string') return o.content;
    if (Array.isArray(o.content)) return toText(o.content);
    return '';
  }
  return String(v);
}

function safeJson<T = unknown>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

async function iterJsonl(
  file: string,
  onLine: (obj: Record<string, unknown>, raw: string) => boolean | void,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<{ totalLines: number; truncated: boolean }> {
  const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 128 * 1024 });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let bytes = 0;
  let lines = 0;
  let truncated = false;
  for await (const raw of rl) {
    bytes += raw.length + 1;
    lines += 1;
    if (!raw) continue;
    const obj = safeJson<Record<string, unknown>>(raw);
    if (!obj) continue;
    const stop = onLine(obj, raw);
    if (stop === false) {
      truncated = true;
      break;
    }
    if (bytes > maxBytes) {
      truncated = true;
      break;
    }
  }
  rl.close();
  stream.destroy();
  return { totalLines: lines, truncated };
}

// ---------------------------------------------------------------------------
// Claude — JSONL, one line per event (`type: user | assistant | system | ...`)
// ---------------------------------------------------------------------------

async function readClaude(file: string, opts: Required<ReadOpts>): Promise<ReadResult> {
  const out: SessionMessage[] = [];
  let idx = 0;
  const { truncated, totalLines } = await iterJsonl(
    file,
    (obj) => {
      if (out.length >= opts.limit) return false;
      const type = obj.type as string | undefined;
      const ts = obj.timestamp as string | undefined;
      if (type === 'user' || type === 'assistant') {
        const msg = obj.message as Record<string, unknown> | undefined;
        if (!msg) return;
        const content = msg.content;
        // Collect text / thinking / tool_use / tool_result
        let text = '';
        let thinking = '';
        const toolCalls: SessionMessage['toolCalls'] = [];
        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          for (const c of content) {
            if (!c || typeof c !== 'object') continue;
            const b = c as Record<string, unknown>;
            const t = b.type as string | undefined;
            if (t === 'text') text += (text ? '\n' : '') + String(b.text || '');
            else if (t === 'thinking') thinking += (thinking ? '\n' : '') + String(b.thinking || '');
            else if (t === 'tool_use') {
              toolCalls.push({
                id: b.id as string | undefined,
                name: String(b.name || 'tool'),
                arguments: b.input,
              });
            } else if (t === 'tool_result') {
              toolCalls.push({
                id: b.tool_use_id as string | undefined,
                name: 'tool_result',
                result: toText(b.content),
              });
            }
          }
        }
        const meta: Record<string, unknown> = {};
        if (msg.model) meta.model = msg.model;
        if (msg.usage) meta.usage = msg.usage;
        out.push({
          index: idx++,
          role: type === 'user' ? 'user' : 'assistant',
          timestamp: ts,
          text: text || undefined,
          thinking: thinking || undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          meta: Object.keys(meta).length ? meta : undefined,
        });
      } else if (type === 'system' || type === 'summary') {
        const text =
          (obj.summary as string) ||
          (obj.subtype as string) ||
          (obj.text as string) ||
          '';
        out.push({
          index: idx++,
          role: type === 'system' ? 'system' : 'meta',
          timestamp: ts,
          text: text || JSON.stringify(obj).slice(0, 200),
        });
      }
    },
    opts.maxBytes,
  );
  return { tool: 'claude', file, truncated, totalScanned: totalLines, messages: out };
}

// ---------------------------------------------------------------------------
// Codex — JSONL. Two record kinds: `response_item` (chat messages, tool calls)
// and `event_msg` (state events; we surface user_message + task_complete).
// ---------------------------------------------------------------------------

async function readCodex(file: string, opts: Required<ReadOpts>): Promise<ReadResult> {
  const out: SessionMessage[] = [];
  let idx = 0;
  // Skip system/developer messages for readability but keep a single meta note.
  let systemSeen = false;
  const { truncated, totalLines } = await iterJsonl(
    file,
    (obj) => {
      if (out.length >= opts.limit) return false;
      const ts = obj.timestamp as string | undefined;
      const type = obj.type as string | undefined;
      const payload = (obj.payload as Record<string, unknown>) || {};

      if (type === 'response_item' && payload.type === 'message') {
        const role = payload.role as string;
        const content = payload.content;
        let text = '';
        if (Array.isArray(content)) {
          for (const c of content) {
            if (!c || typeof c !== 'object') continue;
            const b = c as Record<string, unknown>;
            if (b.type === 'input_text' || b.type === 'output_text' || b.type === 'text') {
              text += (text ? '\n' : '') + String(b.text || '');
            }
          }
        } else if (typeof content === 'string') {
          text = content;
        }
        if (role === 'system' || role === 'developer') {
          if (systemSeen) return;
          systemSeen = true;
          out.push({
            index: idx++,
            role: 'system',
            timestamp: ts,
            text: `[system/developer prompt — ${text.length} chars, collapsed]`,
          });
          return;
        }
        out.push({
          index: idx++,
          role: role === 'assistant' ? 'assistant' : 'user',
          timestamp: ts,
          text: text || undefined,
        });
      } else if (type === 'response_item' && payload.type === 'reasoning') {
        const summary = payload.summary;
        const thinking = Array.isArray(summary) ? toText(summary) : toText(payload.content);
        if (thinking) {
          out.push({ index: idx++, role: 'thinking', timestamp: ts, thinking });
        }
      } else if (type === 'response_item' && (payload.type === 'function_call' || payload.type === 'custom_tool_call')) {
        out.push({
          index: idx++,
          role: 'tool',
          timestamp: ts,
          toolCalls: [
            {
              id: payload.call_id as string | undefined,
              name: String(payload.name || 'tool'),
              arguments: safeJson(String(payload.arguments || '')) ?? payload.arguments,
            },
          ],
        });
      } else if (type === 'response_item' && (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output')) {
        out.push({
          index: idx++,
          role: 'tool',
          timestamp: ts,
          toolCalls: [
            {
              id: payload.call_id as string | undefined,
              name: 'tool_result',
              result: toText(payload.output),
            },
          ],
        });
      } else if (type === 'event_msg' && payload.type === 'user_message') {
        out.push({
          index: idx++,
          role: 'user',
          timestamp: ts,
          text: String(payload.message || ''),
        });
      } else if (type === 'event_msg' && payload.type === 'task_complete') {
        out.push({
          index: idx++,
          role: 'assistant',
          timestamp: ts,
          text: String(payload.last_agent_message || ''),
          meta: { event: 'task_complete', turn_id: payload.turn_id },
        });
      } else if (type === 'session_meta') {
        const p = payload as Record<string, unknown>;
        out.push({
          index: idx++,
          role: 'meta',
          timestamp: ts,
          text: `Codex session · ${p.originator || ''} · cwd=${p.cwd || ''} · model_provider=${p.model_provider || ''}`,
        });
      }
    },
    opts.maxBytes,
  );
  return { tool: 'codex', file, truncated, totalScanned: totalLines, messages: out };
}

// ---------------------------------------------------------------------------
// OpenClaw — JSONL, `type:"session"` header then a chain of `type:"message"`.
// Message payload lives at `.message.content[]` with typed blocks (text /
// thinking / toolCall / toolResult).
// ---------------------------------------------------------------------------

async function readOpenClaw(file: string, opts: Required<ReadOpts>): Promise<ReadResult> {
  const out: SessionMessage[] = [];
  let idx = 0;
  const { truncated, totalLines } = await iterJsonl(
    file,
    (obj) => {
      if (out.length >= opts.limit) return false;
      const type = obj.type as string | undefined;
      const ts = obj.timestamp as string | undefined;
      if (type === 'session') {
        out.push({
          index: idx++,
          role: 'meta',
          timestamp: ts,
          text: `OpenClaw session · cwd=${obj.cwd || ''} · v${obj.version || '?'}`,
        });
        return;
      }
      if (type !== 'message') return;
      const msg = obj.message as Record<string, unknown> | undefined;
      if (!msg) return;
      const role = String(msg.role || 'user');
      const content = msg.content;
      let text = '';
      let thinking = '';
      const toolCalls: SessionMessage['toolCalls'] = [];
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        for (const c of content) {
          if (!c || typeof c !== 'object') continue;
          const b = c as Record<string, unknown>;
          const t = b.type as string | undefined;
          if (t === 'text') text += (text ? '\n' : '') + String(b.text || '');
          else if (t === 'thinking') thinking += (thinking ? '\n' : '') + String(b.thinking || '');
          else if (t === 'toolCall' || t === 'tool_use') {
            toolCalls.push({
              id: b.id as string | undefined,
              name: String(b.name || 'tool'),
              arguments: b.arguments ?? b.input,
            });
          } else if (t === 'toolResult' || t === 'tool_result') {
            toolCalls.push({
              id: (b.toolCallId as string) || (b.tool_use_id as string) || undefined,
              name: 'tool_result',
              result: toText(b.content ?? b.result),
            });
          }
        }
      }
      const meta: Record<string, unknown> = {};
      if (msg.model) meta.model = msg.model;
      if (msg.provider) meta.provider = msg.provider;
      if (msg.usage) meta.usage = msg.usage;
      out.push({
        index: idx++,
        role:
          role === 'assistant' ? 'assistant' : role === 'system' ? 'system' : role === 'tool' ? 'tool' : 'user',
        timestamp: ts,
        text: text || undefined,
        thinking: thinking || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        meta: Object.keys(meta).length ? meta : undefined,
      });
    },
    opts.maxBytes,
  );
  return { tool: 'openclaw', file, truncated, totalScanned: totalLines, messages: out };
}

// ---------------------------------------------------------------------------
// Hermes — one pretty-printed JSON per dump. Read the whole file (bounded)
// and walk `request.body.messages[]`.
// ---------------------------------------------------------------------------

async function readHermes(file: string, opts: Required<ReadOpts>): Promise<ReadResult> {
  const stat = await fsp.stat(file);
  if (stat.size > opts.maxBytes) {
    return {
      tool: 'hermes',
      file,
      truncated: true,
      totalScanned: 0,
      messages: [
        {
          index: 0,
          role: 'meta',
          text: `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)} MB)，未展开。使用 ?maxBytes= 提高上限。`,
        },
      ],
    };
  }
  const raw = await fsp.readFile(file, 'utf8');
  const obj = safeJson<Record<string, unknown>>(raw);
  if (!obj) {
    return { tool: 'hermes', file, truncated: false, totalScanned: 0, messages: [] };
  }

  const req = (obj.request as Record<string, unknown>) || {};
  const body = (req.body as Record<string, unknown>) || {};
  const messages = (body.messages as Record<string, unknown>[]) || [];

  const out: SessionMessage[] = [];
  const topTs = obj.timestamp as string | undefined;
  out.push({
    index: 0,
    role: 'meta',
    timestamp: topTs,
    text: `Hermes dump · model=${body.model || '?'} · reason=${obj.reason || '?'} · session=${obj.session_id || ''}`,
  });

  let idx = 1;
  let truncated = false;
  let systemCollapsed = false;
  for (const m of messages) {
    if (out.length >= opts.limit) {
      truncated = true;
      break;
    }
    const role = String(m.role || 'user');
    const content = m.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) text = toText(content);
    if (role === 'system') {
      if (systemCollapsed) continue;
      systemCollapsed = true;
      out.push({
        index: idx++,
        role: 'system',
        text: `[system prompt — ${text.length} chars, collapsed]`,
      });
      continue;
    }
    if (role === 'tool') {
      out.push({
        index: idx++,
        role: 'tool',
        toolCalls: [
          {
            id: m.tool_call_id as string | undefined,
            name: (m.name as string) || 'tool_result',
            result: text,
          },
        ],
      });
      continue;
    }
    // assistant tool_calls
    const toolCalls: SessionMessage['toolCalls'] = [];
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Record<string, unknown>[]) {
        const fn = (tc.function as Record<string, unknown>) || {};
        toolCalls.push({
          id: tc.id as string | undefined,
          name: String(fn.name || 'tool'),
          arguments: safeJson(String(fn.arguments || '')) ?? fn.arguments,
        });
      }
    }
    out.push({
      index: idx++,
      role: role === 'assistant' ? 'assistant' : 'user',
      text: text || undefined,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    });
  }
  return { tool: 'hermes', file, truncated, totalScanned: messages.length, messages: out };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function readSessionMessages(
  tool: SessionTool,
  file: string,
  opts: ReadOpts = {},
): Promise<ReadResult> {
  const full: Required<ReadOpts> = {
    limit: opts.limit ?? DEFAULT_LIMIT,
    maxBytes: opts.maxBytes ?? DEFAULT_MAX_BYTES,
  };
  switch (tool) {
    case 'claude':
      return readClaude(file, full);
    case 'codex':
      return readCodex(file, full);
    case 'openclaw':
      return readOpenClaw(file, full);
    case 'hermes':
      return readHermes(file, full);
  }
  return { tool, file, truncated: false, totalScanned: 0, messages: [] };
}

// Truncate long text fields so a large tool_result doesn't blow up the wire.
export function trimForTransport(res: ReadResult, maxCharsPerField = 8000): ReadResult {
  const clip = (s?: string) =>
    !s ? s : s.length > maxCharsPerField ? s.slice(0, maxCharsPerField) + `\n… [${s.length - maxCharsPerField} chars trimmed]` : s;
  return {
    ...res,
    messages: res.messages.map((m) => ({
      ...m,
      text: clip(m.text),
      thinking: clip(m.thinking),
      toolCalls: m.toolCalls?.map((tc) => ({
        ...tc,
        result: clip(tc.result),
      })),
    })),
  };
}
