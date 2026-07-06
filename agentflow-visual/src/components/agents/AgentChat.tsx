import { useState, useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import type { LocalAgent, Message } from '@/types';
import { Button } from '@/components/shared/Button';
import { Textarea } from '@/components/shared/Form';
import { AgentIcon } from './AgentIcon';
import { useCLI } from '@/hooks/useCLI';
import { Send, Square, User, Bot, RefreshCcw } from 'lucide-react';

interface AgentChatProps {
  agent: LocalAgent;
  /** Session to load. `null` means "new chat, no messages yet". */
  sessionId: string | null;
  /**
   * Called when the server picks/creates a session for a message that
   * started without one. Parent should update its selected sessionId +
   * refresh the session list.
   */
  onSessionEnsured?: (sessionId: string) => void;
  /** Called after each successful message so the sidebar can refresh titles/counts. */
  onSessionUpdated?: (sessionId: string) => void;
}

interface HistoryResponse {
  agentId: string;
  sessionId: string;
  count: number;
  messages: {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    meta?: { status?: string; error?: string };
  }[];
}

const WELCOME = (agent: LocalAgent): Message => ({
  id: uuid(),
  role: 'assistant',
  content: `你好!我是 **${agent.name}**。这是一个新对话,请描述你的任务。`,
  timestamp: new Date().toISOString(),
});

export function AgentChat({
  agent,
  sessionId,
  onSessionEnsured,
  onSessionUpdated,
}: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const runner = useCLI();
  const listRef = useRef<HTMLDivElement>(null);
  // Track the session that our current messages actually belong to. If the
  // server auto-creates one via `onSessionEnsured`, `sessionId` (from props)
  // changes and would otherwise fire the loader again and blow away the
  // messages we just streamed.
  const activeSessionRef = useRef<string | null>(sessionId);

  const loadHistory = async (sid: string | null) => {
    activeSessionRef.current = sid;
    if (!sid) {
      setMessages([WELCOME(agent)]);
      setHistoryError(null);
      return;
    }
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const resp = await fetch(
        `/api/cli/history/${encodeURIComponent(agent.id)}/sessions/${encodeURIComponent(sid)}`,
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as HistoryResponse;
      if (data.messages.length === 0) {
        setMessages([WELCOME(agent)]);
      } else {
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          })),
        );
      }
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
      setMessages([WELCOME(agent)]);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, sessionId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isRunning) return;

    const userMessage: Message = {
      id: uuid(),
      role: 'user',
      content: input,
      timestamp: new Date().toISOString(),
    };
    const aiMessage: Message = {
      id: uuid(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };

    // If this is a fresh chat, drop the welcome bubble so the transcript
    // reads naturally.
    setMessages((prev) => {
      const clean =
        prev.length === 1 && prev[0].role === 'assistant' && prev[0].content.startsWith('你好')
          ? []
          : prev;
      return [...clean, userMessage, aiMessage];
    });
    const task = input;
    setInput('');
    setIsRunning(true);

    try {
      const result = await runner.execute({
        agentId: agent.id,
        sessionId: activeSessionRef.current ?? undefined,
        task,
        onSession: (sid) => {
          // Server just told us which session this run belongs to. Pin it
          // locally and lift it to the parent (which will refresh the list
          // and set it as the selected session).
          activeSessionRef.current = sid;
          onSessionEnsured?.(sid);
        },
        onOutput: (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessage.id ? { ...m, content: m.content + chunk } : m,
            ),
          );
        },
        onError: (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessage.id
                ? { ...m, content: m.content + `\n[stderr] ${chunk}` }
                : m,
            ),
          );
        },
      });
      const sid = (result as { sessionId?: string }).sessionId ?? activeSessionRef.current;
      if (sid) onSessionUpdated?.(sid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMessage.id
            ? { ...m, content: m.content + `\n\n❌ 执行失败: ${msg}` }
            : m,
        ),
      );
    } finally {
      setIsRunning(false);
    }
  };

  const cancel = () => {
    runner.cancel();
    setIsRunning(false);
  };

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-3">
        <AgentIcon type={agent.type} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-800 truncate">{agent.name}</div>
          <div className="text-xs text-slate-500 mono truncate">
            {sessionId ? `session · ${sessionId}` : '新对话 (发送后创建)'}
          </div>
        </div>
        {sessionId && (
          <button
            onClick={() => loadHistory(sessionId)}
            disabled={loadingHistory}
            title="重新加载"
            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            <RefreshCcw size={14} className={loadingHistory ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {historyError && (
        <div className="mx-6 mt-3 px-3 py-2 text-xs bg-red-50 text-red-700 border border-red-200 rounded">
          加载历史失败: {historyError}
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto p-6 space-y-4">
        {loadingHistory && messages.length === 0 && (
          <div className="text-xs text-slate-400 inline-flex items-center gap-2">
            <RefreshCcw size={12} className="animate-spin" /> 加载历史消息…
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} agent={agent} />
        ))}
        {isRunning && (
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            执行中...
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-4">
        <div className="flex gap-2 items-end">
          <Textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="输入消息 (Enter 发送,Shift+Enter 换行)"
            disabled={isRunning}
            className="flex-1"
          />
          {isRunning ? (
            <Button variant="danger" onClick={cancel}>
              <Square size={14} /> 停止
            </Button>
          ) : (
            <Button onClick={sendMessage} disabled={!input.trim()}>
              <Send size={14} /> 发送
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message, agent }: { message: Message; agent: LocalAgent }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-700'
        }`}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div className={`max-w-[75%] ${isUser ? 'text-right' : ''}`}>
        <div className="text-xs text-slate-500 mb-1">
          {isUser ? '你' : agent.name}
        </div>
        <div
          className={`inline-block px-4 py-2.5 rounded-lg text-sm whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 text-slate-800 border border-slate-200'
          }`}
        >
          {renderContent(message.content)}
        </div>
      </div>
    </div>
  );
}

function renderContent(text: string) {
  if (!text) return <span className="italic opacity-60">(等待输出)</span>;
  const parts = text.split(/```(\w*)\n?/);
  if (parts.length <= 1) return <span>{text}</span>;
  const out: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      out.push(<span key={i}>{parts[i]}</span>);
    } else {
      const lang = parts[i];
      const code = parts[i + 1] ?? '';
      out.push(
        <pre key={i} className="chat-code my-2">
          {lang && <div className="text-xs text-slate-400 mb-1">{lang}</div>}
          {code.replace(/```\s*$/, '')}
        </pre>,
      );
      i++;
    }
  }
  return out;
}
