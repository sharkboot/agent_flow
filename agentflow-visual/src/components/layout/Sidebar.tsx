import { Home, Users, MessageSquare, Workflow, Settings, FolderTree, Terminal, type LucideIcon } from 'lucide-react';
import clsx from '@/utils/clsx';

export type ViewKey = 'dashboard' | 'agents' | 'chat' | 'terminal' | 'workflow' | 'sessions' | 'settings';

const items: { key: ViewKey; label: string; icon: LucideIcon }[] = [
  { key: 'dashboard', label: '控制台', icon: Home },
  { key: 'agents', label: 'Agents', icon: Users },
  { key: 'chat', label: '对话', icon: MessageSquare },
  { key: 'terminal', label: '终端', icon: Terminal },
  { key: 'workflow', label: '工作流', icon: Workflow },
  { key: 'sessions', label: '会话记录', icon: FolderTree },
  { key: 'settings', label: '设置', icon: Settings },
];

interface SidebarProps {
  current: ViewKey;
  onChange: (v: ViewKey) => void;
}

export function Sidebar({ current, onChange }: SidebarProps) {
  return (
    <aside className="w-56 shrink-0 bg-slate-900 text-slate-100 flex flex-col">
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="text-lg font-semibold tracking-wide">AgentFlow</div>
        <div className="text-xs text-slate-400">Visual</div>
      </div>
      <nav className="flex-1 py-3">
        {items.map((it) => {
          const Icon = it.icon;
          const active = current === it.key;
          return (
            <button
              key={it.key}
              onClick={() => onChange(it.key)}
              className={clsx(
                'w-full flex items-center gap-3 px-5 py-2.5 text-sm transition',
                active
                  ? 'bg-slate-800 text-white border-l-2 border-brand-500'
                  : 'text-slate-300 hover:bg-slate-800/60 border-l-2 border-transparent',
              )}
            >
              <Icon size={18} />
              <span>{it.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="p-4 text-xs text-slate-500 border-t border-slate-800">
        <div>v0.1.0 · localhost</div>
      </div>
    </aside>
  );
}
