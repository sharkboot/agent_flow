import express from 'express';
import cors from 'cors';
import { cliRouter } from './routes/cli.js';
import { configRouter } from './routes/config.js';
import { workflowRouter } from './routes/workflow.js';
import { sessionsRouter } from './routes/sessions.js';
import { ensureConfigDir, getConfigDir, getAgent } from './cli/storage.js';
import { agentManager } from './adapters/agentManager.js';

async function main() {
  await ensureConfigDir();

  // Wire the AgentManager once — subsequent lookups go through it.
  agentManager.setResolver(getAgent);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/cli', cliRouter);
  app.use('/api/config', configRouter);
  app.use('/api/workflows', workflowRouter);
  app.use('/api/sessions', sessionsRouter);

  const PORT = Number(process.env.PORT || 3001);
  app.listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`[agentflow-visual] listening on http://localhost:${PORT}\n`);
    process.stdout.write(`[agentflow-visual] config dir: ${getConfigDir()}\n`);
  });
}

main().catch((err) => {
  process.stderr.write(`[agentflow-visual] fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
