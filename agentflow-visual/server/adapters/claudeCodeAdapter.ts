import { EventEmitter } from 'node:events';
import { CLIExecutor } from '../cli/executor.js';
import type { AgentAdapter, ExecutionResult } from './unified.js';
import { estimateCost } from './unified.js';

export interface ClaudeCodeOptions {
  apiKey?: string;
  apiBase?: string;
  model?: string;
  workingDirectory?: string;
  timeout?: number;
  extraArgs?: string[];      // baseline args merged before task
  cliCommand?: string;       // default: 'claude'
}

/**
 * Claude Code adapter — spawns the `claude` CLI with `--print` and prompts
 * on argv. We reuse the shared CLIExecutor so we get Windows shim handling
 * (claude installs as `claude.cmd`) and encoding autodetection.
 */
export class ClaudeCodeAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'claude_code';
  private executor: CLIExecutor;
  private opts: Required<Omit<ClaudeCodeOptions, 'apiKey' | 'apiBase'>> & {
    apiKey?: string;
    apiBase?: string;
  };

  constructor(options: ClaudeCodeOptions = {}) {
    super();
    this.executor = new CLIExecutor();
    this.opts = {
      apiKey: options.apiKey,
      apiBase: options.apiBase,
      model: options.model ?? 'claude-sonnet-5',
      workingDirectory: options.workingDirectory ?? process.cwd(),
      timeout: options.timeout ?? 5 * 60_000,
      extraArgs: options.extraArgs ?? ['--print', '--dangerously-skip-permissions'],
      cliCommand: options.cliCommand ?? 'claude',
    };

    // Forward streaming chunks to consumers.
    this.executor.on('output', (chunk: string) => this.emit('data', chunk));
    this.executor.on('stderr', (chunk: string) => this.emit('error', chunk));
  }

  async execute(task: string, context?: Record<string, unknown>): Promise<ExecutionResult> {
    const prompt = this.buildEnhancedPrompt(task, context);
    // The Claude CLI expects `claude [flags] "<prompt>"` — the prompt MUST be
    // the last positional argument. Previously we pushed the prompt first and
    // then appended `--model X`, which meant the flag was silently absorbed by
    // the prompt (or dropped by the CLI) and the user's model choice never
    // reached the model. Build flags first, prompt last.
    const model = (context?.model as string) || this.opts.model;
    const args = [...this.opts.extraArgs];
    if (model) args.push('--model', model);
    args.push(prompt);

    const env: Record<string, string> = {};
    if (this.opts.apiKey) env.ANTHROPIC_API_KEY = this.opts.apiKey;
    if (this.opts.apiBase) env.ANTHROPIC_BASE_URL = this.opts.apiBase;

    const cwd = (context?.projectPath as string) || this.opts.workingDirectory;

    // Deadline via cancel() — CLIExecutor already handles kill semantics.
    const t0 = Date.now();
    const timer = setTimeout(() => this.executor.cancel(), this.opts.timeout);

    try {
      const res = await this.executor.execute(this.opts.cliCommand, args, { cwd, env });
      return {
        success: res.status === 'completed',
        output: res.output,
        error: res.error || undefined,
        duration: res.duration,
        exitCode: res.exitCode,
        cost: estimateCost(res.output, prompt.length, model),
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

  private buildEnhancedPrompt(task: string, context?: Record<string, unknown>): string {
    let p = task;
    if (context?.skills) {
      const s = Array.isArray(context.skills) ? context.skills.join(', ') : String(context.skills);
      if (s) p = `Available skills: ${s}\n\n${p}`;
    }
    if (context?.projectPath) {
      p = `Working directory: ${context.projectPath}\n\n${p}`;
    }
    if (context?.systemPrompt) {
      p = `${String(context.systemPrompt)}\n\n${p}`;
    }
    return p;
  }
}
