import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';

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
  /** Force encoding used to decode stdout/stderr; default: auto (utf8 preferred, gbk fallback on win32) */
  encoding?: 'utf8' | 'gbk' | 'auto';
}

const isWin = process.platform === 'win32';

/**
 * Quote a single arg the way cmd.exe expects when invoked as
 * `cmd /s /c "<cmdline>"`. Wraps in double-quotes and escapes internal ".
 */
function quoteForCmd(s: string): string {
  if (s === '' ) return '""';
  // If no whitespace or special chars, leave as-is
  if (!/[\s"&|<>^%]/.test(s)) return s;
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}

/**
 * Resolve a bare command to an absolute path by scanning PATH.
 * Returns the original name if not found (spawn will surface ENOENT).
 * On Windows we honor PATHEXT so `claude` resolves to `claude.cmd`.
 */
function resolveOnPath(cmd: string): string {
  if (path.isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) return cmd;
  const PATH = process.env.PATH || process.env.Path || '';
  const dirs = PATH.split(isWin ? ';' : ':');
  const exts = isWin
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + (path.extname(cmd) ? '' : ext));
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* keep looking */ }
    }
  }
  return cmd;
}

/**
 * Decode a chunk with UTF-8 first; if the result has replacement chars,
 * try the platform's ANSI codepage (GBK on Chinese Windows). This avoids
 * hard-coding a single encoding.
 */
function decodeChunk(buf: Buffer, prefer: 'utf8' | 'gbk' | 'auto'): string {
  if (prefer === 'utf8') return buf.toString('utf8');
  if (prefer === 'gbk') return iconv.decode(buf, 'gbk');
  // auto:
  const asUtf8 = buf.toString('utf8');
  if (!asUtf8.includes('�')) return asUtf8;
  if (isWin && iconv.encodingExists('gbk')) {
    try {
      return iconv.decode(buf, 'gbk');
    } catch {
      /* fall through */
    }
  }
  return asUtf8;
}

/**
 * Spawns a CLI process and streams stdout/stderr chunks via events.
 * Each concurrent request should use its own instance.
 *
 * IMPORTANT: we do NOT use `shell: true`. Passing args through cmd.exe
 * corrupts quotes and treats `;` as a command separator. Instead we call
 * the binary directly with the resolved absolute path.
 *
 * On Windows we set the child process code page to 65001 (UTF-8) via env
 * for programs that respect it (Python via PYTHONIOENCODING, etc.).
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

      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ...(options.env || {}),
      };
      if (isWin) {
        // Nudge programs toward UTF-8 output.
        env.PYTHONIOENCODING = env.PYTHONIOENCODING || 'utf-8';
      }

      try {
        const resolved = resolveOnPath(command);
        // On Windows, .cmd/.bat shims (npm-installed CLIs like `claude`)
        // can only be executed through cmd.exe. Detect and route via
        // `cmd /d /s /c` with a properly quoted command line — safer than
        // `shell:true` because we control the quoting.
        const useWinCmdShim =
          isWin && /\.(cmd|bat)$/i.test(resolved);
        if (useWinCmdShim) {
          const quoted = [resolved, ...args].map(quoteForCmd).join(' ');
          this.proc = spawn('cmd.exe', ['/d', '/s', '/c', quoted], {
            cwd: options.cwd || process.cwd(),
            env,
            shell: false,
            windowsHide: true,
          });
        } else {
          this.proc = spawn(resolved, args, {
            cwd: options.cwd || process.cwd(),
            env,
            shell: false,
            windowsHide: true,
          });
        }
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
        spawn('taskkill', ['/pid', String(this.proc.pid), '/f', '/t']);
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
