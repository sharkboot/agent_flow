import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionTool = 'claude' | 'codex' | 'hermes' | 'openclaw';

export interface SessionRecord {
  tool: SessionTool;
  id: string;              // session id (best effort — falls back to filename)
  file: string;            // absolute path to the record file
  cwd?: string;
  project?: string;        // human friendly project label
  startTime?: string;      // ISO
  endTime?: string;        // ISO
  size: number;            // bytes
  version?: string;
  model?: string;
  reason?: string;
  agent?: string;          // for openclaw: agent slot ("main", "stockexpert", ...)
  lastMessage?: string;    // short preview from tail line
  raw?: {                  // captured for the details drawer
    firstLine?: string;
    lastLine?: string;
  };
}

// ---------------------------------------------------------------------------
// Low-level helpers: read first / last non-empty line without slurping the file
// ---------------------------------------------------------------------------

async function readFirstLine(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file, {
      encoding: 'utf8',
      highWaterMark: 64 * 1024,
    });
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        stream.destroy();
        resolve(buf.slice(0, nl).replace(/\r$/, ''));
      }
    });
    stream.on('end', () => resolve(buf.replace(/\r$/, '')));
    stream.on('error', reject);
  });
}

/**
 * Read the last non-empty line of a text file by scanning backwards in
 * fixed-size chunks. Works for large files (we never load the whole thing).
 */
async function readLastLine(file: string): Promise<string> {
  const handle = await fsp.open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size === 0) return '';
    const CHUNK = 8 * 1024;
    let end = size;
    let tail = '';
    while (end > 0) {
      const start = Math.max(0, end - CHUNK);
      const len = end - start;
      const buffer = Buffer.alloc(len);
      await handle.read(buffer, 0, len, start);
      tail = buffer.toString('utf8') + tail;
      // Strip trailing newlines/whitespace once so we hunt the last real line
      const stripped = tail.replace(/[\r\n\s]+$/, '');
      const nl = stripped.lastIndexOf('\n');
      if (nl !== -1) return stripped.slice(nl + 1);
      end = start;
    }
    return tail.replace(/[\r\n\s]+$/, '');
  } finally {
    await handle.close();
  }
}

/** Read the first N lines of a text file (used for pretty-JSON files). */
async function readFirstLines(file: string, n: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file, {
      encoding: 'utf8',
      highWaterMark: 32 * 1024,
    });
    let buf = '';
    const out: string[] = [];
    stream.on('data', (chunk) => {
      buf += chunk;
      let nl = buf.indexOf('\n');
      while (nl !== -1 && out.length < n) {
        out.push(buf.slice(0, nl).replace(/\r$/, ''));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
      }
      if (out.length >= n) stream.destroy();
    });
    stream.on('close', () => resolve(out));
    stream.on('end', () => {
      if (buf.length && out.length < n) out.push(buf.replace(/\r$/, ''));
      resolve(out);
    });
    stream.on('error', reject);
  });
}

function safeJson<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function walkFiles(
  root: string,
  test: (name: string) => boolean,
  depth = 6,
): Promise<string[]> {
  const out: string[] = [];
  async function recur(dir: string, d: number) {
    if (d < 0) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await recur(p, d - 1);
      } else if (e.isFile() && test(e.name)) {
        out.push(p);
      }
    }
  }
  await recur(root, depth);
  return out;
}

function truncate(s: string, n = 240): string {
  if (!s) return '';
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n) + '…' : clean;
}

async function stat(file: string) {
  try {
    return await fsp.stat(file);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');

export function toolRoots(): Record<SessionTool, string[]> {
  return {
    claude: [path.join(HOME, '.claude', 'projects')],
    codex: [path.join(HOME, '.codex', 'sessions')],
    hermes: [path.join(HOME, '.hermes', 'sessions')],
    openclaw: [
      // Modern OpenClaw (LobsterAI) location
      path.join(APPDATA, 'LobsterAI', 'openclaw', 'state', 'agents'),
      // Legacy `.openclaw` dot dir (kept for older installs, harmless if absent)
      path.join(HOME, '.openclaw'),
    ],
  };
}

// ---------------------------------------------------------------------------
// Parsers — one per tool
// ---------------------------------------------------------------------------

async function parseClaude(file: string): Promise<SessionRecord | null> {
  const st = await stat(file);
  if (!st) return null;
  const [first, last] = await Promise.all([readFirstLine(file), readLastLine(file)]);
  const f = safeJson<Record<string, unknown>>(first) ?? {};
  const l = safeJson<Record<string, unknown>>(last) ?? {};

  const id =
    (f.sessionId as string) ||
    (l.sessionId as string) ||
    path.basename(file, path.extname(file));

  // Claude encodes cwd into the parent folder name using `-` as separator.
  const parent = path.basename(path.dirname(file));
  const decoded = parent.replace(/^([A-Za-z])--/, '$1:\\').replace(/-/g, '\\');

  return {
    tool: 'claude',
    id,
    file,
    cwd: (l.cwd as string) || decoded,
    project: parent,
    startTime: undefined,
    endTime: (l.timestamp as string) || st.mtime.toISOString(),
    size: st.size,
    version: l.version as string | undefined,
    raw: { firstLine: first, lastLine: last },
  };
}

async function parseCodex(file: string): Promise<SessionRecord | null> {
  const st = await stat(file);
  if (!st) return null;
  const [first, last] = await Promise.all([readFirstLine(file), readLastLine(file)]);
  const f = safeJson<Record<string, unknown>>(first) ?? {};
  const l = safeJson<Record<string, unknown>>(last) ?? {};

  const fp = (f.payload as Record<string, unknown>) || {};
  const lp = (l.payload as Record<string, unknown>) || {};

  const id =
    (fp.session_id as string) ||
    (fp.id as string) ||
    path.basename(file, path.extname(file));

  return {
    tool: 'codex',
    id,
    file,
    cwd: fp.cwd as string | undefined,
    project: (fp.cwd as string | undefined) || (fp.originator as string | undefined),
    startTime: (fp.timestamp as string) || (f.timestamp as string) || undefined,
    endTime: (l.timestamp as string) || st.mtime.toISOString(),
    size: st.size,
    version: fp.cli_version as string | undefined,
    model: fp.model_provider as string | undefined,
    lastMessage: truncate((lp.last_agent_message as string) || ''),
    raw: { firstLine: first, lastLine: last },
  };
}

async function parseHermes(file: string): Promise<SessionRecord | null> {
  const st = await stat(file);
  if (!st) return null;
  // Pretty-printed JSON — top-level keys live in the first ~10 lines.
  // We read the first block and (for symmetry) the last line, then also
  // opportunistically parse the whole file if it's small enough.
  const headLines = await readFirstLines(file, 20);
  const tail = await readLastLine(file);
  const head = headLines.join('\n');

  // Extract top-level fields by regex — cheaper than parsing a huge JSON.
  const pick = (key: string) => {
    const m = head.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    return m ? m[1] : undefined;
  };
  const sessionId = pick('session_id');
  const timestamp = pick('timestamp');
  const reason = pick('reason');
  // The base filename encodes both the request session id and the dump time.
  const base = path.basename(file, path.extname(file));

  return {
    tool: 'hermes',
    id: sessionId || base,
    file,
    startTime: timestamp,
    endTime: st.mtime.toISOString(),
    size: st.size,
    reason,
    raw: { firstLine: headLines[0] ?? '', lastLine: tail },
  };
}

async function parseOpenClaw(file: string): Promise<SessionRecord | null> {
  const st = await stat(file);
  if (!st) return null;
  const [first, last] = await Promise.all([readFirstLine(file), readLastLine(file)]);
  const f = safeJson<Record<string, unknown>>(first) ?? {};
  const l = safeJson<Record<string, unknown>>(last) ?? {};

  // Locate the agent slot name from the path: .../agents/<agent>/sessions/<file>.jsonl
  const parts = file.replace(/\\/g, '/').split('/');
  const idx = parts.lastIndexOf('agents');
  const agent = idx !== -1 && parts[idx + 1] ? parts[idx + 1] : undefined;

  // Pull a short preview from the tail message
  let preview = '';
  const msg = (l.message as Record<string, unknown>) || {};
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c && typeof c === 'object' && (c as Record<string, unknown>).type === 'text') {
        preview = String((c as Record<string, unknown>).text || '');
        break;
      }
    }
  }

  const model = (msg.model as string) || undefined;

  return {
    tool: 'openclaw',
    id: (f.id as string) || path.basename(file, path.extname(file)),
    file,
    cwd: f.cwd as string | undefined,
    project: agent,
    agent,
    startTime: f.timestamp as string | undefined,
    endTime: (l.timestamp as string) || st.mtime.toISOString(),
    size: st.size,
    model,
    lastMessage: truncate(preview),
    raw: { firstLine: first, lastLine: last },
  };
}

// ---------------------------------------------------------------------------
// Public scan API
// ---------------------------------------------------------------------------

async function scanTool(tool: SessionTool): Promise<SessionRecord[]> {
  const roots = toolRoots()[tool];
  const files: string[] = [];
  for (const root of roots) {
    if (tool === 'claude') {
      files.push(...(await walkFiles(root, (n) => n.endsWith('.jsonl'), 4)));
    } else if (tool === 'codex') {
      files.push(...(await walkFiles(root, (n) => n.endsWith('.jsonl'), 6)));
    } else if (tool === 'hermes') {
      files.push(...(await walkFiles(root, (n) => n.endsWith('.json'), 2)));
    } else if (tool === 'openclaw') {
      files.push(
        ...(await walkFiles(
          root,
          (n) => n.endsWith('.jsonl') && n !== 'sessions.json',
          6,
        )),
      );
    }
  }

  const parser =
    tool === 'claude'
      ? parseClaude
      : tool === 'codex'
      ? parseCodex
      : tool === 'hermes'
      ? parseHermes
      : parseOpenClaw;

  // Cap the fanout — parse in small batches to keep FD usage bounded.
  const out: SessionRecord[] = [];
  const CONCURRENCY = 16;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const parsed = await Promise.all(
      batch.map((f) =>
        parser(f).catch((err) => {
          console.warn(`[sessionScanner] ${tool} failed on ${f}:`, err?.message || err);
          return null;
        }),
      ),
    );
    for (const r of parsed) if (r) out.push(r);
  }
  return out;
}

export interface ScanResult {
  updatedAt: string;
  roots: Record<SessionTool, string[]>;
  sessions: SessionRecord[];
  counts: Record<SessionTool, number>;
}

export async function scanAllSessions(
  tools: SessionTool[] = ['claude', 'codex', 'hermes', 'openclaw'],
): Promise<ScanResult> {
  const all = await Promise.all(tools.map((t) => scanTool(t)));
  const flat = all.flat();

  // Sort newest-first by endTime (fall back to startTime).
  flat.sort((a, b) => {
    const ta = a.endTime || a.startTime || '';
    const tb = b.endTime || b.startTime || '';
    return tb.localeCompare(ta);
  });

  const counts = { claude: 0, codex: 0, hermes: 0, openclaw: 0 } as Record<
    SessionTool,
    number
  >;
  for (const s of flat) counts[s.tool]++;

  return {
    updatedAt: new Date().toISOString(),
    roots: toolRoots(),
    sessions: flat,
    counts,
  };
}

export async function findSessionByFile(
  tool: SessionTool,
  file: string,
): Promise<SessionRecord | null> {
  switch (tool) {
    case 'claude':
      return parseClaude(file);
    case 'codex':
      return parseCodex(file);
    case 'hermes':
      return parseHermes(file);
    case 'openclaw':
      return parseOpenClaw(file);
  }
}
