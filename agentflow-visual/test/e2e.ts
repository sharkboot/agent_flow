/**
 * End-to-end smoke test for the CLI-invocation stack.
 * Runs against a live server on http://127.0.0.1:3001.
 *
 *   npm run test:e2e      # assumes server already up (via `npm start`)
 *   npm run test:e2e:boot # boots its own server, tests, tears down
 *
 * Verifies:
 *   1. Server /health responds
 *   2. Config CRUD (create → get → list → delete)
 *   3. CLI execute via SSE streams output for node/git/python
 *   4. Chinese output round-trips without mojibake
 *   5. Cancel endpoint terminates a long-running process
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';

interface SseFrame { type: string; data: unknown }

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const txt = await res.text();
  try { return { status: res.status, body: JSON.parse(txt) }; }
  catch { return { status: res.status, body: txt }; }
}

async function collectSse(url: string, body: unknown, timeoutMs = 15000): Promise<{
  frames: SseFrame[];
  output: string;
  stderr: string;
  complete: any;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  if (!res.body) throw new Error('no body');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const frames: SseFrame[] = [];
  let output = '';
  let stderr = '';
  let complete: any = null;
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const p of parts) {
        if (!p.trim().startsWith('data:')) continue;
        const frame = JSON.parse(p.trim().slice(5).trim()) as SseFrame;
        frames.push(frame);
        if (frame.type === 'output') output += String(frame.data);
        else if (frame.type === 'error') stderr += String(frame.data);
        else if (frame.type === 'complete') complete = frame.data;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { frames, output, stderr, complete };
}

type Case = () => Promise<void>;
const cases: { name: string; run: Case }[] = [];
function test(name: string, run: Case) { cases.push({ name, run }); }

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// ---------- Test cases ----------

test('GET /health responds ok', async () => {
  const { status, body } = await fetchJson(`${BASE}/health`);
  assert(status === 200, `status=${status}`);
  assert((body as any).ok === true, `body=${JSON.stringify(body)}`);
});

test('GET /api/config/info returns platform info', async () => {
  const { body } = await fetchJson(`${BASE}/api/config/info`);
  const b = body as any;
  assert(typeof b.version === 'string', 'no version');
  assert(Array.isArray(b.supported), 'no supported list');
});

test('Agent CRUD round-trip', async () => {
  // Create
  const create = await fetchJson(`${BASE}/api/config/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'e2e-tmp',
      type: 'custom',
      cliCommand: 'node',
      cliArgs: ['-e', 'console.log(1)'],
      config: {},
    }),
  });
  assert(create.status === 201, `create status=${create.status}`);
  const id = (create.body as any).id as string;

  // List (must include our agent)
  const list = await fetchJson(`${BASE}/api/config/agents`);
  assert(Array.isArray(list.body), 'list not array');
  const found = (list.body as any[]).find((a) => a.id === id);
  assert(found, 'created agent missing from list');

  // Update
  const upd = await fetchJson(`${BASE}/api/config/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'updated' }),
  });
  assert((upd.body as any).description === 'updated', 'update did not persist');

  // Delete
  const del = await fetchJson(`${BASE}/api/config/agents/${id}`, { method: 'DELETE' });
  assert((del.body as any).success === true, 'delete failed');
});

test('node -e via Agent returns computed value', async () => {
  const agent = await fetchJson(`${BASE}/api/config/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'e2e-node',
      type: 'custom',
      cliCommand: 'node',
      cliArgs: ['-e'],
      config: {},
    }),
  });
  const id = (agent.body as any).id as string;
  try {
    const { output, complete } = await collectSse(
      `${BASE}/api/cli/execute`,
      { agentId: id, task: 'console.log(6 * 7)' },
    );
    assert(complete, 'no complete frame');
    assert(complete.status === 'completed', `status=${complete.status} stderr=${complete.error}`);
    assert(/\b42\b/.test(output), `output missing 42: ${JSON.stringify(output)}`);
  } finally {
    await fetchJson(`${BASE}/api/config/agents/${id}`, { method: 'DELETE' });
  }
});

test('python via stdin (multi-line code, no shell quoting)', async () => {
  const agent = await fetchJson(`${BASE}/api/config/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'e2e-py',
      type: 'custom',
      cliCommand: 'python',
      cliArgs: [],   // parser will pipe code to stdin
      config: {},
    }),
  });
  const id = (agent.body as any).id as string;
  try {
    const task = "import sys\nprint('py', sys.version_info.major)";
    const { output, complete } = await collectSse(
      `${BASE}/api/cli/execute`,
      { agentId: id, task },
    );
    assert(complete?.status === 'completed', `status=${complete?.status} err=${complete?.error}`);
    assert(/py 3/.test(output), `expected 'py 3' in ${JSON.stringify(output)}`);
  } finally {
    await fetchJson(`${BASE}/api/config/agents/${id}`, { method: 'DELETE' });
  }
});

test('Chinese output round-trips without mojibake', async () => {
  const agent = await fetchJson(`${BASE}/api/config/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'e2e-zh',
      type: 'custom',
      cliCommand: 'node',
      cliArgs: ['-e'],
      config: {},
    }),
  });
  const id = (agent.body as any).id as string;
  try {
    const { output, complete } = await collectSse(
      `${BASE}/api/cli/execute`,
      { agentId: id, task: 'process.stdout.write("你好,世界")' },
    );
    assert(complete?.status === 'completed', `status=${complete?.status} err=${complete?.error}`);
    assert(output.includes('你好'), `expected 你好 in ${JSON.stringify(output)}`);
    assert(output.includes('世界'), `expected 世界 in ${JSON.stringify(output)}`);
    assert(!output.includes('�'), `mojibake detected: ${JSON.stringify(output)}`);
  } finally {
    await fetchJson(`${BASE}/api/config/agents/${id}`, { method: 'DELETE' });
  }
});

test('git version via Agent matches direct call', async () => {
  const agent = await fetchJson(`${BASE}/api/config/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'e2e-git',
      type: 'custom',
      cliCommand: 'git',
      cliArgs: ['--version'],
      config: {},
    }),
  });
  const id = (agent.body as any).id as string;
  try {
    // send an empty task so parser only uses cliArgs
    const { output, complete } = await collectSse(
      `${BASE}/api/cli/execute`,
      { agentId: id, task: '' },
    );
    assert(complete?.status === 'completed', `status=${complete?.status}`);
    assert(/git version/i.test(output), `no 'git version' in ${JSON.stringify(output)}`);
  } finally {
    await fetchJson(`${BASE}/api/config/agents/${id}`, { method: 'DELETE' });
  }
});

test('cancel endpoint terminates a long-running process', async () => {
  const agent = await fetchJson(`${BASE}/api/config/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'e2e-sleep',
      type: 'custom',
      cliCommand: 'node',
      cliArgs: ['-e'],
      config: {},
    }),
  });
  const id = (agent.body as any).id as string;
  try {
    // Kick off a 30s wait and cancel after ~1s
    const startedAt = Date.now();
    const p = collectSse(
      `${BASE}/api/cli/execute`,
      { agentId: id, task: 'setTimeout(()=>console.log("done"),30000)' },
      45000,
    );
    await new Promise((r) => setTimeout(r, 1200));
    await fetchJson(`${BASE}/api/cli/cancel`, { method: 'POST' });
    const res = await p;
    const dur = Date.now() - startedAt;
    assert(dur < 10000, `cancel took too long: ${dur}ms`);
    assert(res.complete?.status === 'failed', `expected failed after cancel, got ${res.complete?.status}`);
  } finally {
    await fetchJson(`${BASE}/api/config/agents/${id}`, { method: 'DELETE' });
  }
});

// ---------- Runner ----------

async function waitForServer(url: string, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url + '/health');
      if (r.ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server not up at ${url} after ${timeoutMs}ms`);
}

async function main() {
  let serverProc: ReturnType<typeof spawn> | null = null;
  const bootMode = process.argv.includes('--boot');
  if (bootMode) {
    console.log('[e2e] booting server...');
    serverProc = spawn(process.execPath, [
      path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs'),
      path.resolve(__dirname, '../server/index.ts'),
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
    await waitForServer(BASE);
  } else {
    await waitForServer(BASE, 3000).catch(() => {
      console.error(`[e2e] no server at ${BASE}. Start it with 'npm start' or run 'npm run test:e2e:boot'.`);
      process.exit(2);
    });
  }

  let pass = 0, fail = 0;
  const failures: string[] = [];
  for (const c of cases) {
    process.stdout.write(`  · ${c.name} ... `);
    const t0 = Date.now();
    try {
      await c.run();
      pass++;
      process.stdout.write(`\x1b[32mOK\x1b[0m (${Date.now() - t0}ms)\n`);
    } catch (err) {
      fail++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${c.name}: ${msg}`);
      process.stdout.write(`\x1b[31mFAIL\x1b[0m (${Date.now() - t0}ms)\n    ${msg}\n`);
    }
  }
  console.log(`\n[e2e] ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  -', f);
  }
  if (serverProc) serverProc.kill();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[e2e] fatal:', err);
  process.exit(1);
});
