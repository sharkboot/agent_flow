# AgentFlow Visual

轻量级 Web 可视化界面,用于调用本地已安装的 Agent CLI 工具(如 `claude`、`codex`、`agentflow` 等)。

## 快速开始

```bash
# 安装依赖
npm install

# 一键启动前后端 (推荐)
npm start

# 或分别启动
npm run server   # 后端 http://localhost:3001
npm run dev      # 前端 http://localhost:5173
```

打开 <http://localhost:5173> 使用。

## 特性

- 🏠 **控制台** — 总览与快速入口
- 👥 **Agent 管理** — 可视化配置本地 CLI Agent (类型/命令/参数/模型)
- 💬 **对话** — 与 Agent 流式交互,支持取消执行
- 🔀 **工作流** — 基于 React Flow 的节点编排画布 (MVP)
- ⚙️ **设置** — 查看服务信息

## 项目结构

```
agentflow-visual/
├── src/           # 前端 (Vite + React + TS + Tailwind)
├── server/        # 后端 (Express + tsx, child_process 调用 CLI)
└── config/agents/ # Agent 配置存储 (JSON 文件)
```

## 常见问题

**Q: 没有 `claude`/`codex` 怎么办?**
A: 首次启动时会自动创建一个 `Echo (示例)` Agent 用作调试,任何输入都会被回显。

**Q: 如何添加新类型的 CLI?**
A: 在 `server/cli/parser.ts` 的 `buildCliInvocation` 中新增分支,或直接使用 `custom` 类型手动配置 `cliArgs`。

## 技术栈

- 前端: React 18 · TypeScript · Vite 5 · Tailwind · Zustand · React Flow · lucide-react
- 后端: Express · tsx · Node child_process
