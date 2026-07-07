import { EventEmitter } from 'node:events';
import { CLIExecutor } from '../cli/executor.js';
import type { AgentAdapter, ExecutionResult } from './unified.js';
import { estimateCost } from './unified.js';

export interface HermesOptions {
  pythonPath?: string;         // 'python3' or full path
  hermesModule?: string;        // 'hermes' (default) — passed to `python -m`
  cliCommand?: string;          // 'hermes' if a wrapper exists on PATH
  model?: string;
  apiKey?: string;
  workingDirectory?: string;
  timeout?: number;
  extraArgs?: string[];
}

/**
 * Hermes adapter.
 *
 * Hermes ships primarily as a Python package. We support two invocation
 * modes and pick automatically:
 *
 *   1. If `cliCommand` is set (default 'hermes') and available on PATH,
 *      call `hermes <args> --once` with the task on stdin.
 *   2. Otherwise fall back to `python -m hermes ...`.
 *
 * The guide's long-lived RPC/session variant is heavier and requires
 * extra plumbing; the visual UI only needs one-shot execution today, so
 * we mirror the `executeOnce` shape.
 */
export class HermesAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'hermes';
  private executor: CLIExecutor;
  private opts: Required<Omit<HermesOptions, 'apiKey'>> & { apiKey?: string };

  constructor(options: HermesOptions = {}) {
    super();
    this.executor = new CLIExecutor();
    this.opts = {
      pythonPath: options.pythonPath ?? (process.platform === 'win32' ? 'python' : 'python3'),
      hermesModule: options.hermesModule ?? 'hermes',
      cliCommand: options.cliCommand ?? 'hermes',
      model: options.model ?? 'qwen-3.5-122b',
      apiKey: options.apiKey,
      workingDirectory: options.workingDirectory ?? process.cwd(),
      timeout: options.timeout ?? 10 * 60_000,
      extraArgs: options.extraArgs ?? [],
    };

    this.executor.on('output', (chunk: string) => this.emit('data', chunk));
    this.executor.on('stderr', (chunk: string) => this.emit('error', chunk));
  }

  async execute(task: string, context?: Record<string, unknown>): Promise<ExecutionResult> {
    const cwd = (context?.projectPath as string) || this.opts.workingDirectory;
    const model = (context?.model as string) || this.opts.model;

    const env: Record<string, string> = {};
    if (this.opts.apiKey) env.HERMES_API_KEY = this.opts.apiKey;

    const t0 = Date.now();
    const timer = setTimeout(() => this.executor.cancel(), this.opts.timeout);

    // Prefer the wrapper binary when available; otherwise `python -m hermes`.
    const cliOk = await this.checkHealth();
    const cmd = cliOk ? this.opts.cliCommand : this.opts.pythonPath;

    // Don't duplicate flags the user already put in extraArgs. The frontend
    // preset for hermes includes `--once`, and if a caller explicitly picked
    // a model via extraArgs (`--model foo`) we let that win over `opts.model`.
    const hasFlag = (flag: string) => this.opts.extraArgs.includes(flag);
    const modelArgs = hasFlag('--model') || !model ? [] : ['--model', model];
    const onceArgs = hasFlag('--once') ? [] : ['--once'];

    const args = cliOk
      ? [...this.opts.extraArgs, ...modelArgs, ...onceArgs]
      : ['-m', this.opts.hermesModule, ...this.opts.extraArgs, ...modelArgs, ...onceArgs];

    try {
      // Pipe the task on stdin — Hermes prompts can be long-form.
      const res = await this.executor.execute(cmd, args, {
        cwd,
        env,
        stdin: task,
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
