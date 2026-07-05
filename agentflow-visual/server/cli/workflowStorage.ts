import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DIR = path.resolve(__dirname, '../../config');
const WORKFLOWS_DIR = path.resolve(CONFIG_DIR, 'workflows');

export interface WorkflowNode {
  id: string;
  type: 'agent' | 'condition' | 'input' | 'output';
  position: { x: number; y: number };
  data: {
    label: string;
    agentId?: string;
    condition?: string;
    inputVar?: string;
    outputVar?: string;
    task?: string;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface StoredWorkflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export async function ensureWorkflowsDir(): Promise<void> {
  await fs.mkdir(WORKFLOWS_DIR, { recursive: true });
}

export function getWorkflowsDir(): string {
  return WORKFLOWS_DIR;
}

export async function listWorkflows(): Promise<StoredWorkflow[]> {
  await ensureWorkflowsDir();
  const files = await fs.readdir(WORKFLOWS_DIR);
  const workflows: StoredWorkflow[] = [];
  
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const txt = await fs.readFile(path.join(WORKFLOWS_DIR, f), 'utf8');
      workflows.push(JSON.parse(txt));
    } catch (err) {
      console.warn('bad workflow config', f, err);
    }
  }
  
  return workflows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getWorkflow(id: string): Promise<StoredWorkflow | null> {
  const file = path.join(WORKFLOWS_DIR, `${id}.json`);
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export async function saveWorkflow(workflow: StoredWorkflow): Promise<StoredWorkflow> {
  await ensureWorkflowsDir();
  const file = path.join(WORKFLOWS_DIR, `${workflow.id}.json`);
  await fs.writeFile(file, JSON.stringify(workflow, null, 2), 'utf8');
  return workflow;
}

export async function createWorkflow(
  data: Omit<StoredWorkflow, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<StoredWorkflow> {
  const now = new Date().toISOString();
  const workflow: StoredWorkflow = {
    ...data,
    id: `wf-${uuid().slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  return saveWorkflow(workflow);
}

export async function updateWorkflow(
  id: string,
  patch: Partial<StoredWorkflow>,
): Promise<StoredWorkflow | null> {
  const current = await getWorkflow(id);
  if (!current) return null;
  
  const updated: StoredWorkflow = {
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return saveWorkflow(updated);
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const file = path.join(WORKFLOWS_DIR, `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}
