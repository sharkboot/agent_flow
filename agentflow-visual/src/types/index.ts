// types/index.ts

export type AgentType = 'claude' | 'codex' | 'hermes' | 'agentflow' | 'custom';

export interface LocalAgent {
  id: string;
  name: string;
  description?: string;
  type: AgentType;

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

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ExecutionRequest {
  agentId: string;
  task: string;
  context?: Record<string, unknown>;
  stream?: boolean;
}

export interface ExecutionResult {
  id?: string;
  agentId?: string;
  status: 'running' | 'completed' | 'failed';
  output: string;
  error?: string;
  duration: number;
  tokens?: { input: number; output: number };
}

// Workflow types
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
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
}
