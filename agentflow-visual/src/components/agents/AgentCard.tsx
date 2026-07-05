import type { LocalAgent } from '@/types';
import { Button } from '@/components/shared/Button';
import { AgentIcon } from './AgentIcon';

interface AgentCardProps {
  agent: LocalAgent;
  onChat: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function AgentCard({ agent, onChat, onEdit, onDelete }: AgentCardProps) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 hover:shadow-md transition">
      <div className="flex items-start gap-3">
        <AgentIcon type={agent.type} />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-800 truncate">{agent.name}</h3>
          <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">
            {agent.description || <span className="italic">未填写描述</span>}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 mono">
              {agent.type}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 mono">
              {agent.cliCommand}
            </span>
            {agent.config?.model && (
              <span className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 mono">
                {agent.config.model}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={onChat}>对话</Button>
        <Button size="sm" variant="outline" onClick={onEdit}>编辑</Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>删除</Button>
      </div>
    </div>
  );
}
