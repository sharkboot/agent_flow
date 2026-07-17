import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';

// -----------------------------------------------------------------------------
// AgentHistory — per-agent, per-session chat log. JSONL, append-only.
//
// Layout:
//   config/agent-history/
//     <agentId>/
//       <sessionId>.jsonl         ← one file per conversation
//
// A "session" is one continuous chat thread — the UI lists sessions in a
// column so users can jump back into an old one or start a new one.
// -----------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HISTORY_ROOT = path.resolve(__dirname, '../../config/agent-history');

export interface HistoryMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  meta?: {
    status?: 'completed' | 'failed';
    duration?: number;
    error?: string;
    exitCode?: number | null;
    /**
     * Structured events from ACP adapters (or any future adapter that
     * emits `structured`). Older messages predate this field — front-end
     * code must treat it as optional.
     */
    acpEvents?: Array<{
      kind: string;
      updateType?: string;
      content?: unknown;
      timestamp: string;
    }>;
  };
}

export interface SessionSummary {
  id: string;
  agentId: string;
  title: string;             // first user message (trimmed), or "新对话"
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  size: number;              // bytes on disk
}

// -----------------------------------------------------------------------------
// Path helpers — agent IDs come from our own generator so they're already
// safe, but we still normalize defensively so a malformed `req.params` can't
// escape the history root.
// -----------------------------------------------------------------------------

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function agentDir(agentId: string): string {
  return path.join(HISTORY_ROOT, safeSegment(agentId));
}

function sessionFile(agentId: string, sessionId: string): string {
  return path.join(agentDir(agentId), `${safeSegment(sessionId)}.jsonl`);
}

async function ensureAgentDir(agentId: string): Promise<void> {
  await fs.mkdir(agentDir(agentId), { recursive: true });
}

// -----------------------------------------------------------------------------
// Message R/W
// -----------------------------------------------------------------------------

/** Append one message. Creates the session file if missing. */
export async function appendMessage(
  agentId: string,
  sessionId: string,
  msg: Omit<HistoryMessage, 'id' | 'timestamp'> &
    Partial<Pick<HistoryMessage, 'id' | 'timestamp'>>,
): Promise<HistoryMessage> {
  await ensureAgentDir(agentId);
  const full: HistoryMessage = {
    id: msg.id ?? `msg-${uuid().slice(0, 8)}`,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp ?? new Date().toISOString(),
    meta: msg.meta,
  };
  await fs.appendFile(sessionFile(agentId, sessionId), JSON.stringify(full) + '\n', 'utf8');
  return full;
}

export async function appendMessages(
  agentId: string,
  sessionId: string,
  msgs: HistoryMessage[],
): Promise<HistoryMessage[]> {
  if (msgs.length === 0) return [];
  await ensureAgentDir(agentId);
  const payload = msgs.map((m) => JSON.stringify(m)).join('\n') + '\n';
  await fs.appendFile(sessionFile(agentId, sessionId), payload, 'utf8');
  return msgs;
}

/** Read all messages of a session. Missing session → empty array. */
export async function readMessages(
  agentId: string,
  sessionId: string,
): Promise<HistoryMessage[]> {
  let text: string;
  try {
    text = await fs.readFile(sessionFile(agentId, sessionId), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: HistoryMessage[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as HistoryMessage);
    } catch {
      // append-only; a bad tail line shouldn't nuke the whole read.
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Session lifecycle
// -----------------------------------------------------------------------------

/**
 * Create an empty session file. Returns the summary. Explicit creation
 * makes "new chat" show up in the sidebar before any message is sent.
 */
export async function createSession(
  agentId: string,
  opts: { id?: string; title?: string } = {},
): Promise<SessionSummary> {
  await ensureAgentDir(agentId);
  const id = opts.id ?? `sess-${uuid().slice(0, 8)}`;
  const now = new Date().toISOString();
  const file = sessionFile(agentId, id);
  // Touch: create empty file. If somehow it exists, leave it as-is so we
  // don't clobber an existing session.
  try {
    await fs.open(file, 'wx').then((h) => h.close());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return {
    id,
    agentId,
    title: opts.title || '新对话',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    size: 0,
  };
}

/** Delete a single session file. Missing → silent (idempotent). */
export async function deleteSession(agentId: string, sessionId: string): Promise<void> {
  try {
    await fs.unlink(sessionFile(agentId, sessionId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** Delete every session file for an agent (used when the agent itself is removed). */
export async function deleteAgentHistory(agentId: string): Promise<void> {
  try {
    await fs.rm(agentDir(agentId), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// -----------------------------------------------------------------------------
// Session listing — read enough of each file to build a title and a count.
// -----------------------------------------------------------------------------

const TITLE_LEN = 60;

function titleFrom(msg: HistoryMessage | undefined): string {
  if (!msg) return '新对话';
  const text = (msg.content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '新对话';
  return text.length > TITLE_LEN ? text.slice(0, TITLE_LEN) + '…' : text;
}

async function summarize(
  agentId: string,
  sessionId: string,
): Promise<SessionSummary | null> {
  const file = sessionFile(agentId, sessionId);
  let stat: import('node:fs').Stats;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  const msgs = await readMessages(agentId, sessionId);
  const firstUser = msgs.find((m) => m.role === 'user');
  return {
    id: sessionId,
    agentId,
    title: titleFrom(firstUser),
    createdAt: msgs[0]?.timestamp || stat.birthtime.toISOString(),
    updatedAt: msgs[msgs.length - 1]?.timestamp || stat.mtime.toISOString(),
    messageCount: msgs.length,
    size: stat.size,
  };
}

/** List all sessions for an agent, newest first. */
export async function listSessions(agentId: string): Promise<SessionSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(agentDir(agentId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: SessionSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const id = name.replace(/\.jsonl$/, '');
    const s = await summarize(agentId, id);
    if (s) out.push(s);
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export function getHistoryRoot(): string {
  return HISTORY_ROOT;
}
