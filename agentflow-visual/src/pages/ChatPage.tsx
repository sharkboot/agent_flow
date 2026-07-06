import { useEffect, useState, useCallback } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { AgentChat } from '@/components/agents/AgentChat';
import { AgentIcon } from '@/components/agents/AgentIcon';
import clsx from '@/utils/clsx';
import { Plus, Trash2, MessageSquare, RefreshCcw } from 'lucide-react';

interface SessionSummary {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  size: number;
}

function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return d.toLocaleDateString();
}

export function ChatPage() {
  const { agents, selectedId, select } = useAgentStore();
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const loadSessions = useCallback(async (agentId: string, autoSelect: boolean) => {
    setLoadingSessions(true);
    setSessionsError(null);
    try {
      const resp = await fetch(`/api/cli/history/${encodeURIComponent(agentId)}/sessions`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { sessions: SessionSummary[] };
      setSessions(data.sessions);
      if (autoSelect) {
        // On agent switch, default to the newest session so users see recent
        // conversation immediately. If there are none, leave sessionId null
        // — that shows the "new chat" welcome bubble on the right.
        setSessionId(data.sessions[0]?.id ?? null);
      }
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  // Reload sessions whenever the selected agent changes.
  useEffect(() => {
    if (!selected) {
      setSessions([]);
      setSessionId(null);
      return;
    }
    loadSessions(selected.id, /* autoSelect */ true);
  }, [selected?.id, loadSessions]);

  const newSession = async () => {
    if (!selected) return;
    // Lightweight: just clear the selection. The server auto-creates on
    // the first message via SSE `session` event. This avoids empty phantom
    // sessions cluttering the sidebar when a user opens "new" and walks away.
    setSessionId(null);
  };

  const deleteSession = async (sid: string) => {
    if (!selected) return;
    if (!confirm('删除该会话?此操作不可撤销。')) return;
    try {
      const resp = await fetch(
        `/api/cli/history/${encodeURIComponent(selected.id)}/sessions/${encodeURIComponent(sid)}`,
        { method: 'DELETE' },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      // Refetch; if we just deleted the active one, drop the selection.
      const remaining = sessions.filter((s) => s.id !== sid);
      setSessions(remaining);
      if (sessionId === sid) setSessionId(remaining[0]?.id ?? null);
    } catch (err) {
      alert('删除失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  if (!selected) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500 text-sm">
        没有可用的 Agent,请先在 <span className="mx-1 font-medium">Agents</span> 页面创建
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* --- Agents column --------------------------------------------- */}
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white overflow-y-auto">
        <div className="px-4 py-3 border-b border-slate-200 text-xs uppercase text-slate-500">
          Agents
        </div>
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => select(a.id)}
            className={clsx(
              'w-full flex items-center gap-3 px-4 py-3 text-left transition border-l-2',
              a.id === selected.id
                ? 'bg-brand-50 border-brand-500'
                : 'hover:bg-slate-50 border-transparent',
            )}
          >
            <AgentIcon type={a.type} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{a.name}</div>
              <div className="text-xs text-slate-500 mono truncate">{a.cliCommand}</div>
            </div>
          </button>
        ))}
      </aside>

      {/* --- Sessions column ------------------------------------------- */}
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-slate-50 flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-slate-200 bg-white flex items-center gap-2 shrink-0">
          <span className="text-xs uppercase text-slate-500 flex-1 truncate">
            会话 · {selected.name}
          </span>
          <button
            onClick={() => loadSessions(selected.id, false)}
            disabled={loadingSessions}
            title="刷新"
            className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            <RefreshCcw size={13} className={loadingSessions ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={newSession}
            title="新建会话"
            className="p-1 rounded hover:bg-brand-50 text-brand-600"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* "new chat" placeholder row — only shown when nothing is selected
              so users can navigate back to the fresh-chat state after they
              picked an old session. */}
          <button
            onClick={() => setSessionId(null)}
            className={clsx(
              'w-full text-left px-3 py-2.5 border-b border-slate-100 flex items-center gap-2 transition',
              sessionId === null
                ? 'bg-brand-50 border-l-2 border-l-brand-500'
                : 'hover:bg-white border-l-2 border-l-transparent',
            )}
          >
            <Plus size={14} className="text-brand-500" />
            <span className="text-sm text-slate-700">新对话</span>
          </button>

          {sessionsError && (
            <div className="m-2 p-2 text-xs bg-red-50 text-red-700 border border-red-200 rounded">
              {sessionsError}
            </div>
          )}

          {sessions.length === 0 && !loadingSessions && !sessionsError && (
            <div className="px-3 py-6 text-center text-xs text-slate-400">
              还没有对话历史。
              <br />
              开始一次新对话吧。
            </div>
          )}

          {sessions.map((s) => (
            <div
              key={s.id}
              className={clsx(
                'group w-full flex items-start gap-2 px-3 py-2.5 border-b border-slate-100 cursor-pointer transition border-l-2',
                sessionId === s.id
                  ? 'bg-brand-50 border-l-brand-500'
                  : 'hover:bg-white border-l-transparent',
              )}
              onClick={() => setSessionId(s.id)}
            >
              <MessageSquare
                size={13}
                className={clsx(
                  'mt-0.5 shrink-0',
                  sessionId === s.id ? 'text-brand-600' : 'text-slate-400',
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-800 line-clamp-2 leading-snug">
                  {s.title}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                  <span className="font-mono truncate">{s.id.slice(-8)}</span>
                  <span>·</span>
                  <span>{s.messageCount} 条</span>
                  <span>·</span>
                  <span>{fmtTime(s.updatedAt)}</span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(s.id);
                }}
                title="删除会话"
                className="opacity-0 group-hover:opacity-100 transition text-slate-400 hover:text-red-600 p-0.5"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* --- Chat column ----------------------------------------------- */}
      <div className="flex-1 overflow-hidden">
        <AgentChat
          // Reset internal state cleanly when either agent or session changes.
          key={`${selected.id}::${sessionId ?? 'new'}`}
          agent={selected}
          sessionId={sessionId}
          onSessionEnsured={(sid) => {
            // The very first message in a "new" chat lands here. Pin the
            // session so subsequent messages append to the same file, and
            // refresh the sidebar so the new entry appears.
            setSessionId(sid);
            loadSessions(selected.id, false);
          }}
          onSessionUpdated={() => loadSessions(selected.id, false)}
        />
      </div>
    </div>
  );
}
