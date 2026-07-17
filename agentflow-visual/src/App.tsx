import { useEffect, useState } from 'react';
import { Sidebar, type ViewKey } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AgentsPage } from '@/pages/AgentsPage';
import { ChatPage } from '@/pages/ChatPage';
import { TerminalPage } from '@/pages/TerminalPage';
import { WorkflowPage } from '@/pages/WorkflowPage';
import { SessionsPage } from '@/pages/SessionsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { useAgentStore } from '@/stores/agentStore';

export default function App() {
  const [view, setView] = useState<ViewKey>('dashboard');
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50">
      <Sidebar current={view} onChange={setView} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header view={view} />
        <main className="flex-1 overflow-hidden">
          {view === 'dashboard' && <DashboardPage onNavigate={setView} />}
          {view === 'agents' && <AgentsPage onOpenChat={() => setView('chat')} />}
          {view === 'chat' && <ChatPage />}
          {view === 'terminal' && <TerminalPage />}
          {view === 'workflow' && <WorkflowPage />}
          {view === 'sessions' && <SessionsPage />}
          {view === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
