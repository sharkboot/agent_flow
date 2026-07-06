import type { StoredAgent } from '../cli/storage.js';
import { ClaudeCodeAdapter } from './claudeCodeAdapter.js';
import { CodexAdapter } from './codexAdapter.js';
import { HermesAdapter } from './hermesAdapter.js';
import { CustomAdapter } from './customAdapter.js';
import type { AgentAdapter, ExecutionResult } from './unified.js';

// -----------------------------------------------------------------------------
// AgentManager — one lookup by `agentId` returns a live adapter. The manager
// caches adapters per agent-id so consecutive calls reuse the same CLIExecutor
// event wiring; `refresh(agentId)` drops a stale entry when the config is
// edited.
//
// The manager deliberately does NOT import from `storage.ts` — that would
// create a cycle (storage → manager → storage). Instead a resolver is
// registered at server bootstrap so callers can still say
// `agentManager.execute(agentId, task)` without threading the loader
// through every call site.
// -----------------------------------------------------------------------------

export type AgentResolver = (agentId: string) => Promise<StoredAgent | null>;

export class AgentManager {
  private adapters = new Map<string, AgentAdapter>();
  private resolver: AgentResolver | null = null;

  /** Called once at server boot with a fn that maps id → StoredAgent. */
  setResolver(fn: AgentResolver): void {
    this.resolver = fn;
  }

  /** Build (or reuse) an adapter for the given agent config. */
  fromAgent(agent: StoredAgent): AgentAdapter {
    const cached = this.adapters.get(agent.id);
    if (cached) return cached;
    const adapter = this.build(agent);
    this.adapters.set(agent.id, adapter);
    return adapter;
  }

  /** Look the agent up by id via the registered resolver. */
  async get(agentId: string): Promise<AgentAdapter> {
    const cached = this.adapters.get(agentId);
    if (cached) return cached;
    if (!this.resolver) throw new Error('AgentManager: resolver not registered');
    const agent = await this.resolver(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    return this.fromAgent(agent);
  }

  /** Force rebuild on next `get()` — call after updating agent config. */
  refresh(agentId: string): void {
    const a = this.adapters.get(agentId);
    if (a) {
      try { a.abort(); } catch { /* ignore */ }
      this.adapters.delete(agentId);
    }
  }

  async execute(
    agentId: string,
    task: string,
    context?: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const adapter = await this.get(agentId);
    return adapter.execute(task, context);
  }

  abort(agentId: string): void {
    this.adapters.get(agentId)?.abort();
  }

  private build(agent: StoredAgent): AgentAdapter {
    const commonCtx = {
      apiKey: readEnvKey(agent.type),
      apiBase: readEnvBase(agent.type) || (agent.config as { apiBase?: string })?.apiBase,
      model: agent.config?.model,
      workingDirectory: agent.workingDir,
    };

    switch (agent.type) {
      case 'claude':
        return new ClaudeCodeAdapter({
          ...commonCtx,
          cliCommand: agent.cliCommand || 'claude',
          extraArgs: agent.cliArgs && agent.cliArgs.length
            ? agent.cliArgs
            : ['--print', '--dangerously-skip-permissions'],
        });
      case 'codex':
        return new CodexAdapter({
          ...commonCtx,
          cliCommand: agent.cliCommand || 'codex',
          extraArgs: agent.cliArgs && agent.cliArgs.length
            ? agent.cliArgs
            : ['exec', '--skip-git-repo-check'],
        });
      case 'hermes':
        return new HermesAdapter({
          ...commonCtx,
          cliCommand: agent.cliCommand || 'hermes',
          extraArgs: agent.cliArgs ?? [],
        });
      // 'agentflow', 'custom' and any unknown type — fall back to the
      // freeform CustomAdapter which honors user-typed argv.
      default:
        return new CustomAdapter(agent);
    }
  }
}

// Pick the right env var per provider so users don't need to duplicate keys.
function readEnvKey(type: string): string | undefined {
  switch (type) {
    case 'claude': return process.env.ANTHROPIC_API_KEY;
    case 'codex':  return process.env.OPENAI_API_KEY;
    case 'hermes': return process.env.HERMES_API_KEY;
    default:       return undefined;
  }
}
function readEnvBase(type: string): string | undefined {
  switch (type) {
    case 'claude': return process.env.ANTHROPIC_BASE_URL;
    case 'codex':  return process.env.OPENAI_BASE_URL;
    default:       return undefined;
  }
}

// Singleton — one per server. Sufficient because CLIExecutor is per-adapter
// and callers only need one manager to route through.
export const agentManager = new AgentManager();
