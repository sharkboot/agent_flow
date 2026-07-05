import { useAgentStore } from '@/stores/agentStore';
import { AgentChat } from '@/components/agents/AgentChat';
import { AgentIcon } from '@/components/agents/AgentIcon';

export function ChatPage() {
  const { agents, selectedId, select } = useAgentStore();
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];

  if (!selected) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        没有可用的 Agent,请先在 <span className="mx-1 font-medium">Agents</span> 页面创建
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        <div className="px-4 py-3 border-b border-slate-200 text-xs uppercase text-slate-500">
          Agents
        </div>
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => select(a.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left transition ${
              a.id === selected.id ? 'bg-brand-50 border-l-2 border-brand-500' : 'hover:bg-slate-50 border-l-2 border-transparent'
            }`}
          >
            <AgentIcon type={a.type} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{a.name}</div>
              <div className="text-xs text-slate-500 mono truncate">{a.cliCommand}</div>
            </div>
          </button>
        ))}
      </aside>
      <div className="flex-1 overflow-hidden">
        <AgentChat agent={selected} />
      </div>
    </div>
  );
}
