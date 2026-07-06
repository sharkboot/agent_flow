// Unified adapter contract — every AI-agent CLI adapter implements this.
//
// The design mirrors the guide in `typescript_cli_integration_guide.md`,
// but adapts a few conventions to the shape of this project:
//
//   * We reuse the battle-tested `CLIExecutor` (Windows shim, GBK fallback,
//     stdin piping, cancellation) instead of every adapter re-implementing
//     child_process handling. Adapters only decide *what* to invoke.
//   * `context` carries workflow/session extras that adapters can splice
//     into the final prompt or CLI args (e.g. `context.projectPath`,
//     `context.skills`, `context.model`).
//   * Adapters may emit streaming chunks via events for future SSE routes.
import { EventEmitter } from 'node:events';

export interface CostInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  model: string;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  cost?: CostInfo;
  duration: number;
  error?: string;
  exitCode?: number | null;
}

export interface AgentAdapterEvents {
  'data': [string];
  'error': [string];
}

export interface AgentAdapter extends EventEmitter {
  readonly type: string;
  execute(task: string, context?: Record<string, unknown>): Promise<ExecutionResult>;
  abort(): void;
  /** Best-effort probe. Returns true when the CLI can be located. */
  checkHealth?(): Promise<boolean>;
}

// Coarse cost estimator — 1 token ≈ 4 chars, $0.003 / 1k tokens each way.
// Replace with a proper tokenizer per adapter later.
export function estimateCost(output: string, inputChars = 0, model = 'unknown'): CostInfo {
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(output.length / 4);
  const totalTokens = inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costCents: Math.round(totalTokens * 0.003 * 100) / 100, // fractional cents ok
    model,
  };
}
