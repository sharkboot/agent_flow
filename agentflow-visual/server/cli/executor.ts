import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { spawn as nodeSpawn } from 'node:child_process';
import { spawnCli, decodeChunk, isWin } from './spawn.js';

export interface ExecuteResult {
  status: 'completed' | 'failed';
  output: string;
  error: string;
  exitCode: number | null;
  duration: number;
}

export interface ExecuteOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Content to pipe into the child's stdin, then close it */
  stdin?: string;
  /** Force encoding used to decode stdout/stderr; default: auto */
  encoding?: 'utf8' | 'gbk' | 'auto';
}

/**
 * Spawns a CLI process and streams stdout/stderr chunks via events.
 * Each concurrent request should use its own instance.
 *
 * The shell-free spawn + Windows .cmd shim routing + encoding autodetect
 * live in `./spawn.ts` so the long-lived AcpClient can reuse them.
 */
export class CLIExecutor extends EventEmitter {
  private proc: ChildProcess | null = null;

  execute(
    command: string,
    args: string[],
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      try {
        this.proc = spawnCli(command, args, {
          cwd: options.cwd,
          env: options.env,
        });
      } catch (err) {
        return reject(err);
      }

      const enc = options.encoding || 'auto';

      this.proc.stdout?.on('data', (data: Buffer) => {
        chunks.push(data);
        const text = decodeChunk(data, enc);
        this.emit('output', text);
      });

      this.proc.stderr?.on('data', (data: Buffer) => {
        errChunks.push(data);
        const text = decodeChunk(data, enc);
        this.emit('stderr', text);
      });

      this.proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        this.proc = null;
        const output = decodeChunk(Buffer.concat(chunks), enc);
        const error = decodeChunk(Buffer.concat(errChunks), enc);
        resolve({
          status: code === 0 ? 'completed' : 'failed',
          output,
          error,
          exitCode: code,
          duration,
        });
      });

      this.proc.on('error', (err) => {
        this.proc = null;
        reject(err);
      });

      if (options.stdin != null) {
        this.proc.stdin?.write(options.stdin);
        this.proc.stdin?.end();
      }
    });
  }

  cancel(): void {
    if (!this.proc) return;
    try {
      if (isWin && this.proc.pid) {
        nodeSpawn('taskkill', ['/pid', String(this.proc.pid), '/f', '/t']);
      } else {
        this.proc.kill('SIGTERM');
      }
    } catch {
      /* ignore */
    }
    this.proc = null;
  }

  isRunning() {
    return this.proc !== null;
  }
}
