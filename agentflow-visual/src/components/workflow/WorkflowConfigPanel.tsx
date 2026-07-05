import { useState, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { X, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import { Input, Textarea, Label, Select } from '@/components/shared/Form';
import { useAgentStore } from '@/stores/agentStore';

interface WorkflowConfigPanelProps {
  selectedNode: Node | null;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
  onUpdateNode: (nodeId: string, data: Record<string, unknown>) => void;
  onDeleteNode: (nodeId: string) => void;
}

export function WorkflowConfigPanel({
  selectedNode,
  nodes,
  edges,
  onClose,
  onUpdateNode,
  onDeleteNode,
}: WorkflowConfigPanelProps) {
  const agents = useAgentStore((s) => s.agents);
  const [formData, setFormData] = useState<Record<string, string>>({});

  useEffect(() => {
    if (selectedNode) {
      setFormData({
        label: String(selectedNode.data.label || ''),
        inputVar: String(selectedNode.data.inputVar || ''),
        outputVar: String(selectedNode.data.outputVar || ''),
        task: String(selectedNode.data.task || ''),
        condition: String(selectedNode.data.condition || ''),
        agentId: String(selectedNode.data.agentId || ''),
      });
    }
  }, [selectedNode]);

  if (!selectedNode) return null;

  const nodeType = selectedNode.type;
  const isDeletable = nodeType !== 'input' && nodeType !== 'output';

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    const updates: Record<string, unknown> = {
      label: formData.label,
    };

    if (nodeType === 'input') {
      updates.inputVar = formData.inputVar;
    } else if (nodeType === 'output') {
      updates.outputVar = formData.outputVar;
    } else if (nodeType === 'agent') {
      updates.agentId = formData.agentId;
      updates.task = formData.task;
    } else if (nodeType === 'condition') {
      updates.condition = formData.condition;
    }

    onUpdateNode(selectedNode.id, updates);
    onClose();
  };

  return (
    <div className="fixed right-4 top-20 w-80 bg-white rounded-lg shadow-xl border border-slate-200 z-50">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <h3 className="font-medium text-sm">
          {nodeType === 'input' ? '配置输入节点' :
           nodeType === 'output' ? '配置输出节点' :
           nodeType === 'agent' ? '配置 Agent 节点' :
           nodeType === 'condition' ? '配置条件节点' : '配置节点'}
        </h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-slate-100 rounded"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <Label>名称</Label>
          <Input
            value={formData.label || ''}
            onChange={(e) => handleChange('label', e.target.value)}
            placeholder="节点名称"
          />
        </div>

        {nodeType === 'input' && (
          <>
            <div>
              <Label>输入变量名</Label>
              <Input
                value={formData.inputVar || ''}
                onChange={(e) => handleChange('inputVar', e.target.value)}
                placeholder="input"
              />
              <p className="mt-1 text-xs text-slate-500">
                输入将作为此变量传递给后续节点
              </p>
            </div>
          </>
        )}

        {nodeType === 'output' && (
          <div>
            <Label>输出变量名</Label>
            <Input
              value={formData.outputVar || ''}
              onChange={(e) => handleChange('outputVar', e.target.value)}
              placeholder="output"
            />
            <p className="mt-1 text-xs text-slate-500">
              最终输出将保存到此变量
            </p>
          </div>
        )}

        {nodeType === 'agent' && (
          <>
            <div>
              <Label>选择 Agent *</Label>
              <Select
                value={formData.agentId || ''}
                onChange={(e) => handleChange('agentId', e.target.value)}
              >
                <option value="">请选择 Agent...</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label>任务描述</Label>
              <Textarea
                rows={3}
                value={formData.task || ''}
                onChange={(e) => handleChange('task', e.target.value)}
                placeholder="输入任务描述，或留空使用上一节点的输出"
              />
              <p className="mt-1 text-xs text-slate-500">
                可使用变量: {'{input}'} - 引用上一节点的输出
              </p>
            </div>
          </>
        )}

        {nodeType === 'condition' && (
          <div>
            <Label>条件表达式</Label>
            <Select
              value={formData.condition?.split(':')[0] || ''}
              onChange={(e) => handleChange('condition', `${e.target.value}:${formData.condition?.split(':')[1] || ''}`)}
            >
              <option value="">请选择条件类型...</option>
              <option value="contains">包含 (contains:text)</option>
              <option value="equals">等于 (equals:value)</option>
              <option value="not_empty">非空 (not_empty)</option>
              <option value="empty">为空 (empty)</option>
              <option value="starts_with">开头是 (starts_with:text)</option>
              <option value="ends_with">结尾是 (ends_with:text)</option>
              <option value="regex">正则匹配 (regex:pattern)</option>
            </Select>
            {formData.condition?.split(':')[0] !== 'empty' && 
             formData.condition?.split(':')[0] !== 'not_empty' && (
              <Input
                className="mt-2"
                value={formData.condition?.split(':')[1] || ''}
                onChange={(e) => handleChange('condition', `${formData.condition?.split(':')[0] || ''}:${e.target.value}`)}
                placeholder="条件值"
              />
            )}
            <p className="mt-1 text-xs text-slate-500">
              根据输入内容判断走哪个分支
            </p>
          </div>
        )}

        <div className="pt-2 border-t border-slate-200">
          <h4 className="text-xs font-medium text-slate-700 mb-2">连接信息</h4>
          <div className="text-xs text-slate-500 space-y-1">
            <div>
              <span className="font-medium">入边:</span>{' '}
              {edges.filter((e) => e.target === selectedNode.id).length} 个
            </div>
            <div>
              <span className="font-medium">出边:</span>{' '}
              {edges.filter((e) => e.source === selectedNode.id).length} 个
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
        <div>
          {isDeletable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onDeleteNode(selectedNode.id);
                onClose();
              }}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 size={14} />
              删除
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" onClick={handleSave}>
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
