import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RefreshCcw, FolderTree, MessageSquare, Terminal, Clock, HardDrive, Search, X, Brain, Wrench, User, Bot, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from '@/utils/clsx';

// -----------------------------------------------------------------------------
// Types (mirror server/cli/sessionScanner.ts)
// -----------------------------------------------------------------------------

type SessionTool = 'claude' | 'codex' | 'hermes' | 'openclaw';

interface SessionRecord {
  tool: SessionTool;
  id: string;
  file: string;
  cwd?: string;
  project?: string;
  startTime?: string;
  endTime?: string;
  size: number;
  version?: string;
  model?: string;
  reason?: string;
  agent?: string;
  lastMessage?: string;
  raw?: { firstLine?: string; lastLine?: string };
}

interface ScanResult {
  updatedAt: string;
  roots: Record<SessionTool, string[]>;
  sessions: SessionRecord[];
  counts: Record<SessionTool, number>;
}

type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'thinking' | 'meta';

interface SessionMessage {
  index: number;
  role: MessageRole;
  timestamp?: string;
  text?: string;
  thinking?: string;
  toolCalls?: {
    id?: string;
    name: string;
    arguments?: unknown;
    result?: string;
  }[];
  meta?: Record<string, unknown>;
}

interface MessagesResult {
  tool: SessionTool;
  file: string;
  truncated: boolean;
  totalScanned: number;
  messages: SessionMessage[];
}

// -----------------------------------------------------------------------------
// Presentation helpers
// -----------------------------------------------------------------------------

const TOOL_META: Record<SessionTool, { label: string; color: string; badge: string }> = {
  claude:   { label: 'Claude',   color: 'text-orange-600',  badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  codex:    { label: 'Codex',    color: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  hermes:   { label: 'Hermes',   color: 'text-violet-600',  badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  openclaw: { label: 'OpenClaw', color: 'text-sky-600',     badge: 'bg-sky-50 text-sky-700 border-sky-200' },
};

function fmtSize(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return d.toLocaleString();
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export function SessionsPage() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SessionTool | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SessionRecord | null>(null);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/sessions${refresh ? '?refresh=1' : ''}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = (await resp.json()) as ScanResult;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(false);
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [] as SessionRecord[];
    const q = query.trim().toLowerCase();
    return data.sessions.filter((s) => {
      if (filter !== 'all' && s.tool !== filter) return false;
      if (!q) return true;
      const hay = [s.id, s.cwd, s.project, s.model, s.agent, s.lastMessage, s.file]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, filter, query]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3 flex items-center gap-3">
        <FolderTree size={18} className="text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-800">本地会话记录</h2>
        <span className="text-xs text-slate-500">
          {data ? `${data.sessions.length} 条` : '扫描中…'}
        </span>
        <div className="flex-1" />

        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 ID / 目录 / 消息…"
            className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 w-64"
          />
        </div>

        <button
          onClick={() => load(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50"
          title="重新扫描"
        >
          <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* Filter chips */}
      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-6 py-2 flex items-center gap-2">
        <FilterChip
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label="全部"
          count={data?.sessions.length}
        />
        {(['claude', 'codex', 'hermes', 'openclaw'] as SessionTool[]).map((t) => (
          <FilterChip
            key={t}
            active={filter === t}
            onClick={() => setFilter(t)}
            label={TOOL_META[t].label}
            count={data?.counts[t]}
            tint={TOOL_META[t].badge}
          />
        ))}
        {data && (
          <span className="ml-auto text-xs text-slate-400">
            扫描于 {new Date(data.updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-6 p-3 border border-red-200 bg-red-50 text-sm text-red-700 rounded-md">
              加载失败: {error}
            </div>
          )}

          {!error && filtered.length === 0 && !loading && (
            <div className="p-10 text-center text-sm text-slate-500">
              没有找到会话记录。检查工具是否已安装、并在本机产生过日志。
            </div>
          )}

          <ul className="divide-y divide-slate-100">
            {filtered.map((s) => (
              <li
                key={`${s.tool}::${s.file}`}
                onClick={() => setSelected(s)}
                className={clsx(
                  'px-6 py-3 hover:bg-slate-50 cursor-pointer transition',
                  selected?.file === s.file && 'bg-brand-50/60',
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={clsx(
                      'text-xs px-2 py-0.5 rounded border font-medium',
                      TOOL_META[s.tool].badge,
                    )}
                  >
                    {TOOL_META[s.tool].label}
                  </span>
                  <span className="text-sm font-mono text-slate-700 truncate">
                    {shortId(s.id)}
                  </span>
                  {s.agent && (
                    <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {s.agent}
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                    <Clock size={12} /> {fmtTime(s.endTime)}
                  </span>
                  <span className="text-xs text-slate-500 inline-flex items-center gap-1 w-16 justify-end">
                    <HardDrive size={12} /> {fmtSize(s.size)}
                  </span>
                </div>
                {(s.cwd || s.lastMessage) && (
                  <div className="mt-1 text-xs text-slate-500 truncate">
                    {s.cwd && (
                      <span className="inline-flex items-center gap-1 mr-3 font-mono">
                        <Terminal size={11} /> {s.cwd}
                      </span>
                    )}
                    {s.lastMessage && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare size={11} /> {s.lastMessage}
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        {selected && <DetailPanel record={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------------

function FilterChip({
  active,
  onClick,
  label,
  count,
  tint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  tint?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition',
        active
          ? tint
            ? tint + ' font-medium'
            : 'bg-brand-500 text-white border-brand-500 font-medium'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
      )}
    >
      {label}
      {typeof count === 'number' && (
        <span className={clsx('text-[10px] tabular-nums', active ? '' : 'text-slate-400')}>
          {count}
        </span>
      )}
    </button>
  );
}

function DetailPanel({ record, onClose }: { record: SessionRecord; onClose: () => void }) {
  const [tab, setTab] = useState<'chat' | 'meta'>('chat');
  const [msgs, setMsgs] = useState<MessagesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMsgs(null);
    setError(null);
    setLoading(true);
    const url = `/api/sessions/messages?tool=${encodeURIComponent(record.tool)}&file=${encodeURIComponent(record.file)}&limit=500`;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as MessagesResult;
      })
      .then((j) => {
        if (!cancelled) setMsgs(j);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [record.file, record.tool]);

  return (
    <aside className="w-[560px] shrink-0 border-l border-slate-200 bg-white overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
        <span
          className={clsx('text-xs px-2 py-0.5 rounded border font-medium', TOOL_META[record.tool].badge)}
        >
          {TOOL_META[record.tool].label}
        </span>
        <span className="text-sm font-semibold text-slate-800 truncate">{shortId(record.id)}</span>
        <button className="ml-auto text-slate-400 hover:text-slate-600" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="border-b border-slate-200 flex items-center px-4 shrink-0 text-sm">
        <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} label={
          <>对话内容 {msgs && <span className="text-[10px] text-slate-400 ml-1">({msgs.messages.length}{msgs.truncated ? '+' : ''})</span>}</>
        } />
        <TabButton active={tab === 'meta'} onClick={() => setTab('meta')} label="元数据" />
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'meta' && <MetaPane record={record} />}
        {tab === 'chat' && (
          <ChatPane loading={loading} error={error} data={msgs} />
        )}
      </div>
    </aside>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-3 py-2 border-b-2 -mb-px transition',
        active
          ? 'border-brand-500 text-brand-700 font-medium'
          : 'border-transparent text-slate-500 hover:text-slate-800',
      )}
    >
      {label}
    </button>
  );
}

function MetaPane({ record }: { record: SessionRecord }) {
  return (
    <div>
      <dl className="px-4 py-3 text-xs space-y-2">
        <Field label="Session ID" value={record.id} mono />
        <Field label="文件" value={record.file} mono wrap />
        <Field label="工作目录" value={record.cwd} mono />
        {record.project && <Field label="项目 / Agent" value={record.project} />}
        {record.model && <Field label="模型" value={record.model} />}
        {record.version && <Field label="版本" value={record.version} />}
        {record.reason && <Field label="结束原因" value={record.reason} />}
        <Field label="开始时间" value={record.startTime ? new Date(record.startTime).toLocaleString() : '—'} />
        <Field label="结束时间" value={record.endTime ? new Date(record.endTime).toLocaleString() : '—'} />
        <Field label="大小" value={fmtSize(record.size)} />
        {record.lastMessage && <Field label="最后消息" value={record.lastMessage} wrap />}
      </dl>

      {record.raw && (
        <div className="border-t border-slate-100 px-4 py-3">
          <h4 className="text-xs font-semibold text-slate-700 mb-2">原始行 (首/尾)</h4>
          {record.raw.firstLine && (
            <>
              <div className="text-[10px] uppercase text-slate-500 mt-2">首行</div>
              <pre className="mt-1 p-2 bg-slate-900 text-slate-100 text-[11px] rounded overflow-x-auto max-h-40">
                {record.raw.firstLine}
              </pre>
            </>
          )}
          {record.raw.lastLine && (
            <>
              <div className="text-[10px] uppercase text-slate-500 mt-3">尾行</div>
              <pre className="mt-1 p-2 bg-slate-900 text-slate-100 text-[11px] rounded overflow-x-auto max-h-40">
                {record.raw.lastLine}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChatPane({
  loading,
  error,
  data,
}: {
  loading: boolean;
  error: string | null;
  data: MessagesResult | null;
}) {
  if (loading) {
    return (
      <div className="p-6 text-sm text-slate-500 inline-flex items-center gap-2">
        <RefreshCcw size={14} className="animate-spin" />
        加载会话消息…
      </div>
    );
  }
  if (error) {
    return (
      <div className="m-4 p-3 border border-red-200 bg-red-50 text-sm text-red-700 rounded-md">
        {error}
      </div>
    );
  }
  if (!data || data.messages.length === 0) {
    return <div className="p-6 text-sm text-slate-500">此文件没有可展示的消息。</div>;
  }
  return (
    <div className="flex flex-col">
      {data.truncated && (
        <div className="m-3 px-3 py-2 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded">
          仅显示前 {data.messages.length} 条消息 · 共扫描 {data.totalScanned} 行
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {data.messages.map((m) => (
          <MessageRow key={m.index} msg={m} />
        ))}
      </div>
    </div>
  );
}

const ROLE_META: Record<
  MessageRole,
  { label: string; icon: typeof User; tint: string; bg: string }
> = {
  user:      { label: '用户',   icon: User,         tint: 'text-sky-700',     bg: 'bg-sky-50 border-sky-200' },
  assistant: { label: 'AI',     icon: Bot,          tint: 'text-emerald-700', bg: 'bg-white border-slate-200' },
  system:    { label: '系统',   icon: Terminal,     tint: 'text-slate-500',   bg: 'bg-slate-50 border-slate-200' },
  thinking:  { label: '思考',   icon: Brain,        tint: 'text-violet-700',  bg: 'bg-violet-50/60 border-violet-200' },
  tool:      { label: '工具',   icon: Wrench,       tint: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200' },
  meta:      { label: '标记',   icon: FolderTree,   tint: 'text-slate-500',   bg: 'bg-slate-50 border-slate-200' },
};

function MessageRow({ msg }: { msg: SessionMessage }) {
  const cfg = ROLE_META[msg.role];
  const Icon = cfg.icon;
  const [showThinking, setShowThinking] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const time = msg.timestamp ? new Date(msg.timestamp) : null;

  return (
    <div className={clsx('px-4 py-3 border-l-4 border-transparent', cfg.bg)}>
      <div className="flex items-center gap-2 mb-1 text-xs">
        <span className={clsx('inline-flex items-center gap-1 font-medium', cfg.tint)}>
          <Icon size={12} /> {cfg.label}
        </span>
        <span className="text-slate-400 tabular-nums">#{msg.index}</span>
        {time && (
          <span className="text-slate-400" title={time.toLocaleString()}>
            {time.toLocaleTimeString()}
          </span>
        )}
        {!!msg.meta?.model && (
          <span className="text-slate-500 bg-white/60 border border-slate-200 px-1.5 rounded">
            {String(msg.meta.model)}
          </span>
        )}
      </div>

      {msg.thinking && (
        <div className="mb-2">
          <button
            className="text-[11px] text-violet-700 inline-flex items-center gap-1 hover:underline"
            onClick={() => setShowThinking((v) => !v)}
          >
            {showThinking ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            思考过程 ({msg.thinking.length} 字符)
          </button>
          {showThinking && (
            <pre className="mt-1 whitespace-pre-wrap text-[12px] text-violet-900 bg-white/70 rounded p-2 border border-violet-200 max-h-64 overflow-y-auto">
              {msg.thinking}
            </pre>
          )}
        </div>
      )}

      {msg.text && (
        <pre className="whitespace-pre-wrap break-words text-sm text-slate-800 font-sans">
          {msg.text}
        </pre>
      )}

      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="mt-2">
          <button
            className="text-[11px] text-amber-800 inline-flex items-center gap-1 hover:underline"
            onClick={() => setShowTools((v) => !v)}
          >
            {showTools ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            工具调用 · {msg.toolCalls.length}
          </button>
          {showTools && (
            <ul className="mt-1 space-y-1">
              {msg.toolCalls.map((tc, i) => (
                <ToolCallBlock key={i} tc={tc} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ tc }: { tc: NonNullable<SessionMessage['toolCalls']>[number] }) {
  const [open, setOpen] = useState(false);
  const argStr =
    tc.arguments != null
      ? typeof tc.arguments === 'string'
        ? tc.arguments
        : JSON.stringify(tc.arguments, null, 2)
      : '';
  const isResult = tc.name === 'tool_result';

  return (
    <li className={clsx('rounded border text-[12px]', isResult ? 'bg-white border-slate-200' : 'bg-white border-amber-200')}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1 text-left"
      >
        {open ? <ChevronDown size={11} className="text-slate-400" /> : <ChevronRight size={11} className="text-slate-400" />}
        <span className={clsx('font-mono', isResult ? 'text-slate-700' : 'text-amber-800')}>
          {isResult ? '→ result' : tc.name}
        </span>
        {tc.id && <span className="text-slate-400 text-[10px]">{tc.id.slice(0, 8)}</span>}
      </button>
      {open && (
        <>
          {argStr && (
            <pre className="px-2 pb-2 text-[11px] bg-slate-900/95 text-slate-100 overflow-x-auto max-h-64 rounded-b">
              {argStr}
            </pre>
          )}
          {tc.result && (
            <pre className="px-2 pb-2 text-[11px] bg-slate-50 text-slate-800 overflow-x-auto whitespace-pre-wrap max-h-64 border-t border-slate-200">
              {tc.result}
            </pre>
          )}
        </>
      )}
    </li>
  );
}

function Field({ label, value, mono, wrap }: { label: string; value?: string; mono?: boolean; wrap?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-[10px] uppercase text-slate-500">{label}</dt>
      <dd
        className={clsx(
          'text-slate-800',
          mono && 'font-mono text-[11px]',
          wrap ? 'break-all' : 'truncate',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
