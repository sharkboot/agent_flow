import { Router } from 'express';
import path from 'node:path';
import { scanAllSessions, findSessionByFile, toolRoots, type SessionTool } from '../cli/sessionScanner.js';
import { readSessionMessages, trimForTransport } from '../cli/sessionReader.js';

export const sessionsRouter = Router();

// Simple in-memory cache — sessions rarely change during a page view.
let cached: { at: number; result: Awaited<ReturnType<typeof scanAllSessions>> } | null = null;
const TTL_MS = 15_000;

sessionsRouter.get('/', async (req, res) => {
  const nocache = req.query.refresh === '1';
  const now = Date.now();
  if (!nocache && cached && now - cached.at < TTL_MS) {
    res.json(cached.result);
    return;
  }
  try {
    const result = await scanAllSessions();
    cached = { at: now, result };
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

sessionsRouter.get('/roots', (_req, res) => {
  res.json(toolRoots());
});

// GET /api/sessions/detail?tool=claude&file=<abs-path>
// Refuses paths outside the tool's configured roots to avoid arbitrary
// filesystem reads via the API.
sessionsRouter.get('/detail', async (req, res) => {
  const tool = String(req.query.tool || '') as SessionTool;
  const file = String(req.query.file || '');
  if (!['claude', 'codex', 'hermes', 'openclaw'].includes(tool)) {
    res.status(400).json({ error: 'invalid tool' });
    return;
  }
  if (!file) {
    res.status(400).json({ error: 'missing file' });
    return;
  }
  const roots = toolRoots()[tool];
  const abs = path.resolve(file);
  const ok = roots.some((r) => abs.startsWith(path.resolve(r)));
  if (!ok) {
    res.status(403).json({ error: 'file outside configured roots' });
    return;
  }
  const rec = await findSessionByFile(tool, abs);
  if (!rec) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(rec);
});

// GET /api/sessions/messages?tool=&file=&limit=&maxBytes=
// Full message stream for the given record file. Refuses paths outside the
// tool's configured roots.
sessionsRouter.get('/messages', async (req, res) => {
  const tool = String(req.query.tool || '') as SessionTool;
  const file = String(req.query.file || '');
  const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : undefined;
  const maxBytes = Number(req.query.maxBytes) > 0 ? Number(req.query.maxBytes) : undefined;
  if (!['claude', 'codex', 'hermes', 'openclaw'].includes(tool)) {
    res.status(400).json({ error: 'invalid tool' });
    return;
  }
  if (!file) {
    res.status(400).json({ error: 'missing file' });
    return;
  }
  const roots = toolRoots()[tool];
  const abs = path.resolve(file);
  const ok = roots.some((r) => abs.startsWith(path.resolve(r)));
  if (!ok) {
    res.status(403).json({ error: 'file outside configured roots' });
    return;
  }
  try {
    const result = await readSessionMessages(tool, abs, { limit, maxBytes });
    res.json(trimForTransport(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
