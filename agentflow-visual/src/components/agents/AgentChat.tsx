import { useState, useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import type { LocalAgent, Message } from '@/types';
import { Button } from '@/components/shared/Button';
import { Textarea } from '@/components/shared/Form';
import { AgentIcon } from './AgentIcon';
import { useCLI } from '@/hooks/useCLI';
import { Send, Square, User, Bot } from 'lucide-react';

interface AgentChatProps {
  agent: LocalAgent;
}

export function AgentChat({ agent }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const runner = useCLI();
  const listRef = useRef<HTMLDivElement>(null);

  // reset when switching agent
  useEffect(() => {
    setMessages([
      {
        id: uuid(),
        role: 'assistant',
        content: `你好!我是 **${agent.name}**,请描述你的任务。`,
        timestamp: new Date().toISOString(),
      },
    ]);
  }, [agent.id, agent.name]);

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
    setMessages((prev) => [...prev, userMessage, aiMessage]);
    const task = input;
    setInput('');
    setIsRunning(true);

    try {
      await runner.execute(
        agent.id,
        task,
        (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessage.id ? { ...m, content: m.content + chunk } : m,
            ),
          );
        },
        (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiMessage.id
                ? { ...m, content: m.content + `\n[stderr] ${chunk}` }
                : m,
            ),
          );
        },
      );
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
        <div>
          <div className="font-semibold text-slate-800">{agent.name}</div>
          <div className="text-xs text-slate-500 mono">
            {agent.cliCommand}
            {agent.cliArgs ? ' ' + agent.cliArgs.join(' ') : ''}
          </div>
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-6 space-y-4">
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
  // simple ``` code block splitter
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
