---
AIGC:
    ContentProducer: Minimax Agent AI
    ContentPropagator: Minimax Agent AI
    Label: AIGC
    ProduceID: e5da355c809cc0b3f3af76a99f30e8bd
    PropagateID: e5da355c809cc0b3f3af76a99f30e8bd
    ReservedCode1: 30440220489a24a61e0fa89c0d75a558d68035f0b25ddab31d02f56da12ff4c2c4a3727802207d548f77a11113eb1465cd10586e5e7dde914f368364f24e6cb97ba04a26293b
    ReservedCode2: 30460221009abef8e6af05227d45ee465e079ca45814ff20d9705c26ad2987fabeb48550aa022100d3d9b140a8f45b59618675663c7f1cb041c86446a6b097ae870979cec9a14449
---

# TypeScript 项目 CLI 集成 AI 代理方案

> 本文档详细说明如何在纯 TypeScript 项目中通过 CLI 方式集成 Claude Code、Codex 和 Hermes 等 AI 代理，实现多代理协作编排。

## 一、方案概览

| 代理工具 | 安装方式 | 集成难度 | 主要特点 |
|---------|---------|---------|---------|
| **Claude Code** | `npm install -g @anthropic-ai/claude-code` | ⭐⭐ | 模型发现、日志流、技能注入 |
| **Codex CLI** | `npm install -g @openai/codex` | ⭐ | 零配置、多模态推理 |
| **Hermes Agent** | `pip install hermes-agent` | ⭐⭐⭐ | 闭环学习、RPC 模式 |

## 二、架构设计

### 2.1 核心组件

```
src/
├── adapters/                    # 适配器层
│   ├── claude-code-adapter.ts   # Claude Code 适配器
│   ├── codex-adapter.ts         # Codex CLI 适配器
│   ├── hermes-adapter.ts        # Hermes 适配器
│   ├── hermes-rpc.ts            # Hermes RPC 客户端
│   └── unified-adapter.ts       # 统一接口定义
├── agent-manager.ts             # 代理管理器
└── main.ts                      # 入口文件
```

### 2.2 接口设计

所有适配器必须实现统一的 `AgentAdapter` 接口：

```typescript
// src/adapters/unified-adapter.ts

export interface AgentAdapter {
  readonly type: string;
  execute(task: string, context?: Record<string, unknown>): Promise<ExecutionResult>;
  abort(): void;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  cost?: CostInfo;
  duration: number;
  error?: string;
}

export interface CostInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;
  model: string;
}
```

## 三、Claude Code CLI 集成

### 3.1 基础适配器实现

```typescript
// src/adapters/claude-code-adapter.ts

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface ClaudeCodeOptions {
  apiKey?: string;
  model?: string;
  workingDirectory?: string;
  timeout?: number;
}

export interface ClaudeCodeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export class ClaudeCodeAdapter extends EventEmitter {
  private process: ChildProcess | null = null;
  private options: ClaudeCodeOptions;

  constructor(options: ClaudeCodeOptions = {}) {
    super();
    this.options = {
      model: 'claude-sonnet-4-6',
      timeout: 300000,
      ...options,
    };
  }

  async execute(prompt: string): Promise<ClaudeCodeResult> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const args = [
        '--print',
        prompt,
        '--no-input',
        '--output-format', 'stream-json',
      ];

      if (this.options.model) {
        args.push('--model', this.options.model);
      }

      this.process = spawn('claude', args, {
        cwd: this.options.workingDirectory,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: this.options.apiKey,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      this.process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        this.emit('data', chunk);
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        this.emit('error', chunk);
      });

      this.process.on('close', (code) => {
        this.process = null;
        resolve({
          exitCode: code ?? 0,
          stdout,
          stderr,
          duration: Date.now() - startTime,
        });
      });

      this.process.on('error', reject);

      setTimeout(() => {
        if (this.process) {
          this.process.kill();
          reject(new Error('Claude Code execution timeout'));
        }
      }, this.options.timeout);
    });
  }

  abort(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }
}
```

### 3.2 统一封装

```typescript
// src/adapters/claude-code-adapter.ts (续)

import { ClaudeCodeAdapter } from './claude-code-adapter';

export class ClaudeCodeAgentAdapter implements AgentAdapter {
  readonly type = 'claude_code';
  private adapter: ClaudeCodeAdapter;

  constructor(options: ClaudeCodeOptions) {
    this.adapter = new ClaudeCodeAdapter(options);
  }

  async execute(
    task: string,
    context?: Record<string, unknown>
  ): Promise<ExecutionResult> {
    try {
      const enhancedTask = this.buildEnhancedPrompt(task, context);
      const result = await this.adapter.execute(enhancedTask);

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        duration: result.duration,
        cost: this.estimateCost(result.stdout),
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  abort(): void {
    this.adapter.abort();
  }

  private buildEnhancedPrompt(task: string, context?: Record<string, unknown>): string {
    let prompt = task;

    if (context?.projectPath) {
      prompt = `Working directory: ${context.projectPath}\n\n${prompt}`;
    }

    if (context?.skills) {
      const skills = Array.isArray(context.skills)
        ? context.skills.join(', ')
        : String(context.skills);
      prompt = `Available skills: ${skills}\n\n${prompt}`;
    }

    return prompt;
  }

  private estimateCost(output: string): CostInfo {
    const tokens = Math.ceil(output.length / 4);
    return {
      inputTokens: tokens,
      outputTokens: tokens,
      totalTokens: tokens * 2,
      costCents: Math.round(tokens * 2 * 0.003),
      model: 'claude-sonnet-4-6',
    };
  }
}
```

## 四、Codex CLI 集成

### 4.1 Codex 适配器实现

```typescript
// src/adapters/codex-adapter.ts

import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CodexOptions {
  apiKey?: string;
  apiBase?: string;
  model?: string;
  approvalMode?: 'suggest' | 'auto-edit' | 'full-auto';
  workingDirectory?: string;
}

export class CodexAdapter {
  private options: Required<CodexOptions>;

  constructor(options: CodexOptions = {}) {
    this.options = {
      apiKey: options.apiKey || process.env.OPENAI_API_KEY || '',
      apiBase: options.apiBase || 'https://api.openai.com/v1',
      model: options.model || 'gpt-4o',
      approvalMode: options.approvalMode || 'suggest',
      workingDirectory: options.workingDirectory || process.cwd(),
    };
  }

  async startSession(): Promise<void> {
    const args = [
      `--approval-mode=${this.options.approvalMode}`,
      `--model=${this.options.model}`,
    ];

    return new Promise((resolve, reject) => {
      const process = spawn('codex', args, {
        cwd: this.options.workingDirectory,
        env: {
          ...process.env,
          OPENAI_API_KEY: this.options.apiKey,
          OPENAI_BASE_URL: this.options.apiBase,
        },
        stdio: 'inherit',
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Codex session ended with code ${code}`));
        }
      });

      process.on('error', reject);
    });
  }

  async executeOnce(task: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '--approval-mode=auto-edit',
        `--model=${this.options.model}`,
      ];

      const process = spawn('codex', args, {
        cwd: this.options.workingDirectory,
        env: {
          ...process.env,
          OPENAI_API_KEY: this.options.apiKey,
          OPENAI_BASE_URL: this.options.apiBase,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Codex exited with code ${code}`));
        }
      });

      process.stdin?.write(task);
      process.stdin?.end();
    });
  }

  async checkHealth(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('codex --version');
      return stdout.includes('codex');
    } catch {
      return false;
    }
  }
}
```

## 五、Hermes Agent 集成

### 5.1 Python 子进程管理

```typescript
// src/adapters/hermes-adapter.ts

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface HermesOptions {
  pythonPath?: string;
  hermesPath?: string;
  model?: string;
  apiKey?: string;
  workingDirectory?: string;
}

export class HermesAdapter extends EventEmitter {
  private pythonProcess: ChildProcess | null = null;
  private options: Required<HermesOptions>;

  constructor(options: HermesOptions = {}) {
    super();
    this.options = {
      pythonPath: options.pythonPath || 'python3',
      hermesPath: options.hermesPath || 'hermes',
      model: options.model || 'qwen-3.5-122b',
      apiKey: options.apiKey || '',
      workingDirectory: options.workingDirectory || process.cwd(),
    };
  }

  async startSession(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pythonProcess = spawn(this.options.pythonPath, [
        '-m', 'hermes',
        '--model', this.options.model,
        '--workspace', this.options.workingDirectory,
      ], {
        cwd: this.options.workingDirectory,
        env: {
          ...process.env,
          HERMES_API_KEY: this.options.apiKey,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';

      this.pythonProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        this.emit('debug', data.toString());
      });

      this.pythonProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        this.emit('data', output);

        if (output.includes('Hermes ready') || output.includes('Ready')) {
          resolve();
        }
      });

      this.pythonProcess.on('close', (code) => {
        this.pythonProcess = null;
        if (code !== 0) {
          reject(new Error(`Hermes exited with code ${code}: ${stderr}`));
        }
      });

      this.pythonProcess.on('error', reject);

      setTimeout(() => {
        reject(new Error('Hermes startup timeout'));
      }, 60000);
    });
  }

  async executeCommand(command: string): Promise<string> {
    if (!this.pythonProcess || !this.pythonProcess.stdin) {
      throw new Error('Hermes session not started');
    }

    return new Promise((resolve, reject) => {
      let output = '';

      const dataHandler = (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        this.emit('data', chunk);

        if (chunk.includes('</result>') || chunk.includes('[DONE]')) {
          this.pythonProcess?.stdout?.off('data', dataHandler);
          resolve(output);
        }
      };

      this.pythonProcess.stdout?.on('data', dataHandler);
      this.pythonProcess.stdin.write(command + '\n');

      setTimeout(() => {
        this.pythonProcess?.stdout?.off('data', dataHandler);
        reject(new Error('Hermes command timeout'));
      }, 300000);
    });
  }

  async close(): Promise<void> {
    if (this.pythonProcess) {
      this.pythonProcess.stdin?.write('exit\n');
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.pythonProcess.kill('SIGTERM');
      this.pythonProcess = null;
    }
  }
}
```

### 5.2 Hermes RPC 模式

```typescript
// src/adapters/hermes-rpc.ts

import { execSync, spawn, ChildProcess } from 'child_process';

export interface HermesRPCOptions {
  port?: number;
  apiKey?: string;
  workspace?: string;
}

export class HermesRPCClient {
  private process: ChildProcess;
  private port: number;

  constructor(options: HermesRPCOptions = {}) {
    this.port = options.port || 8080;

    this.process = spawn('python3', [
      '-m', 'hermes.rpc',
      '--port', String(this.port),
      '--workspace', options.workspace || process.cwd(),
    ], {
      env: {
        ...process.env,
        HERMES_API_KEY: options.apiKey,
      },
      stdio: 'pipe',
    });
  }

  async execute(task: string): Promise<string> {
    const response = execSync(
      `curl -s -X POST http://localhost:${this.port}/execute \
       -H "Content-Type: application/json" \
       -d '{"task": "${task.replace(/"/g, '\\"')}"}'`,
      { encoding: 'utf-8' }
    );

    return JSON.parse(response).result;
  }

  async getCost(): Promise<{ totalTokens: number; costCents: number }> {
    const response = execSync(
      `curl -s http://localhost:${this.port}/cost`,
      { encoding: 'utf-8' }
    );

    return JSON.parse(response);
  }

  close(): void {
    this.process.kill();
  }
}
```

## 六、代理管理器

```typescript
// src/agent-manager.ts

import { ClaudeCodeAgentAdapter } from './adapters/claude-code-adapter';
import { CodexAdapter } from './adapters/codex-adapter';
import { HermesAdapter } from './adapters/hermes-adapter';
import { AgentAdapter, ExecutionResult } from './adapters/unified-adapter';

export type AgentType = 'claude_code' | 'codex' | 'hermes';

export interface AgentConfig {
  type: AgentType;
  apiKey: string;
  model?: string;
  workingDirectory?: string;
}

export class AgentManager {
  private adapters: Map<string, AgentAdapter> = new Map();
  private configs: Map<string, AgentConfig> = new Map();

  registerAgent(agentId: string, config: AgentConfig): void {
    this.configs.set(agentId, config);

    let adapter: AgentAdapter;

    switch (config.type) {
      case 'claude_code':
        adapter = new ClaudeCodeAgentAdapter({
          apiKey: config.apiKey,
          model: config.model,
          workingDirectory: config.workingDirectory,
        });
        break;

      case 'codex':
        adapter = new CodexAdapter({
          apiKey: config.apiKey,
          model: config.model,
          workingDirectory: config.workingDirectory,
        });
        break;

      case 'hermes':
        adapter = new HermesAdapter({
          apiKey: config.apiKey,
          model: config.model,
          workingDirectory: config.workingDirectory,
        });
        break;

      default:
        throw new Error(`Unknown agent type: ${config.type}`);
    }

    this.adapters.set(agentId, adapter);
  }

  async execute(
    agentId: string,
    task: string,
    context?: Record<string, unknown>
  ): Promise<ExecutionResult> {
    const adapter = this.adapters.get(agentId);

    if (!adapter) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return adapter.execute(task, context);
  }

  abort(agentId: string): void {
    const adapter = this.adapters.get(agentId);
    adapter?.abort();
  }

  getAgentType(agentId: string): AgentType | undefined {
    return this.configs.get(agentId)?.type;
  }

  listAgents(): string[] {
    return Array.from(this.adapters.keys());
  }
}
```

## 七、使用示例

```typescript
// src/main.ts

import { AgentManager } from './agent-manager';

async function main() {
  const manager = new AgentManager();

  // 注册多个代理
  manager.registerAgent('claude-1', {
    type: 'claude_code',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-sonnet-4-6',
    workingDirectory: '/path/to/project',
  });

  manager.registerAgent('codex-1', {
    type: 'codex',
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o',
    workingDirectory: '/path/to/project',
  });

  manager.registerAgent('hermes-1', {
    type: 'hermes',
    apiKey: process.env.HERMES_API_KEY!,
    model: 'qwen-3.5-122b',
    workingDirectory: '/path/to/project',
  });

  // 并行执行多个任务
  const [result1, result2, result3] = await Promise.all([
    manager.execute('claude-1', 'Implement user authentication with JWT'),
    manager.execute('codex-1', 'Write unit tests for auth module'),
    manager.execute('hermes-1', 'Analyze code quality and suggest improvements'),
  ]);

  console.log('Claude Code:', result1);
  console.log('Codex:', result2);
  console.log('Hermes:', result3);

  // 任务链式执行
  const authResult = await manager.execute('claude-1',
    'Create auth middleware'
  );

  if (authResult.success) {
    const testResult = await manager.execute('codex-1',
      `Write tests for: ${authResult.output.substring(0, 100)}...`
    );
    console.log('Test result:', testResult);
  }
}

main().catch(console.error);
```

## 八、环境配置

### 8.1 环境变量

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-xxxxx
HERMES_API_KEY=your-hermes-key

# 可选：自定义 API 端点
OPENAI_BASE_URL=https://api.openai.com/v1
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

### 8.2 依赖安装

```bash
# 安装 TypeScript 项目依赖
npm install -D @types/node typescript

# 全局安装 CLI 工具
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex

# Python 依赖（Hermes）
pip install hermes-agent
```

### 8.3 TypeScript 配置

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## 九、最佳实践

### 9.1 错误处理

```typescript
async function safeExecute(
  manager: AgentManager,
  agentId: string,
  task: string
): Promise<ExecutionResult> {
  try {
    return await manager.execute(agentId, task);
  } catch (error) {
    return {
      success: false,
      output: '',
      duration: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

### 9.2 超时控制

```typescript
// 为每个代理设置合理的超时时间
const TIMEOUTS = {
  claude_code: 5 * 60 * 1000,    // 5 分钟
  codex: 3 * 60 * 1000,          // 3 分钟
  hermes: 10 * 60 * 1000,        // 10 分钟
};
```

### 9.3 并发控制

```typescript
// 限制并发代理数量
const semaphore = new Semaphore(3); // 最多 3 个并发

async function executeWithLimit(
  manager: AgentManager,
  agentId: string,
  task: string
) {
  return semaphore.acquire(async () => {
    return manager.execute(agentId, task);
  });
}
```

## 十、常见问题

| 问题 | 解决方案 |
|------|---------|
| Claude Code 报权限错误 | 确保 `ANTHROPIC_API_KEY` 正确设置 |
| Codex 连接超时 | 检查网络或使用代理 |
| Hermes 启动失败 | 确认 Python 环境和依赖安装正确 |
| 进程无法终止 | 使用 `SIGKILL` 信号强制终止 |

---

**文档信息**

- **作者**: MiniMax Agent
- **创建时间**: 2026-07-05
- **参考来源**: [Claude Code](https://docs.anthropic.com/claude-code), [Codex CLI](https://github.com/openai/codex), [Hermes Agent](https://github.com/anomalyco/hermes-agent)
