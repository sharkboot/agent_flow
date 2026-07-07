import type { StoredAgent } from './storage.js';

export interface Invocation {
  args: string[];
  stdin?: string;
}

/**
 * Build final CLI args + optional stdin for a given task.
 *
 * Design rules:
 * - We NEVER route through cmd.exe. Any characters that would need shell
 *   quoting (`;`, `"`, `'`, `\n`, unicode) go via stdin, not argv.
 * - For known interpreters (node/python), if the task looks like code,
 *   we pipe it into stdin. Otherwise we pass it as a single argv value.
 */
export function buildCliInvocation(
  agent: StoredAgent,
  task: string,
): Invocation {
  const extra = agent.cliArgs ?? [];
  const cmd = (agent.cliCommand || '').toLowerCase();
  const looksLikeCode =
    /[\n;=(){}[\]]/.test(task) || task.includes('import ') || task.includes('console.');

  // Interpreter shortcuts — pipe code via stdin to dodge shell quoting.
  if ((cmd === 'python' || cmd === 'python3') && looksLikeCode) {
    return { args: [...extra.filter((a) => a !== '-c')], stdin: task };
  }
  if (cmd === 'node' && looksLikeCode) {
    return { args: [...extra.filter((a) => a !== '-e')], stdin: task };
  }

  // Provider-specific styles.
  // NOTE: `claude` / `codex` / `hermes` types never reach this fn — the
  // AgentManager routes them to dedicated adapters (which own their own arg
  // building). The branches used to exist here as a fallback; they were dead
  // code that mis-suggested this is where you'd tune those providers.
  if (agent.type === 'agentflow') {
    const args = [...extra, 'agent', 'execute', agent.id, '--task', task];
    if (agent.config?.model) args.push('--model', agent.config.model);
    return { args };
  }

  // Custom / fallback: task as one argv value. When shell:false the whole
  // string reaches the program intact — no `;` splitting, no quote stripping.
  // Empty task means: just run cliArgs as-is (useful for `git --version`).
  //
  // We deliberately do NOT append `--model` here: `custom` covers arbitrary
  // CLIs (grep, node -e, a shell script…) and there's no universal flag for
  // "which model". The user typed the args they want; we respect that.
  // The chosen `config.model` still reaches `estimateCost()` in the adapter
  // and can be read by the child via the `AGENTFLOW_MODEL` env var (set in
  // CustomAdapter) for scripts that want it.
  return { args: task === '' ? [...extra] : [...extra, task] };
}
