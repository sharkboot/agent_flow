---
AIGC:
    ContentProducer: Minimax Agent AI
    ContentPropagator: Minimax Agent AI
    Label: AIGC
    ProduceID: c70e65fe26c2960f8632b4a12eb708a9
    PropagateID: c70e65fe26c2960f8632b4a12eb708a9
    ReservedCode1: 30460221008070d507c3fd481c8668a42f7cde10c3e1d61cd1fb1b05bf752b6ecd6448a9f8022100a8e90f9d8bf474a2e61b74000d6735e37cab55c31cb83ed4ba290285aaa1f4d5
    ReservedCode2: 3044022026cb5dfefea5597b44dc2e3d6864c3c8f0071f59bf1332a9043cb7d23dcd7635022004c15c7e03fc98dd787670763337d6afd40e02635b828face7272f426b717a37
---

# AgentFlow Visual - 可视化Agent调用工具

## 1. 项目概述

### 1.1 项目定位
一个轻量级的**Web可视化界面**，用于调用本地已安装的Agent CLI工具（如agentflow、claude-code、codex-cli等）。

### 1.2 核心功能
- **Agent管理** - 可视化创建/配置本地Agent
- **任务执行** - 通过UI调用CLI执行任务
- **对话界面** - 可视化Agent交互
- **工作流编排** - 拖拽式编排Agent任务流程（后续）

### 1.3 设计原则
- **调用本地CLI** - 不重新实现Agent逻辑，复用现有CLI
- **轻量级** - 最小化依赖
- **可扩展** - 支持多种CLI工具

---

## 2. 技术架构

### 2.1 技术选型

| 模块 | 技术方案 |
|------|----------|
| 前端框架 | React 18 + TypeScript 5 |
| UI组件 | shadcn/ui + Tailwind CSS |
| 画布/拖拽 | React Flow |
| 状态管理 | Zustand |
| 构建工具 | Vite 5 |
| 后端通信 | 本地Express服务（执行CLI） |
| CLI调用 | Node.js child_process |

### 2.2 项目结构

```
agentflow-visual/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── MainLayout.tsx
│   │   ├── agents/
│   │   │   ├── AgentList.tsx
│   │   │   ├── AgentCard.tsx
│   │   │   ├── AgentForm.tsx
│   │   │   └── AgentChat.tsx
│   │   ├── workflow/
│   │   │   ├── WorkflowCanvas.tsx
│   │   │   ├── AgentNode.tsx
│   │   │   └── EdgeConfig.tsx
│   │   ├── terminal/
│   │   │   └── CLITerminal.tsx
│   │   └── shared/
│   │       ├── Button.tsx
│   │       ├── Modal.tsx
│   │       └── Select.tsx
│   ├── services/
│   │   ├── cliRunner.ts          # CLI执行服务
│   │   ├── configManager.ts      # 配置管理
│   │   └── ipc.ts                # 前后端通信
│   ├── stores/
│   │   ├── agentStore.ts
│   │   ├── workflowStore.ts
│   │   └── executionStore.ts
│   ├── types/
│   │   └── index.ts
│   ├── hooks/
│   │   ├── useCLI.ts
│   │   ├── useAgent.ts
│   │   └── useWorkflow.ts
│   ├── App.tsx
│   └── main.tsx
├── server/
│   ├── index.ts                  # Express服务器
│   ├── cli/
│   │   ├── executor.ts           # CLI执行器
│   │   └── parser.ts             # 输出解析
│   └── routes/
│       ├── agents.ts
│       ├── execute.ts
│       └── config.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

---

## 3. 数据模型

### 3.1 Agent配置

```typescript
// types/agent.ts

export type AgentType = 'claude' | 'codex' | 'hemers' | 'custom';

export interface LocalAgent {
  id: string;
  name: string;
  description?: string;
  type: AgentType;

  // CLI配置
  cliCommand: string;           // CLI命令，如 'claude', 'agentflow'
  cliArgs?: string[];           // 额外CLI参数
  workingDir?: string;          // 工作目录

  // Agent配置（传递给CLI）
  config: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  };

  // 绑定
  skills?: string[];
  mcpServers?: string[];

  createdAt: string;
  updatedAt: string;
}

export interface ExecutionRequest {
  agentId: string;
  task: string;
  context?: Record<string, unknown>;
  stream?: boolean;
}

export interface ExecutionResult {
  id: string;
  agentId: string;
  status: 'running' | 'completed' | 'failed';
  output: string;
  error?: string;
  duration: number;
  tokens?: { input: number; output: number };
}
```

### 3.2 Workflow配置

```typescript
// types/workflow.ts

export interface WorkflowNode {
  id: string;
  type: 'agent' | 'condition' | 'input' | 'output';
  position: { x: number; y: number };
  data: {
    label: string;
    agentId?: string;
    condition?: string;
    inputVar?: string;
    outputVar?: string;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
}
```

---

## 4. 功能设计

### 4.1 侧边栏导航

```
┌────────────────────────────────────────────┐
│  AgentFlow Visual                    [≡]   │
├────────────────────────────────────────────┤
│                                            │
│  🏠 控制台                                  │
│                                            │
│  👥 Agents                                 │
│     • Agent列表                            │
│     • 创建Agent                            │
│                                            │
│  💬 对话                                   │
│     • 新建对话                            │
│     • 历史记录                            │
│                                            │
│  🔀 工作流                                 │
│     • 编排画布                            │
│     • 模板库                              │
│                                            │
│  ⚙️ 设置                                   │
│     • CLI配置                              │
│     • MCP服务器                           │
│                                            │
├────────────────────────────────────────────┤
│  [终端]                                    │
└────────────────────────────────────────────┘
```

### 4.2 Agent管理页面

**Agent列表：**
- 卡片式展示已配置的Agent
- 显示Agent类型图标、名称、描述
- 快捷操作：对话、执行、编辑、删除

**Agent创建/编辑表单：**
- 基本信息（名称、描述、类型）
- CLI命令配置
- 模型参数（温度、token等）
- 系统提示词

### 4.3 对话界面

```
┌─────────────────────────────────────────────────────────┐
│  Agent: my-claude-agent                           [⚙️]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [Claude] 你好！有什么可以帮助你的吗？             │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [User] 帮我写一个快速排序算法                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [Claude] 执行中...                                │   │
│  │ ```python                                        │   │
│  │ def quicksort(arr):                             │   │
│  │     if len(arr) <= 1:                           │   │
│  │         return arr                              │   │
│  │     ...                                         │   │
│  │ ```                                             │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  > 帮我写一个快速排序算法                    [发送]    │
├─────────────────────────────────────────────────────────┤
│  ⚡ Skills: web-search, code-execute                   │
│  🛠️ MCP: github-server                                 │
└─────────────────────────────────────────────────────────┘
```

### 4.4 工作流编排（后续）

```
┌─────────────────────────────────────────────────────────┐
│  工作流: 我的Pipeline           [▶运行] [💾保存] [↩撤销] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐                                          │
│  │ [START]  │                                          │
│  └────┬─────┘                                          │
│       │                                                │
│       ▼                                                │
│  ┌──────────┐                                          │
│  │ [INPUT]  │  query                                    │
│  └────┬─────┘                                          │
│       │                                                │
│       ▼                                                │
│  ┌──────────────────────┐                              │
│  │   [Claude Agent]     │                              │
│  │   my-agent           │                              │
│  │   ┌────┐    ┌────┐   │                              │
│  │   │in1 │────│out1│   │                              │
│  │   └────┘    └────┘   │                              │
│  └──────────┬───────────┘                              │
│             │                                          │
│             ▼                                          │
│  ┌──────────────────────┐                              │
│  │   [Code Execute]     │                              │
│  │   python             │                              │
│  └──────────┬───────────┘                              │
│             │                                          │
│             ▼                                          │
│  ┌──────────┐                                          │
│  │ [OUTPUT] │  result                                  │
│  └────┬─────┘                                          │
│       │                                                │
│       ▼                                                │
│  ┌──────────┐                                          │
│  │  [END]   │                                          │
│  └──────────┘                                          │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  📦 节点库                                              │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐          │
│  │ Agent  │ │ Skill  │ │  Tool  │ │ Cond   │          │
│  └────────┘ └────────┘ └────────┘ └────────┘          │
└─────────────────────────────────────────────────────────┘
```

---

## 5. 后端服务

### 5.1 Express服务

```typescript
// server/index.ts
import express from 'express';
import cors from 'cors';
import { cliRouter } from './routes/cli';
import { configRouter } from './routes/config';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/cli', cliRouter);
app.use('/api/config', configRouter);

app.listen(3001, () => {
  console.log('AgentFlow Visual Server running on port 3001');
});
```

### 5.2 CLI执行器

```typescript
// server/cli/executor.ts
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

export class CLIExecutor extends EventEmitter {
  private activeProcess: ChildProcess | null = null;

  async execute(
    command: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string> }
  ): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let output = '';

      this.activeProcess = spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        shell: true,
      });

      this.activeProcess.stdout?.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        this.emit('output', chunk);
      });

      this.activeProcess.stderr?.on('data', (data) => {
        this.emit('error', data.toString());
      });

      this.activeProcess.on('close', (code) => {
        this.activeProcess = null;
        resolve({
          status: code === 0 ? 'completed' : 'failed',
          output,
          duration: Date.now() - startTime,
        });
      });

      this.activeProcess.on('error', (err) => {
        this.activeProcess = null;
        reject(err);
      });
    });
  }

  cancel(): void {
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
  }
}
```

### 5.3 API路由

```typescript
// server/routes/cli.ts
import { Router } from 'express';
import { CLIExecutor } from '../cli/executor';
import { parseAgentConfig } from '../cli/parser';

export const cliRouter = Router();
const executor = new CLIExecutor();

// POST /api/cli/execute
cliRouter.post('/execute', async (req, res) => {
  const { agentId, task, config } = req.body;

  // 读取Agent配置
  const agentConfig = await parseAgentConfig(agentId);

  // 构建CLI命令
  const command = agentConfig.cliCommand;
  const args = [
    'agent', 'execute', agentConfig.id,
    task,
    '--temperature', String(config.temperature || 0.7),
  ];

  // 流式输出
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  executor.on('output', (chunk) => {
    res.write(`data: ${JSON.stringify({ type: 'output', data: chunk })}\n\n`);
  });

  executor.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ type: 'error', data: err })}\n\n`);
  });

  try {
    const result = await executor.execute(command, args, {
      cwd: agentConfig.workingDir,
    });
    res.write(`data: ${JSON.stringify({ type: 'complete', data: result })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', data: err })}\n\n`);
  } finally {
    res.end();
  }
});

// POST /api/cli/cancel
cliRouter.post('/cancel', (req, res) => {
  executor.cancel();
  res.json({ success: true });
});
```

---

## 6. CLI调用接口

### 6.1 前端调用服务

```typescript
// src/services/cliRunner.ts
export class CLIRunner {
  private baseUrl = 'http://localhost:3001';

  async execute(
    agentId: string,
    task: string,
    onOutput?: (chunk: string) => void
  ): Promise<ExecutionResult> {
    const response = await fetch(`${this.baseUrl}/api/cli/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, task }),
    });

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(Boolean);

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'output' && onOutput) {
            onOutput(event.data);
          } else if (event.type === 'complete') {
            return event.data;
          }
        }
      }
    }

    throw new Error('Execution failed');
  }

  cancel(): void {
    fetch(`${this.baseUrl}/api/cli/cancel`, { method: 'POST' });
  }
}
```

### 6.2 支持的CLI命令

```typescript
// CLI命令映射
export const SUPPORTED_CLI = {
  agentflow: {
    execute: 'agent execute',
    chat: 'agent chat',
    list: 'agent list',
    create: 'agent create',
    workflow: {
      run: 'workflow run',
      create: 'workflow create',
    },
  },
  claude: {
    execute: 'claude --print',
    chat: 'claude',
  },
  codex: {
    execute: 'codex --print',
    chat: 'codex',
  },
};
```

---

## 7. 组件设计

### 7.1 AgentCard

```typescript
// components/agents/AgentCard.tsx
interface AgentCardProps {
  agent: LocalAgent;
  onChat: () => void;
  onExecute: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function AgentCard({ agent, onChat, onExecute, onEdit, onDelete }: AgentCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-4">
      <div className="flex items-center gap-3">
        <AgentIcon type={agent.type} className="w-10 h-10" />
        <div className="flex-1">
          <h3 className="font-semibold">{agent.name}</h3>
          <p className="text-sm text-gray-500">{agent.description}</p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={onChat}>对话</Button>
        <Button size="sm" variant="outline" onClick={onExecute}>执行</Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>编辑</Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>删除</Button>
      </div>
    </div>
  );
}
```

### 7.2 AgentChat

```typescript
// components/agents/AgentChat.tsx
interface AgentChatProps {
  agent: LocalAgent;
  onClose: () => void;
}

export function AgentChat({ agent, onClose }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const cliRunner = useCLI();

  const sendMessage = async () => {
    if (!input.trim() || isRunning) return;

    const userMessage: Message = {
      id: uuid(),
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsRunning(true);

    // 添加AI占位消息
    const aiMessage: Message = {
      id: uuid(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, aiMessage]);

    try {
      await cliRunner.execute(agent.id, input, (chunk) => {
        setMessages(prev =>
          prev.map(msg =>
            msg.id === aiMessage.id
              ? { ...msg, content: msg.content + chunk }
              : msg
          )
        );
      });
    } catch (err) {
      setMessages(prev =>
        prev.map(msg =>
          msg.id === aiMessage.id
            ? { ...msg, content: `错误: ${err}` }
            : msg
        )
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b flex justify-between items-center">
        <h2 className="font-semibold">{agent.name} - 对话</h2>
        <Button variant="ghost" onClick={onClose}>关闭</Button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="输入消息..."
            disabled={isRunning}
          />
          <Button onClick={sendMessage} disabled={isRunning}>
            {isRunning ? '执行中...' : '发送'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

### 7.3 WorkflowCanvas

```typescript
// components/workflow/WorkflowCanvas.tsx
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export function WorkflowCanvas() {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } = useWorkflow();

  const nodeTypes = {
    agent: AgentNode,
    input: InputNode,
    output: OutputNode,
    condition: ConditionNode,
  };

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>

      <NodePalette />
    </div>
  );
}
```

---

## 8. 实现计划

### Phase 1: 基础框架
- [ ] 项目初始化 (Vite + React + TypeScript)
- [ ] 布局组件 (Sidebar, Header)
- [ ] Express后端搭建
- [ ] CLI执行器实现

### Phase 2: Agent管理
- [ ] Agent列表页面
- [ ] Agent创建/编辑表单
- [ ] Agent配置存储
- [ ] CLI调用集成

### Phase 3: 对话功能
- [ ] 对话界面组件
- [ ] 流式输出处理
- [ ] 消息历史管理
- [ ] 取消执行功能

### Phase 4: 工作流编排（后续）
- [ ] React Flow集成
- [ ] Agent节点渲染
- [ ] 边连接配置
- [ ] 工作流保存/加载

---

## 9. 快速开始

### 9.1 安装依赖

```bash
cd agentflow-visual
npm install
```

### 9.2 启动服务

```bash
# 终端1: 启动后端
npm run server

# 终端2: 启动前端
npm run dev
```

### 9.3 访问界面

打开浏览器访问 `http://localhost:5173`

---

## 10. 配置示例

### 10.1 Agent配置

```json
// config/agents/agent-001.json
{
  "id": "agent-001",
  "name": "我的Claude",
  "description": "主助手指Agent",
  "type": "claude",
  "cliCommand": "claude",
  "config": {
    "model": "claude-3-5-sonnet-20241022",
    "temperature": 0.7,
    "maxTokens": 4096
  }
}
```

### 10.2 本地CLI要求

确保本地已安装以下CLI工具之一：
- `claude` (Anthropic)
- `agentflow` (自定义)
- `codex` (OpenAI)
