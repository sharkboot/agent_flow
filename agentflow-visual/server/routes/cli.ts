import { Router } from 'express';
import { CLIExecutor } from '../cli/executor.js';
import { getAgent } from '../cli/storage.js';
import { buildCliInvocation } from '../cli/parser.js';

export const cliRouter = Router();

// Map of client-tracked cancels (single-executor last-execution model)
let currentExecutor: CLIExecutor | null = null;

cliRouter.post('/execute', async (req, res) => {
  const { agentId, task } = req.body as { agentId: string; task: string };

  const agent = await getAgent(agentId);
  if (!agent) {
    res.status(404).json({ error: `Agent ${agentId} not found` });
    return;
  }
  if (typeof task !== 'string') {
    res.status(400).json({ error: 'task must be a string' });
    return;
  }

  const executor = new CLIExecutor();
  currentExecutor = executor;

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (type: string, data: unknown) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  executor.on('output', (chunk: string) => send('output', chunk));
  executor.on('stderr', (chunk: string) => send('error', chunk));

  const { args, stdin } = buildCliInvocation(agent, task);

  send('output', ''); // prime the stream
  send('output', ''); // (some proxies buffer the first byte)

  try {
    const result = await executor.execute(agent.cliCommand, args, {
      cwd: agent.workingDir,
      stdin,
    });
    send('complete', {
      id: `exec-${Date.now()}`,
      agentId: agent.id,
      status: result.status,
      output: result.output,
      error: result.error,
      duration: result.duration,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send('error', `启动失败: ${msg}`);
    send('complete', {
      agentId: agent.id,
      status: 'failed',
      output: '',
      error: msg,
      duration: 0,
    });
  } finally {
    if (currentExecutor === executor) currentExecutor = null;
    res.end();
  }
});

cliRouter.post('/cancel', (_req, res) => {
  if (currentExecutor) {
    currentExecutor.cancel();
    currentExecutor = null;
    res.json({ success: true, canceled: true });
  } else {
    res.json({ success: true, canceled: false });
  }
});
