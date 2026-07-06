import { Router } from 'express';
import { getAgent } from '../cli/storage.js';
import { agentManager } from '../adapters/agentManager.js';
import {
  appendMessages,
  createSession,
  deleteSession,
  listSessions,
  readMessages,
} from '../cli/agentHistory.js';

export const cliRouter = Router();

// The last-in-wins model still applies — we track which agentId is currently
// running so /cancel knows what to abort.
let currentAgentId: string | null = null;

cliRouter.post('/execute', async (req, res) => {
  const { agentId, sessionId, task, context } = req.body as {
    agentId: string;
    sessionId?: string;
    task: string;
    context?: Record<string, unknown>;
  };

  const agent = await getAgent(agentId);
  if (!agent) {
    res.status(404).json({ error: `Agent ${agentId} not found` });
    return;
  }
  if (typeof task !== 'string') {
    res.status(400).json({ error: 'task must be a string' });
    return;
  }

  // If the client didn't provide a sessionId, spin up a fresh session so the
  // message still lands somewhere reachable in the sidebar.
  let activeSessionId = sessionId;
  if (!activeSessionId) {
    const created = await createSession(agentId);
    activeSessionId = created.id;
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (type: string, data: unknown) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  const adapter = agentManager.fromAgent(agent);
  currentAgentId = agentId;

  // Buffer stdout chunks so we can persist the final assistant reply even
  // when the adapter only returns a summary.
  let streamed = '';
  const onData = (chunk: string) => {
    streamed += chunk;
    send('output', chunk);
  };
  const onError = (chunk: string) => send('error', chunk);
  adapter.on('data', onData);
  adapter.on('error', onError);

  // Tell the client which session this run belongs to so it can navigate
  // to it after a "new chat" auto-create.
  send('session', { sessionId: activeSessionId });
  // Prime the stream so proxies flush their first byte.
  send('output', '');

  const userTimestamp = new Date().toISOString();

  try {
    const result = await adapter.execute(task, context);
    const assistantText = (result.output && result.output.trim())
      ? result.output
      : streamed;
    const completedAt = new Date().toISOString();

    try {
      await appendMessages(agent.id, activeSessionId, [
        {
          id: `msg-${Date.now()}-u`,
          role: 'user',
          content: task,
          timestamp: userTimestamp,
        },
        {
          id: `msg-${Date.now()}-a`,
          role: 'assistant',
          content: assistantText,
          timestamp: completedAt,
          meta: {
            status: result.success ? 'completed' : 'failed',
            duration: result.duration,
            error: result.error,
          },
        },
      ]);
    } catch (persistErr) {
      const msg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      send('error', `[history] 写入失败: ${msg}`);
    }

    send('complete', {
      id: `exec-${Date.now()}`,
      agentId: agent.id,
      sessionId: activeSessionId,
      status: result.success ? 'completed' : 'failed',
      output: result.output,
      error: result.error,
      duration: result.duration,
      cost: result.cost,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send('error', `执行失败: ${msg}`);

    try {
      await appendMessages(agent.id, activeSessionId, [
        {
          id: `msg-${Date.now()}-u`,
          role: 'user',
          content: task,
          timestamp: userTimestamp,
        },
        {
          id: `msg-${Date.now()}-a`,
          role: 'assistant',
          content: streamed,
          timestamp: new Date().toISOString(),
          meta: { status: 'failed', error: msg },
        },
      ]);
    } catch {
      /* history write failed; user-visible error already sent */
    }

    send('complete', {
      agentId: agent.id,
      sessionId: activeSessionId,
      status: 'failed',
      output: '',
      error: msg,
      duration: 0,
    });
  } finally {
    adapter.off('data', onData);
    adapter.off('error', onError);
    if (currentAgentId === agentId) currentAgentId = null;
    res.end();
  }
});

cliRouter.post('/cancel', (_req, res) => {
  if (currentAgentId) {
    agentManager.abort(currentAgentId);
    const wasRunning = currentAgentId;
    currentAgentId = null;
    res.json({ success: true, canceled: true, agentId: wasRunning });
  } else {
    res.json({ success: true, canceled: false });
  }
});

// ---------------------------------------------------------------------------
// Per-agent session lifecycle
// ---------------------------------------------------------------------------

// List every session under an agent, newest first.
cliRouter.get('/history/:agentId/sessions', async (req, res) => {
  const { agentId } = req.params;
  const agent = await getAgent(agentId);
  if (!agent) {
    res.status(404).json({ error: `Agent ${agentId} not found` });
    return;
  }
  try {
    const sessions = await listSessions(agentId);
    res.json({ agentId, sessions });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Create a new empty session.
cliRouter.post('/history/:agentId/sessions', async (req, res) => {
  const { agentId } = req.params;
  const agent = await getAgent(agentId);
  if (!agent) {
    res.status(404).json({ error: `Agent ${agentId} not found` });
    return;
  }
  try {
    const session = await createSession(agentId);
    res.json(session);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Full messages for one session.
cliRouter.get('/history/:agentId/sessions/:sessionId', async (req, res) => {
  const { agentId, sessionId } = req.params;
  const agent = await getAgent(agentId);
  if (!agent) {
    res.status(404).json({ error: `Agent ${agentId} not found` });
    return;
  }
  try {
    const messages = await readMessages(agentId, sessionId);
    res.json({ agentId, sessionId, count: messages.length, messages });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Delete a single session.
cliRouter.delete('/history/:agentId/sessions/:sessionId', async (req, res) => {
  const { agentId, sessionId } = req.params;
  try {
    await deleteSession(agentId, sessionId);
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});
