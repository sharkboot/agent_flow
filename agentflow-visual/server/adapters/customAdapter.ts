import { EventEmitter } from 'node:events';
import { CLIExecutor } from '../cli/executor.js';
import { buildCliInvocation } from '../cli/parser.js';
import type { StoredAgent } from '../cli/storage.js';
import type { AgentAdapter, ExecutionResult } from './unified.js';
import { estimateCost } from './unified.js';

/**
 * Generic passthrough adapter for `custom` and `agentflow` agent types
 * (and any other config the user cooks up). It delegates argv building to
 * the existing `buildCliInvocation` heuristic and executes via CLIExecutor.
 */
export class CustomAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'custom';
  private executor: CLIExecutor;

  constructor(private agent: StoredAgent) {
    super();
    this.executor = new CLIExecutor();
    this.executor.on('output', (chunk: string) => this.emit('data', chunk));
    this.executor.on('stderr', (chunk: string) => this.emit('error', chunk));
  }

  async execute(task: string, context?: Record<string, unknown>): Promise<ExecutionResult> {
    const cwd = (context?.projectPath as string) || this.agent.workingDir;
    const { args, stdin } = buildCliInvocation(this.agent, task);

    const t0 = Date.now();
    try {
      const res = await this.executor.execute(this.agent.cliCommand, args, {
        cwd,
        stdin,
      });
      return {
        success: res.status === 'completed',
        output: res.output,
        error: res.error || undefined,
        duration: res.duration,
        exitCode: res.exitCode,
        cost: estimateCost(res.output, task.length, this.agent.config?.model || 'unknown'),
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - t0,
      };
    }
  }

  abort(): void {
    this.executor.cancel();
  }
}
