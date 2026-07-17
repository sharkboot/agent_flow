import { useAgentStore } from '@/stores/agentStore';
import { Users, MessageSquare, Workflow, Zap, FolderTree } from 'lucide-react';
import type { ViewKey } from '@/components/layout/Sidebar';
import { LocalCLILauncher } from '@/components/LocalCLILauncher';

interface Props {
  onNavigate: (v: ViewKey) => void;
}

export function DashboardPage({ onNavigate }: Props) {
  const agents = useAgentStore((s) => s.agents);

  const stats = [
    { key: 'agents', label: 'Agent 数量', value: agents.length, icon: Users, target: 'agents' as ViewKey },
    { key: 'chat', label: '打开对话', value: '→', icon: MessageSquare, target: 'chat' as ViewKey },
    { key: 'workflow', label: '工作流', value: '→', icon: Workflow, target: 'workflow' as ViewKey },
    { key: 'sessions', label: '会话记录', value: '↗', icon: FolderTree, target: 'sessions' as ViewKey },
  ];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl">
        <div className="bg-gradient-to-br from-brand-600 to-brand-700 text-white rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Zap size={22} />
            <h2 className="text-xl font-semibold">欢迎使用 AgentFlow Visual</h2>
          </div>
          <p className="text-brand-100 text-sm max-w-2xl">
            通过可视化界面调用本地已安装的 Agent CLI 工具 —
            创建配置、发起对话、编排工作流,一切都在浏览器中完成。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => onNavigate(s.target)}
                className="text-left bg-white rounded-lg border border-slate-200 p-5 hover:border-brand-500 hover:shadow-md transition"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-500 uppercase tracking-wide">
                      {s.label}
                    </div>
                    <div className="text-3xl font-semibold text-slate-800 mt-1">
                      {s.value}
                    </div>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                    <Icon size={20} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-800 mb-3">快速开始</h3>
          <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside">
            <li>在 <b>Agents</b> 页面点击「创建 Agent」,配置 CLI 命令。</li>
            <li>切换到 <b>对话</b> 页面,输入任务开始与 Agent 交互。</li>
            <li>在 <b>工作流</b> 页面拖拽 Agent 节点搭建 Pipeline。</li>
          </ol>
        </section>

        <section className="mt-6">
          <LocalCLILauncher onNavigate={onNavigate} />
        </section>
      </div>
    </div>
  );
}
