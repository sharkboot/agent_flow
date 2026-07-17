import { Router } from 'express';
import {
  listAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  getConfigDir,
} from '../cli/storage.js';
import {
  listAvailableSkills,
  getAgentSkills,
  getCodexSkillsDir,
  getSkillsDir,
} from '../cli/skillsManager.js';
import { agentManager } from '../adapters/agentManager.js';
import { listPresets } from '../adapters/acp/presets.js';
import {
  listTerminalPresets,
  createTerminalPreset,
  deleteTerminalPreset,
} from '../cli/terminalPresets.js';

export const configRouter = Router();

configRouter.get('/info', (_req, res) => {
  res.json({
    version: '0.1.0',
    configDir: getConfigDir(),
    supported: ['claude', 'codex', 'hermes', 'agentflow', 'custom', 'acp'],
    platform: process.platform,
  });
});

/** ACP built-in presets — used by the AgentForm ACP dropdown. */
configRouter.get('/acp-presets', (_req, res) => {
  res.json({ presets: listPresets() });
});

configRouter.get('/agents', async (_req, res) => {
  const agents = await listAgents();
  res.json(agents);
});

configRouter.post('/agents', async (req, res) => {
  const body = req.body;
  if (!body?.name || !body?.cliCommand) {
    res.status(400).json({ error: 'name and cliCommand are required' });
    return;
  }
  const agent = await createAgent(body);
  res.status(201).json(agent);
});

configRouter.put('/agents/:id', async (req, res) => {
  const updated = await updateAgent(req.params.id, req.body ?? {});
  if (!updated) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  res.json(updated);
});

configRouter.delete('/agents/:id', async (req, res) => {
  const ok = await deleteAgent(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  res.json({ success: true });
});

// Skills management endpoints
configRouter.get('/skills', async (_req, res) => {
  const skills = await listAvailableSkills();
  res.json({
    codexSkillsDir: getCodexSkillsDir(),
    skillsDir: getSkillsDir(),
    availableSkills: skills,
  });
});

configRouter.get('/agents/:id/skills', async (req, res) => {
  const skills = await getAgentSkills(req.params.id);
  res.json({ agentId: req.params.id, linkedSkills: skills });
});

// GET /api/config/agents/:id/health — best-effort CLI probe
// (whether the configured `cliCommand` can be located and reports a version).
configRouter.get('/agents/:id/health', async (req, res) => {
  try {
    const adapter = await agentManager.get(req.params.id);
    const ok = adapter.checkHealth ? await adapter.checkHealth() : true;
    res.json({ agentId: req.params.id, healthy: ok, type: adapter.type });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Terminal presets — saved shell launch configs (shell + cwd + command).
// GET  /api/config/terminal-presets           → list
// POST /api/config/terminal-presets           → create { name, shell?, cwd?, command? }
// DEL  /api/config/terminal-presets/:id       → delete
// ---------------------------------------------------------------------------
configRouter.get('/terminal-presets', async (_req, res) => {
  const presets = await listTerminalPresets();
  res.json({ presets });
});

configRouter.post('/terminal-presets', async (req, res) => {
  const body = req.body ?? {};
  if (!body.name || typeof body.name !== 'string') {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const preset = await createTerminalPreset({
    name: body.name,
    shell: body.shell,
    cwd: body.cwd,
    command: body.command,
  });
  res.status(201).json(preset);
});

configRouter.delete('/terminal-presets/:id', async (req, res) => {
  const ok = await deleteTerminalPreset(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'preset not found' });
    return;
  }
  res.json({ success: true });
});
