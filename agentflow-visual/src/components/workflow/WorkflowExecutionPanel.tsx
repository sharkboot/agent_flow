import { useState } from 'react';
import { Play, X, ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { Input, Label } from '@/components/shared/Form';

interface ExecutionLogEntry {
  nodeId: string;
  status: string;
  output: string;
  timestamp: string;
}

interface WorkflowExecutionPanelProps {
  workflowName: string;
  isRunning: boolean;
  executionLog: ExecutionLogEntry[];
  onRun: (inputs: Record<string, string>) => void;
  onCancel: () => void;
  onClose: () => void;
}

export function WorkflowExecutionPanel({
  workflowName,
  isRunning,
  executionLog,
  onRun,
  onCancel,
  onClose,
}: WorkflowExecutionPanelProps) {
  const [inputs, setInputs] = useState<Record<string, string>>({ input: '' });
  const [expandedLogs, setExpandedLogs] = useState(true);

  const handleAddInput = () => {
    const key = `var${Object.keys(inputs).length}`;
    setInputs((prev) => ({ ...prev, [key]: '' }));
  };

  const handleInputChange = (key: string, value: string) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleRun = () => {
    onRun(inputs);
  };

  return (
    <div className="fixed right-4 top-20 w-96 bg-white rounded-lg shadow-xl border border-slate-200 z-50 max-h-[80vh] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <h3 className="font-medium text-sm">运行工作流</h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-slate-100 rounded"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4 border-b border-slate-200">
        <p className="text-sm text-slate-600 mb-3">工作流: {workflowName}</p>
        
        <div className="space-y-3">
          <div>
            <Label>输入变量</Label>
            {Object.entries(inputs).map(([key, value]) => (
              <div key={key} className="flex gap-2 mt-1">
                <Input
                  value={key}
                  disabled
                  className="w-24 text-xs bg-slate-100"
                />
                <Input
                  value={value}
                  onChange={(e) => handleInputChange(key, e.target.value)}
                  placeholder="输入值..."
                  className="flex-1"
                />
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={handleAddInput} className="mt-1">
              <Plus size={12} /> 添加变量
            </Button>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {!isRunning ? (
            <Button onClick={handleRun} disabled={!workflowName} className="flex-1">
              <Play size={14} /> 运行
            </Button>
          ) : (
            <Button onClick={onCancel} variant="danger" className="flex-1">
              停止
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <button
          onClick={() => setExpandedLogs(!expandedLogs)}
          className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2 w-full"
        >
          {expandedLogs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          执行日志 ({executionLog.length})
        </button>

        {expandedLogs && (
          <div className="space-y-2">
            {executionLog.length === 0 ? (
              <p className="text-xs text-slate-400 italic">暂无执行日志</p>
            ) : (
              executionLog.map((log, index) => (
                <div
                  key={index}
                  className={`text-xs p-2 rounded border ${
                    log.status === 'completed' ? 'bg-green-50 border-green-200' :
                    log.status === 'failed' ? 'bg-red-50 border-red-200' :
                    log.status === 'running' ? 'bg-blue-50 border-blue-200' :
                    'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {log.status === 'completed' && <CheckCircle size={12} className="text-green-600" />}
                    {log.status === 'failed' && <XCircle size={12} className="text-red-600" />}
                    {log.status === 'running' && <Loader2 size={12} className="text-blue-600 animate-spin" />}
                    <span className="font-medium">{log.nodeId}</span>
                    <span className="text-slate-500">({log.status})</span>
                  </div>
                  {log.output && (
                    <p className="mt-1 text-slate-600 whitespace-pre-wrap break-all">
                      {log.output.length > 200 ? log.output.slice(0, 200) + '...' : log.output}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}