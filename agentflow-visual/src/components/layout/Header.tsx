import type { ViewKey } from './Sidebar';

const titles: Record<ViewKey, string> = {
  dashboard: '控制台',
  agents: 'Agent 管理',
  chat: '对话',
  terminal: '终端',
  workflow: '工作流编排',
  sessions: '本地会话记录',
  settings: '设置',
};

export function Header({ view }: { view: ViewKey }) {
  return (
    <header className="h-14 shrink-0 flex items-center px-6 bg-white border-b border-slate-200">
      <h1 className="font-semibold text-slate-800">{titles[view]}</h1>
      <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          Server: <span className="mono">:3001</span>
        </span>
      </div>
    </header>
  );
}
