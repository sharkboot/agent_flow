import { EventEmitter } from 'node:events';
import { CLIExecutor } from '../cli/executor.js';
import type { AgentAdapter, ExecutionResult } from './unified.js';
import { estimateCost } from './unified.js';

export interface CodexOptions {
  apiKey?: string;
  apiBase?: string;
  model?: string;
  workingDirectory?: string;
  timeout?: number;
  extraArgs?: string[];      // baseline args, e.g. ['exec', '--skip-git-repo-check']
  cliCommand?: string;
}

/**
 * Codex CLI adapter. The official binary (`codex`) supports non-interactive
 * runs with `codex exec <prompt>`; long prompts go via stdin to sidestep
 * shell-quoting on Windows.
 */
export class CodexAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'codex';
  private executor: CLIExecutor;
  private opts: Required<Omit<CodexOptions, 'apiKey' | 'apiBase'>> & {
    apiKey?: string;
    apiBase?: string;
  };

  constructor(options: CodexOptions = {}) {
    super();
    this.executor = new CLIExecutor();
    this.opts = {
      apiKey: options.apiKey,
      apiBase: options.apiBase,
      model: options.model ?? 'gpt-5-codex',
      workingDirectory: options.workingDirectory ?? process.cwd(),
      timeout: options.timeout ?? 3 * 60_000,
      extraArgs: options.extraArgs ?? ['exec', '--skip-git-repo-check'],
      cliCommand: options.cliCommand ?? 'codex',
    };

    this.executor.on('output', (chunk: string) => this.emit('data', chunk));
    this.executor.on('stderr', (chunk: string) => this.emit('error', chunk));
  }

  async execute(task: string, context?: Record<string, unknown>): Promise<ExecutionResult> {
    const cwd = (context?.projectPath as string) || this.opts.workingDirectory;
    const model = (context?.model as string) || this.opts.model;
    const args = [...this.opts.extraArgs];
    if (model) args.push('--model', model);

    // Special chars in prompts + Windows argv splitting = pain.
    // Send anything looking non-trivial via stdin.
    const useStdin = /[\s"'`\n;]/.test(task);
    if (!useStdin) args.push(task);

    const env: Record<string, string> = {};
    if (this.opts.apiKey) env.OPENAI_API_KEY = this.opts.apiKey;
    if (this.opts.apiBase) env.OPENAI_BASE_URL = this.opts.apiBase;

    const t0 = Date.now();
    const timer = setTimeout(() => this.executor.cancel(), this.opts.timeout);

    try {
      const res = await this.executor.execute(this.opts.cliCommand, args, {
        cwd,
        env,
        stdin: useStdin ? task : undefined,
      });
      return {
        success: res.status === 'completed',
        output: res.output,
        error: res.error || undefined,
        duration: res.duration,
        exitCode: res.exitCode,
        cost: estimateCost(res.output, task.length, model),
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - t0,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  abort(): void {
    this.executor.cancel();
  }

  async checkHealth(): Promise<boolean> {
    try {
      const r = await this.executor.execute(this.opts.cliCommand, ['--version']);
      return r.status === 'completed';
    } catch {
      return false;
    }
  }
}
