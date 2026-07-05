import type { ExecutionResult } from '@/types';

export class CLIRunner {
  private controller: AbortController | null = null;

  async execute(
    agentId: string,
    task: string,
    onOutput?: (chunk: string) => void,
    onError?: (chunk: string) => void,
  ): Promise<ExecutionResult> {
    this.controller = new AbortController();

    const response = await fetch('/api/cli/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, task }),
      signal: this.controller.signal,
    });

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: ExecutionResult | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on SSE record separator
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        try {
          const event = JSON.parse(payload) as {
            type: 'output' | 'error' | 'complete';
            data: unknown;
          };
          if (event.type === 'output' && onOutput) {
            onOutput(String(event.data));
          } else if (event.type === 'error' && onError) {
            onError(String(event.data));
          } else if (event.type === 'complete') {
            finalResult = event.data as ExecutionResult;
          }
        } catch (err) {
          console.warn('bad SSE frame', payload, err);
        }
      }
    }

    if (!finalResult) {
      throw new Error('Execution did not complete');
    }
    return finalResult;
  }

  cancel(): void {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
    fetch('/api/cli/cancel', { method: 'POST' }).catch(() => {});
  }
}

export const cliRunner = new CLIRunner();
