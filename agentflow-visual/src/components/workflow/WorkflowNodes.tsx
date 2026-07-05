import { memo, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Play, FileInput, FileOutput, GitBranch, Loader2, CheckCircle2, XCircle, Circle } from 'lucide-react';
import clsx from '@/utils/clsx';

// -----------------------------------------------------------------------------
// Shared run-state
// -----------------------------------------------------------------------------

export type NodeRunStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface RunState {
  runStatus?: NodeRunStatus;
  runDurationMs?: number;
  runMessage?: string;
}

// Ring color + status chip for the current run state.
function statusChrome(status: NodeRunStatus | undefined) {
  switch (status) {
    case 'running':
      return { ring: 'ring-2 ring-blue-400 animate-pulse-slow', chip: 'text-blue-700 bg-blue-100', Icon: Loader2, iconClass: 'animate-spin text-blue-600' };
    case 'completed':
      return { ring: 'ring-2 ring-emerald-400', chip: 'text-emerald-700 bg-emerald-100', Icon: CheckCircle2, iconClass: 'text-emerald-600' };
    case 'failed':
      return { ring: 'ring-2 ring-red-400', chip: 'text-red-700 bg-red-100', Icon: XCircle, iconClass: 'text-red-600' };
    case 'skipped':
      return { ring: 'ring-1 ring-slate-300', chip: 'text-slate-500 bg-slate-100', Icon: Circle, iconClass: 'text-slate-400' };
    case 'pending':
      return { ring: 'ring-1 ring-amber-300', chip: 'text-amber-700 bg-amber-100', Icon: Circle, iconClass: 'text-amber-500' };
    default:
      return { ring: '', chip: '', Icon: null as null | typeof Circle, iconClass: '' };
  }
}

function StatusBadge({ status, durationMs }: { status?: NodeRunStatus; durationMs?: number }) {
  if (!status || status === 'idle') return null;
  const { chip, Icon, iconClass } = statusChrome(status);
  return (
    <span className={clsx('mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium', chip)}>
      {Icon && <Icon size={10} className={iconClass} />}
      {status}
      {typeof durationMs === 'number' && status !== 'running' && (
        <span className="tabular-nums opacity-70">· {durationMs}ms</span>
      )}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Data types (unchanged shape + optional run-state)
// -----------------------------------------------------------------------------

interface InputNodeData extends RunState {
  label?: string;
  inputVar?: string;
}

interface OutputNodeData extends RunState {
  label?: string;
  outputVar?: string;
}

interface AgentNodeData extends RunState {
  label?: string;
  agentId?: string;
  task?: string;
}

interface ConditionNodeData extends RunState {
  label?: string;
  condition?: string;
}

// -----------------------------------------------------------------------------
// Common wrapper — border color per type + status ring overlay + tooltip
// -----------------------------------------------------------------------------

interface WrapProps {
  selected?: boolean;
  status?: NodeRunStatus;
  baseBorder: string;   // e.g. 'border-green-400'
  activeBorder: string; // e.g. 'border-green-500 bg-green-50 shadow-lg shadow-green-200'
  minW?: string;
  runMessage?: string;
  children: ReactNode;
}
function NodeShell({ selected, status, baseBorder, activeBorder, minW = 'min-w-[120px]', runMessage, children }: WrapProps) {
  const { ring } = statusChrome(status);
  return (
    <div
      title={runMessage}
      className={clsx(
        'relative px-4 py-3 rounded-lg border-2 transition-all bg-white',
        minW,
        selected ? activeBorder : baseBorder,
        ring,
      )}
    >
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Nodes
// -----------------------------------------------------------------------------

export const InputNode = memo(({ data, selected }: NodeProps) => {
  const d = data as InputNodeData;
  return (
    <NodeShell
      selected={selected}
      status={d.runStatus}
      baseBorder="border-green-400"
      activeBorder="border-green-500 bg-green-50 shadow-lg shadow-green-200"
      runMessage={d.runMessage}
    >
      <Handle type="source" position={Position.Bottom} className="!bg-green-500 !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <FileInput size={14} className="text-green-600" />
        <span className="text-sm font-medium text-green-700">{d.label || '输入'}</span>
      </div>
      {d.inputVar && <div className="mt-1 text-xs text-green-600/70">变量: {d.inputVar}</div>}
      <StatusBadge status={d.runStatus} durationMs={d.runDurationMs} />
    </NodeShell>
  );
});
InputNode.displayName = 'InputNode';

export const OutputNode = memo(({ data, selected }: NodeProps) => {
  const d = data as OutputNodeData;
  return (
    <NodeShell
      selected={selected}
      status={d.runStatus}
      baseBorder="border-blue-400"
      activeBorder="border-blue-500 bg-blue-50 shadow-lg shadow-blue-200"
      runMessage={d.runMessage}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-500 !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <FileOutput size={14} className="text-blue-600" />
        <span className="text-sm font-medium text-blue-700">{d.label || '输出'}</span>
      </div>
      {d.outputVar && <div className="mt-1 text-xs text-blue-600/70">变量: {d.outputVar}</div>}
      <StatusBadge status={d.runStatus} durationMs={d.runDurationMs} />
    </NodeShell>
  );
});
OutputNode.displayName = 'OutputNode';

export const AgentNode = memo(({ data, selected }: NodeProps) => {
  const d = data as AgentNodeData;
  return (
    <NodeShell
      selected={selected}
      status={d.runStatus}
      baseBorder="border-purple-400"
      activeBorder="border-purple-500 bg-purple-50 shadow-lg shadow-purple-200"
      minW="min-w-[160px]"
      runMessage={d.runMessage}
    >
      <Handle type="target" position={Position.Top} className="!bg-purple-500 !w-3 !h-3" />
      <Handle type="source" position={Position.Bottom} className="!bg-purple-500 !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <Play size={14} className="text-purple-600" />
        <span className="text-sm font-medium text-purple-700 truncate">{d.label || 'Agent'}</span>
      </div>
      {d.agentId && (
        <div className="mt-1 text-xs text-purple-600/70 font-mono">
          {d.agentId.length > 12 ? d.agentId.slice(0, 8) + '…' : d.agentId}
        </div>
      )}
      <StatusBadge status={d.runStatus} durationMs={d.runDurationMs} />
    </NodeShell>
  );
});
AgentNode.displayName = 'AgentNode';

export const ConditionNode = memo(({ data, selected }: NodeProps) => {
  const d = data as ConditionNodeData;
  return (
    <NodeShell
      selected={selected}
      status={d.runStatus}
      baseBorder="border-orange-400"
      activeBorder="border-orange-500 bg-orange-50 shadow-lg shadow-orange-200"
      runMessage={d.runMessage}
    >
      <Handle type="target" position={Position.Top} className="!bg-orange-500 !w-3 !h-3" />
      <div className="flex items-center gap-2">
        <GitBranch size={14} className="text-orange-600" />
        <span className="text-sm font-medium text-orange-700">{d.label || '条件'}</span>
      </div>
      {d.condition && <div className="mt-1 text-xs text-orange-600/70">{d.condition.split(':')[0]}</div>}
      <StatusBadge status={d.runStatus} durationMs={d.runDurationMs} />
      <Handle type="source" position={Position.Left} id="true" className="!bg-green-500 !w-3 !h-3" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Right} id="false" className="!bg-red-500 !w-3 !h-3" style={{ top: '50%' }} />
    </NodeShell>
  );
});
ConditionNode.displayName = 'ConditionNode';

export const nodeTypes = {
  input: InputNode,
  output: OutputNode,
  agent: AgentNode,
  condition: ConditionNode,
};
