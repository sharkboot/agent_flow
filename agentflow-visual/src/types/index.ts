// types/index.ts

export type AgentType = 'claude' | 'codex' | 'hermes' | 'agentflow' | 'custom' | 'acp';

/** Structured event emitted by ACP adapters (agent_message_chunk, tool_call, …). */
export interface AcpEvent {
  kind:
    | 'chunk'
    | 'thinking'
    | 'tool_call'
    | 'tool_update'
    | 'plan'
    | 'permission_request'
    | 'error'
    | 'raw';
  updateType?: string;
  content?: unknown;
  timestamp: string;
}

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
    /** For ACP-type agents: which built-in preset (claude-code / codex / opencode / custom). */
    acpPreset?: string;
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
  /** Optional metadata attached by the server on assistant messages. */
  meta?: {
    status?: 'completed' | 'failed';
    duration?: number;
    error?: string;
    exitCode?: number | null;
    acpEvents?: AcpEvent[];
  };
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
