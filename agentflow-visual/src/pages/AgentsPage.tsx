import { useState } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { AgentCard } from '@/components/agents/AgentCard';
import { AgentForm } from '@/components/agents/AgentForm';
import { Button } from '@/components/shared/Button';
import { Plus, Search } from 'lucide-react';
import type { LocalAgent } from '@/types';

interface AgentsPageProps {
  onOpenChat: () => void;
}

export function AgentsPage({ onOpenChat }: AgentsPageProps) {
  const { agents, loading, createAgent, updateAgent, deleteAgent, select } = useAgentStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LocalAgent | null>(null);
  const [query, setQuery] = useState('');

  const filtered = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(query.toLowerCase()) ||
      a.description?.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-md border border-slate-300 text-sm outline-none focus:border-brand-500"
            placeholder="搜索 Agent..."
          />
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus size={16} /> 创建 Agent
        </Button>
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm">加载中...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
          <div className="text-slate-500 text-sm">
            {agents.length === 0 ? '尚未创建 Agent' : '没有匹配的 Agent'}
          </div>
          {agents.length === 0 && (
            <Button
              className="mt-3"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              创建第一个 Agent
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onChat={() => {
                select(agent.id);
                onOpenChat();
              }}
              onEdit={() => {
                setEditing(agent);
                setFormOpen(true);
              }}
              onDelete={() => {
                if (confirm(`确定删除 Agent "${agent.name}" ?`)) {
                  deleteAgent(agent.id);
                }
              }}
            />
          ))}
        </div>
      )}

      <AgentForm
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSubmit={async (data) => {
          if (editing) {
            await updateAgent(editing.id, data);
          } else {
            await createAgent(data);
          }
        }}
      />
    </div>
  );
}
