import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';
import { syncAgentSkills, cleanupAgentSkills } from './skillsManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DIR = path.resolve(__dirname, '../../config/agents');

export interface StoredAgent {
  id: string;
  name: string;
  description?: string;
  type: string;
  cliCommand: string;
  cliArgs?: string[];
  workingDir?: string;
  config: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  };
  skills?: string[];
  mcpServers?: string[];
  createdAt: string;
  updatedAt: string;
}

export async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const items = await fs.readdir(CONFIG_DIR);
  if (items.length === 0) {
    const now = new Date().toISOString();
    const demo: StoredAgent = {
      id: 'agent-demo-echo',
      name: 'Echo (示例)',
      description: '通过 node 回显输入的调试用 Agent',
      type: 'custom',
      // node -e reads code from stdin via our parser's `looksLikeCode`
      // heuristic; for a plain-text task the parser passes it as a single
      // argv value. To keep the demo useful for any text, we use a small
      // script that just prints the last argv.
      cliCommand: 'node',
      cliArgs: ['-e', 'process.stdout.write(String(process.argv.pop()))'],
      config: { temperature: 0.7, maxTokens: 4096 },
      createdAt: now,
      updatedAt: now,
    };
    await saveAgent(demo);
  }
}

export function getConfigDir() {
  return CONFIG_DIR;
}

export async function listAgents(): Promise<StoredAgent[]> {
  await ensureConfigDir();
  const files = await fs.readdir(CONFIG_DIR);
  const agents: StoredAgent[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const txt = await fs.readFile(path.join(CONFIG_DIR, f), 'utf8');
      agents.push(JSON.parse(txt));
    } catch (err) {
      console.warn('bad agent config', f, err);
    }
  }
  return agents.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getAgent(id: string): Promise<StoredAgent | null> {
  const file = path.join(CONFIG_DIR, `${id}.json`);
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export async function saveAgent(agent: StoredAgent): Promise<StoredAgent> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const file = path.join(CONFIG_DIR, `${agent.id}.json`);
  await fs.writeFile(file, JSON.stringify(agent, null, 2), 'utf8');
  return agent;
}

export async function createAgent(
  data: Omit<StoredAgent, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<StoredAgent> {
  const now = new Date().toISOString();
  const agent: StoredAgent = {
    ...data,
    id: `agent-${uuid().slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  const saved = await saveAgent(agent);
  await syncAgentSkills(saved.id, saved.skills || []);
  return saved;
}

export async function updateAgent(
  id: string,
  patch: Partial<StoredAgent>,
): Promise<StoredAgent | null> {
  const current = await getAgent(id);
  if (!current) return null;
  const updated: StoredAgent = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  const saved = await saveAgent(updated);
  await syncAgentSkills(saved.id, saved.skills || []);
  return saved;
}

export async function deleteAgent(id: string): Promise<boolean> {
  const file = path.join(CONFIG_DIR, `${id}.json`);
  try {
    await fs.unlink(file);
    await cleanupAgentSkills(id);
    return true;
  } catch {
    return false;
  }
}
