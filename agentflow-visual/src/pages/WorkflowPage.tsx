import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/shared/Button';
import { useAgentStore } from '@/stores/agentStore';
import { useWorkflowStore, type WorkflowDefinition } from '@/stores/workflowStore';
import {
  Play, Save, FileInput, FileOutput, GitBranch, Plus, Trash2, ChevronRight,
  RefreshCcw, Loader2, CheckCircle2, XCircle, Circle,
} from 'lucide-react';
import { nodeTypes, type NodeRunStatus } from '@/components/workflow/WorkflowNodes';
import { WorkflowConfigPanel } from '@/components/workflow/WorkflowConfigPanel';
import clsx from '@/utils/clsx';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ExecutionLogEntry {
  nodeId: string;
  nodeType?: string;
  label?: string;
  status: 'running' | 'completed' | 'failed';
  output?: string;
  durationMs?: number;
  timestamp: string;
}

// -----------------------------------------------------------------------------
// Defaults
// -----------------------------------------------------------------------------

const DEFAULT_WORKFLOW_NAME = '未命名工作流';

const initialNodes: Node[] = [
  { id: 'input-1',  type: 'input',  position: { x: 100, y:  50 }, data: { label: '输入', inputVar: 'input' } },
  { id: 'output-1', type: 'output', position: { x: 100, y: 300 }, data: { label: '输出', outputVar: 'output' } },
];
const initialEdges: Edge[] = [];

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export function WorkflowPage() {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // The workflow currently loaded from disk (null = unsaved buffer)
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState(DEFAULT_WORKFLOW_NAME);
  const [dirty, setDirty] = useState(false);

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const [runLog, setRunLog] = useState<ExecutionLogEntry[]>([]);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({ input: '' });
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const agents = useAgentStore((s) => s.agents);
  const {
    workflows,
    fetchWorkflows,
    saveWorkflow,
    updateWorkflow,
    deleteWorkflow,
    loadWorkflow,
    currentWorkflow,
  } = useWorkflowStore();

  // -------------------------------------------------------------------------
  // Load workflows once
  // -------------------------------------------------------------------------
  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  // Whenever the store's currentWorkflow changes to a new id, hydrate the canvas.
  useEffect(() => {
    if (!currentWorkflow) return;
    if (currentWorkflow.id === currentId && !dirty) return;
    setCurrentId(currentWorkflow.id);
    setWorkflowName(currentWorkflow.name);
    setNodes(currentWorkflow.nodes.map(stripRunState));
    setEdges(currentWorkflow.edges);
    setRunLog([]);
    setDirty(false);

  }, [currentWorkflow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark dirty on any user-driven graph change (but not on loading)
  const markDirty = useCallback(() => setDirty(true), []);

  // -------------------------------------------------------------------------
  // ReactFlow wiring
  // -------------------------------------------------------------------------

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeBase(changes);
      const structural = changes.some((c) => c.type === 'position' || c.type === 'add' || c.type === 'remove' || c.type === 'replace');
      if (structural) markDirty();
      const sel = changes.find((c) => c.type === 'select' && c.selected);
      if (sel && sel.type === 'select') {
        const node = nodes.find((n) => n.id === sel.id);
        if (node) {
          setSelectedNode(node);
          setShowConfig(true);
        }
      }
    },
    [onNodesChangeBase, nodes, markDirty],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChangeBase(changes);
      if (changes.some((c) => c.type === 'add' || c.type === 'remove' || c.type === 'replace')) markDirty();
    },
    [onEdgesChangeBase, markDirty],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge(params, eds));
      markDirty();
    },
    [setEdges, markDirty],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setShowConfig(true);
  }, []);

  const onUpdateNode = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)));
      markDirty();
    },
    [setNodes, markDirty],
  );

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      markDirty();
    },
    [setNodes, setEdges, markDirty],
  );

  const addNode = (type: 'input' | 'output' | 'agent' | 'condition') => {
    const id = `${type}-${Date.now()}`;
    const baseData = { label: type === 'input' ? '输入' : type === 'output' ? '输出' : type === 'agent' ? 'Agent' : '条件' };
    const extraData = type === 'input' ? { inputVar: 'input' } : type === 'output' ? { outputVar: 'output' } : {};
    setNodes((nds) => [
      ...nds,
      { id, type, position: { x: 200 + nds.length * 20, y: 100 + nds.length * 30 }, data: { ...baseData, ...extraData } },
    ]);
    markDirty();
  };

  const addAgentNode = (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    const id = `agent-${Date.now()}`;
    setNodes((nds) => [
      ...nds,
      { id, type: 'agent', position: { x: 200 + nds.length * 20, y: 100 + nds.length * 30 }, data: { label: agent.name, agentId } },
    ]);
    markDirty();
  };

  // -------------------------------------------------------------------------
  // Workflow ops
  // -------------------------------------------------------------------------

  const flashSaved = (msg: string) => {
    setSavedNotice(msg);
    setTimeout(() => setSavedNotice(null), 1800);
  };

  const doNew = () => {
    if (dirty && !confirm('当前工作流未保存，继续新建将丢失更改。')) return;
    setCurrentId(null);
    setWorkflowName(DEFAULT_WORKFLOW_NAME);
    setNodes(initialNodes);
    setEdges(initialEdges);
    setRunLog([]);
    setDirty(false);
  };

  const doLoad = async (id: string) => {
    if (dirty && !confirm('当前工作流未保存，继续切换将丢失更改。')) return;
    await loadWorkflow(id);
  };

  const doDelete = async (id: string, name: string) => {
    if (!confirm(`确认删除工作流 "${name}"?`)) return;
    await deleteWorkflow(id);
    if (currentId === id) doNew();
  };

  const doSave = async () => {
    const cleanNodes = nodes.map(stripRunState);
    try {
      if (currentId) {
        await updateWorkflow(currentId, { name: workflowName, nodes: cleanNodes, edges });
        setDirty(false);
        flashSaved('已保存');
      } else {
        const created = await saveWorkflow({ name: workflowName, nodes: cleanNodes, edges, variables: {} });
        setCurrentId(created.id);
        setDirty(false);
        flashSaved('已创建');
      }
    } catch (err) {
      alert('保存失败: ' + String(err));
    }
  };

  const doSaveAs = async () => {
    const name = prompt('另存为...', workflowName + ' 副本') || '';
    if (!name.trim()) return;
    const cleanNodes = nodes.map(stripRunState);
    const created = await saveWorkflow({ name: name.trim(), nodes: cleanNodes, edges, variables: {} });
    setCurrentId(created.id);
    setWorkflowName(created.name);
    setDirty(false);
    flashSaved('已另存为 ' + created.name);
  };

  // -------------------------------------------------------------------------
  // Execution — real SSE via /api/workflows/:id/execute (needs a saved id)
  // -------------------------------------------------------------------------

  const applyRunUpdate = useCallback(
    (nodeId: string, patch: { runStatus?: NodeRunStatus; runDurationMs?: number; runMessage?: string }) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
    },
    [setNodes],
  );

  const resetRunState = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) => ({ ...n, data: { ...n.data, runStatus: 'pending', runDurationMs: undefined, runMessage: undefined } })),
    );
    setRunLog([]);
  }, [setNodes]);

  const executeWorkflow = async () => {
    if (!currentId) {
      alert('请先保存工作流后再运行。');
      return;
    }
    setIsRunning(true);
    resetRunState();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/workflows/${currentId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: runInputs }),
        signal: controller.signal,
      });
      if (!res.body) throw new Error('无响应流');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(line.slice(5)) as { type: string; data: any };
            if (evt.type === 'log') {
              const entry = evt.data as ExecutionLogEntry;
              setRunLog((prev) => [...prev, entry]);
              const runStatus: NodeRunStatus =
                entry.status === 'completed' ? 'completed' :
                entry.status === 'failed' ? 'failed' : 'running';
              applyRunUpdate(entry.nodeId, {
                runStatus,
                runDurationMs: entry.durationMs,
                runMessage: entry.output?.slice(0, 200),
              });
            } else if (evt.type === 'complete') {
              // Terminal event — mark any still-running node as completed
              setNodes((nds) =>
                nds.map((n) =>
                  n.data.runStatus === 'running'
                    ? { ...n, data: { ...n.data, runStatus: 'completed' } }
                    : n,
                ),
              );
            } else if (evt.type === 'error') {
              setRunLog((prev) => [
                ...prev,
                { nodeId: 'system', status: 'failed', output: String(evt.data?.message || evt.data), timestamp: new Date().toISOString() },
              ]);
            }
          } catch {
            // ignore parse error
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        setRunLog((prev) => [
          ...prev,
          { nodeId: 'system', status: 'failed', output: String(err), timestamp: new Date().toISOString() },
        ]);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const cancelExecution = () => {
    abortRef.current?.abort();
    setIsRunning(false);
  };

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  const runInputVars = useMemo(() => {
    // Every input node's `inputVar` is a run-time variable name we should collect.
    const vars = new Set<string>();
    for (const n of nodes) {
      if (n.type === 'input') {
        const v = (n.data.inputVar as string) || 'input';
        vars.add(v);
      }
    }
    if (vars.size === 0) vars.add('input');
    return Array.from(vars);
  }, [nodes]);

  const runSummary = useMemo(() => {
    let done = 0, failed = 0, running = 0;
    for (const n of nodes) {
      const s = n.data.runStatus as NodeRunStatus | undefined;
      if (s === 'completed') done++;
      else if (s === 'failed') failed++;
      else if (s === 'running') running++;
    }
    return { done, failed, running, total: nodes.length };
  }, [nodes]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="px-6 py-3 border-b border-slate-200 flex items-center gap-3 bg-white">
        <input
          value={workflowName}
          onChange={(e) => { setWorkflowName(e.target.value); markDirty(); }}
          className="text-sm font-medium px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-brand-500 focus:outline-none min-w-[200px]"
        />
        <span className={clsx('text-xs px-1.5 py-0.5 rounded', dirty ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500')}>
          {dirty ? '未保存' : currentId ? '已保存' : '草稿'}
        </span>
        <div className="text-xs text-slate-400">
          {nodes.length} 节点, {edges.length} 连接
        </div>
        {savedNotice && (
          <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
            {savedNotice}
          </span>
        )}
        <div className="ml-auto flex gap-2 items-center">
          {isRunning && (
            <span className="inline-flex items-center gap-1 text-xs text-blue-700 mr-1">
              <Loader2 size={12} className="animate-spin" /> 运行中 {runSummary.done}/{runSummary.total}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={doNew}>
            新建
          </Button>
          <Button variant="outline" size="sm" onClick={doSaveAs}>
            另存为
          </Button>
          <Button variant="outline" size="sm" onClick={doSave}>
            <Save size={14} /> 保存
          </Button>
          {isRunning ? (
            <Button size="sm" variant="danger" onClick={cancelExecution}>
              停止
            </Button>
          ) : (
            <Button size="sm" onClick={executeWorkflow} disabled={nodes.length === 0}>
              <Play size={14} /> 运行
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left rail — palette + saved list */}
        <aside className="w-60 shrink-0 bg-white border-r border-slate-200 overflow-y-auto flex flex-col">
          <div className="p-3 border-b border-slate-200">
            <div className="text-xs uppercase text-slate-500 mb-2">节点</div>
            <div className="space-y-1.5">
              <PaletteBtn onClick={() => addNode('input')} label="输入节点" icon={<FileInput size={13} className="text-green-600" />} color="green" />
              <PaletteBtn onClick={() => addNode('output')} label="输出节点" icon={<FileOutput size={13} className="text-blue-600" />} color="blue" />
              <PaletteBtn onClick={() => addNode('condition')} label="条件节点" icon={<GitBranch size={13} className="text-orange-600" />} color="orange" />
            </div>
            <div className="text-xs text-slate-600 mt-3 mb-1.5">Agents</div>
            {agents.length === 0 ? (
              <div className="text-xs text-slate-400 italic">请先创建 Agent</div>
            ) : (
              <div className="space-y-1.5">
                {agents.map((a) => (
                  <PaletteBtn
                    key={a.id}
                    onClick={() => addAgentNode(a.id)}
                    label={a.name}
                    icon={<Play size={11} className="text-purple-600" />}
                    color="purple"
                  />
                ))}
              </div>
            )}
          </div>

          <div className="p-3 flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xs uppercase text-slate-500">已保存工作流</div>
              <button onClick={() => fetchWorkflows()} className="ml-auto text-slate-400 hover:text-slate-600" title="刷新">
                <RefreshCcw size={11} />
              </button>
            </div>
            {workflows.length === 0 ? (
              <div className="text-xs text-slate-400 italic">还没有保存过工作流</div>
            ) : (
              <ul className="space-y-1">
                {workflows.map((w) => (
                  <li
                    key={w.id}
                    className={clsx(
                      'group flex items-center gap-1 rounded border px-2 py-1.5 text-xs cursor-pointer',
                      w.id === currentId
                        ? 'bg-brand-50 border-brand-300 text-brand-800'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                    )}
                    onClick={() => doLoad(w.id)}
                  >
                    <ChevronRight size={11} className={w.id === currentId ? 'text-brand-500' : 'text-slate-400'} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{w.name}</div>
                      <div className="text-[10px] text-slate-500">
                        {w.nodes.length} 节点 · {new Date(w.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition"
                      onClick={(e) => { e.stopPropagation(); doDelete(w.id, w.name); }}
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={doNew}
              className="mt-3 w-full text-xs flex items-center justify-center gap-1 text-slate-500 hover:text-brand-600 hover:bg-brand-50 py-1.5 rounded border border-dashed border-slate-300"
            >
              <Plus size={12} /> 新建工作流
            </button>
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {/* Right rail — run inputs + timeline */}
        <aside className="w-[340px] shrink-0 border-l border-slate-200 bg-white overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-200 shrink-0">
            <div className="text-xs uppercase text-slate-500 mb-2">运行输入</div>
            <div className="space-y-1.5">
              {runInputVars.map((k) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono w-16 shrink-0 text-slate-500">{k}</span>
                  <input
                    className="flex-1 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={runInputs[k] || ''}
                    onChange={(e) => setRunInputs((prev) => ({ ...prev, [k]: e.target.value }))}
                    placeholder="值…"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 border-b border-slate-200 shrink-0 flex items-center gap-3 text-xs">
            <StatChip icon={CheckCircle2} className="text-emerald-600" value={runSummary.done} label="完成" />
            <StatChip icon={Loader2}       className={clsx('text-blue-600', isRunning && 'animate-spin')} value={runSummary.running} label="进行" />
            <StatChip icon={XCircle}       className="text-red-600" value={runSummary.failed} label="失败" />
            <StatChip icon={Circle}        className="text-slate-400" value={runSummary.total - runSummary.done - runSummary.running - runSummary.failed} label="待运行" />
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="text-xs uppercase text-slate-500 mb-2">执行时间线</div>
            {runLog.length === 0 ? (
              <div className="text-xs text-slate-400 italic">还未运行过</div>
            ) : (
              <ol className="space-y-1.5">
                {runLog.map((e, i) => <LogRow key={i} entry={e} />)}
              </ol>
            )}
          </div>
        </aside>
      </div>

      {showConfig && selectedNode && (
        <WorkflowConfigPanel
          selectedNode={selectedNode}
          nodes={nodes}
          edges={edges}
          onClose={() => { setShowConfig(false); setSelectedNode(null); }}
          onUpdateNode={onUpdateNode}
          onDeleteNode={onDeleteNode}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Little components
// -----------------------------------------------------------------------------

function PaletteBtn({
  onClick, label, icon, color,
}: { onClick: () => void; label: string; icon: React.ReactNode; color: 'green' | 'blue' | 'orange' | 'purple' }) {
  const cls =
    color === 'green' ? 'border-green-200 hover:bg-green-50' :
    color === 'blue' ? 'border-blue-200 hover:bg-blue-50' :
    color === 'orange' ? 'border-orange-200 hover:bg-orange-50' :
    'border-purple-200 hover:bg-purple-50';
  return (
    <button
      className={clsx('w-full text-left px-2 py-1.5 rounded border text-xs flex items-center gap-1.5 truncate', cls)}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function StatChip({
  icon: Icon, className, value, label,
}: { icon: typeof CheckCircle2; className?: string; value: number; label: string }) {
  return (
    <div className="inline-flex items-center gap-1 text-slate-600">
      <Icon size={12} className={className} />
      <span className="tabular-nums font-medium">{value}</span>
      <span className="text-slate-400">{label}</span>
    </div>
  );
}

function LogRow({ entry }: { entry: ExecutionLogEntry }) {
  const Icon =
    entry.status === 'completed' ? CheckCircle2 :
    entry.status === 'failed' ? XCircle :
    Loader2;
  const iconClass =
    entry.status === 'completed' ? 'text-emerald-600' :
    entry.status === 'failed' ? 'text-red-600' :
    'text-blue-600 animate-spin';
  const bg =
    entry.status === 'completed' ? 'bg-emerald-50 border-emerald-200' :
    entry.status === 'failed' ? 'bg-red-50 border-red-200' :
    'bg-blue-50 border-blue-200';
  const label = entry.label || entry.nodeId;
  const time = new Date(entry.timestamp);
  return (
    <li className={clsx('border rounded p-2 text-xs', bg)}>
      <div className="flex items-center gap-1.5">
        <Icon size={11} className={iconClass} />
        <span className="font-medium truncate">{label}</span>
        {entry.nodeType && <span className="text-[10px] text-slate-500 bg-white/60 px-1 rounded">{entry.nodeType}</span>}
        <span className="ml-auto text-[10px] text-slate-500 tabular-nums" title={time.toLocaleString()}>
          {time.toLocaleTimeString()}
        </span>
        {typeof entry.durationMs === 'number' && (
          <span className="text-[10px] text-slate-500 tabular-nums">{entry.durationMs}ms</span>
        )}
      </div>
      {entry.output && (
        <pre className="mt-1 text-[11px] text-slate-700 whitespace-pre-wrap break-all">
          {entry.output.length > 400 ? entry.output.slice(0, 400) + '…' : entry.output}
        </pre>
      )}
    </li>
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Strip transient run-state fields from a node's data before persisting. */
function stripRunState(n: Node): Node {
  const { runStatus, runDurationMs, runMessage, ...rest } = (n.data as Record<string, unknown>) || {};
  void runStatus; void runDurationMs; void runMessage;
  return { ...n, data: rest as typeof n.data };
}

// Silence "unused" lint for the alias
export type __KeepWorkflowType = WorkflowDefinition;
