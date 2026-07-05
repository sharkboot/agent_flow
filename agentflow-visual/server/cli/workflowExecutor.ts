import { EventEmitter } from 'node:events';
import type { WorkflowNode, WorkflowEdge, StoredWorkflow } from './workflowStorage.js';
import { getAgent } from './storage.js';
import { CLIExecutor } from './executor.js';

export interface ExecutionContext {
  variables: Record<string, string>;
  outputs: Record<string, string>;
}

export interface ExecutionStep {
  nodeId: string;
  nodeType?: string;
  label?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: string;
  error?: string;
  durationMs?: number;
  startedAt?: string;
}

export interface WorkflowExecutorEvents {
  'step:start': [ExecutionStep];
  'step:complete': [ExecutionStep];
  'step:error': [ExecutionStep];
  'complete': [ExecutionContext];
  'error': [Error];
}

export class WorkflowExecutor extends EventEmitter {
  private executor: CLIExecutor;
  private context: ExecutionContext = { variables: {}, outputs: {} };
  private steps: Map<string, ExecutionStep> = new Map();

  constructor() {
    super();
    this.executor = new CLIExecutor();
  }

  async execute(
    workflow: StoredWorkflow,
    inputs: Record<string, string>,
  ): Promise<ExecutionContext> {
    this.context = {
      variables: { ...inputs },
      outputs: {},
    };

    // Build execution order using topological sort
    const executionOrder = this.buildExecutionOrder(workflow.nodes, workflow.edges);
    
    for (const nodeId of executionOrder) {
      const node = workflow.nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      try {
        await this.executeNode(node, workflow.nodes, workflow.edges);
      } catch (err) {
        const step: ExecutionStep = {
          nodeId,
          status: 'failed',
          error: String(err),
        };
        this.steps.set(nodeId, step);
        this.emit('step:error', step);
        this.emit('error', err as Error);
        throw err;
      }
    }

    this.emit('complete', this.context);
    return this.context;
  }

  private buildExecutionOrder(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
  ): string[] {
    // Find input nodes (starting points)
    const inputNodes = nodes.filter((n) => n.type === 'input');
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      // Visit all predecessors first
      const predecessors = edges.filter((e) => e.target === nodeId);
      for (const pred of predecessors) {
        visit(pred.source);
      }

      order.push(nodeId);
    };

    // Start from input nodes
    for (const node of inputNodes) {
      visit(node.id);
    }

    // Add any disconnected nodes
    for (const node of nodes) {
      visit(node.id);
    }

    return order;
  }

  private async executeNode(
    node: WorkflowNode,
    allNodes: WorkflowNode[],
    edges: WorkflowEdge[],
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    const startTs = Date.now();
    let step: ExecutionStep = {
      nodeId: node.id,
      nodeType: node.type,
      label: node.data?.label,
      status: 'running',
      startedAt,
    };
    this.steps.set(node.id, step);
    this.emit('step:start', step);

    try {
      let output = '';

      switch (node.type) {
        case 'input': {
          // Input node: set variable from input or default
          const inputVar = node.data.inputVar || 'input';
          const value = this.context.variables[inputVar] || '';
          this.context.outputs[node.id] = value;
          output = `Set ${inputVar} = "${value}"`;
          break;
        }

        case 'agent': {
          // Agent node: execute agent with input
          const agent = await getAgent(node.data.agentId || '');
          if (!agent) {
            throw new Error(`Agent not found: ${node.data.agentId}`);
          }

          // Get input from connected nodes
          const inputEdge = edges.find((e) => e.target === node.id);
          let task = node.data.task || '';
          
          if (inputEdge) {
            const inputValue = this.context.outputs[inputEdge.source] || '';
            // If task is empty, use input as task
            if (!task) {
              task = inputValue;
            } else {
              // Replace variables in task
              task = this.replaceVariables(task, { input: inputValue });
            }
          }

          if (!task) {
            throw new Error(`No task provided for agent: ${node.id}`);
          }

          // Build CLI command
          const cliArgs = [...(agent.cliArgs || []), task];
          const result = await this.executor.execute(
            agent.cliCommand,
            cliArgs,
            { cwd: agent.workingDir },
          );

          output = result.output;
          if (result.status === 'failed') {
            throw new Error(`Agent execution failed: ${result.error}`);
          }

          this.context.outputs[node.id] = output;
          break;
        }

        case 'condition': {
          // Condition node: evaluate condition and set output
          const condition = node.data.condition || '';
          const inputEdge = edges.find((e) => e.target === node.id);
          let inputValue = '';
          
          if (inputEdge) {
            inputValue = this.context.outputs[inputEdge.source] || '';
          }

          const result = this.evaluateCondition(condition, inputValue);
          this.context.outputs[node.id] = result ? 'true' : 'false';
          output = `Condition "${condition}" = ${result}`;
          
          // Find and mark the appropriate outgoing edge
          const trueEdge = edges.find((e) => e.source === node.id && e.label === 'true');
          const falseEdge = edges.find((e) => e.source === node.id && e.label === 'false');
          
          if (result && trueEdge) {
            this.context.outputs[node.id] = `goto:${trueEdge.target}`;
          } else if (!result && falseEdge) {
            this.context.outputs[node.id] = `goto:${falseEdge.target}`;
          }
          break;
        }

        case 'output': {
          // Output node: capture final output
          const inputEdge = edges.find((e) => e.target === node.id);
          if (inputEdge) {
            output = this.context.outputs[inputEdge.source] || '';
          }
          this.context.outputs[node.id] = output;
          break;
        }

        default:
          output = `Unknown node type: ${node.type}`;
      }

      step = {
        nodeId: node.id,
        nodeType: node.type,
        label: node.data?.label,
        status: 'completed',
        output,
        durationMs: Date.now() - startTs,
        startedAt,
      };
      this.steps.set(node.id, step);
      this.emit('step:complete', step);
    } catch (err) {
      step = {
        nodeId: node.id,
        nodeType: node.type,
        label: node.data?.label,
        status: 'failed',
        error: String(err),
        durationMs: Date.now() - startTs,
        startedAt,
      };
      this.steps.set(node.id, step);
      this.emit('step:error', step);
      throw err;
    }
  }

  private evaluateCondition(condition: string, input: string): boolean {
    // Simple condition evaluation
    // Examples: "contains:error", "empty", "not_empty", "equals:value"
    
    const [op, ...args] = condition.split(':');
    const arg = args.join(':');
    
    switch (op.toLowerCase()) {
      case 'contains':
        return input.includes(arg);
      case 'empty':
        return !input || input.trim() === '';
      case 'not_empty':
        return !!(input && String(input).trim() !== '');
      case 'equals':
        return input === arg;
      case 'starts_with':
        return input.startsWith(arg);
      case 'ends_with':
        return input.endsWith(arg);
      case 'regex':
        return new RegExp(arg).test(input);
      default:
        return Boolean(input);
    }
  }

  private replaceVariables(
    text: string,
    values: Record<string, string>,
  ): string {
    let result = text;
    for (const [key, value] of Object.entries(values)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  cancel(): void {
    this.executor.cancel();
  }
}
