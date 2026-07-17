import { useState, useEffect } from 'react';
import type { LocalAgent, AgentType } from '@/types';
import { Modal } from '@/components/shared/Modal';
import { Input, Textarea, Select, Label } from '@/components/shared/Form';
import { Button } from '@/components/shared/Button';

interface AgentFormProps {
  open: boolean;
  initial?: LocalAgent | null;
  onClose: () => void;
  onSubmit: (data: Omit<LocalAgent, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
}

interface SkillsInfo {
  codexSkillsDir: string;
  skillsDir: string;
  availableSkills: string[];
}

interface AcpPresetInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  description?: string;
}

// -----------------------------------------------------------------------------
// Presets: each agent type comes with sensible CLI command + args + model.
// When the user switches type, we swap these in (but keep any custom overrides
// they've typed themselves — we only replace values that still match a preset).
// -----------------------------------------------------------------------------

interface AgentPreset {
  cliCommand: string;
  cliArgs: string;
  model: string;
}

const PRESETS: Record<AgentType, AgentPreset> = {
  claude:    { cliCommand: 'claude', cliArgs: '--print --dangerously-skip-permissions', model: 'claude-sonnet-5' },
  codex:     { cliCommand: 'codex',  cliArgs: 'exec --skip-git-repo-check',              model: 'gpt-5-codex' },
  hermes:    { cliCommand: 'hermes', cliArgs: '--once',                                  model: 'qwen-3.5-122b' },
  agentflow: { cliCommand: 'agentflow', cliArgs: '',                                     model: '' },
  custom:    { cliCommand: '',       cliArgs: '',                                        model: '' },
  // ACP preset defaults to Claude Code via npx; user can pick another preset
  // from the ACP dropdown, which fills in the same fields.
  acp:       { cliCommand: 'npx',    cliArgs: '--yes @zed-industries/claude-code-acp@latest', model: '' },
};

/** True when `value` matches any preset's field — i.e. the user hasn't customized it. */
function looksLikePreset(field: keyof AgentPreset, value: string): boolean {
  const v = value.trim();
  if (!v) return true; // empty always yields to preset
  return Object.values(PRESETS).some((p) => p[field].trim() === v);
}

const defaultForm = {
  name: '',
  description: '',
  type: 'claude' as AgentType,
  cliCommand: PRESETS.claude.cliCommand,
  cliArgs: PRESETS.claude.cliArgs,
  workingDir: '',
  model: PRESETS.claude.model,
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: '',
  acpPreset: 'claude-code',
};

export function AgentForm({ open, initial, onClose, onSubmit }: AgentFormProps) {
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [acpPresets, setAcpPresets] = useState<AcpPresetInfo[]>([]);

  useEffect(() => {
    if (open) {
      setLoadingSkills(true);
      fetch('/api/config/skills')
        .then((r) => r.json())
        .then((data: SkillsInfo) => {
          setAvailableSkills(data.availableSkills || []);
        })
        .catch(() => setAvailableSkills([]))
        .finally(() => setLoadingSkills(false));

      // Fetch ACP presets in parallel — cheap, static list.
      fetch('/api/config/acp-presets')
        .then((r) => r.json())
        .then((data: { presets: AcpPresetInfo[] }) => setAcpPresets(data.presets || []))
        .catch(() => setAcpPresets([]));
    }
  }, [open]);

  useEffect(() => {
    if (initial) {
      setForm({
        name: initial.name,
        description: initial.description ?? '',
        type: initial.type,
        cliCommand: initial.cliCommand,
        cliArgs: (initial.cliArgs ?? []).join(' '),
        workingDir: initial.workingDir ?? '',
        model: initial.config?.model ?? '',
        temperature: initial.config?.temperature ?? 0.7,
        maxTokens: initial.config?.maxTokens ?? 4096,
        systemPrompt: initial.config?.systemPrompt ?? '',
        acpPreset: initial.config?.acpPreset ?? 'claude-code',
      });
      setSelectedSkills(initial.skills ?? []);
    } else {
      setForm(defaultForm);
      setSelectedSkills([]);
    }
  }, [initial, open]);

  const submit = async () => {
    if (!form.name.trim() || !form.cliCommand.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        type: form.type,
        cliCommand: form.cliCommand.trim(),
        cliArgs: form.cliArgs.trim() ? form.cliArgs.trim().split(/\s+/) : undefined,
        workingDir: form.workingDir.trim() || undefined,
        config: {
          model: form.model.trim() || undefined,
          temperature: Number(form.temperature),
          maxTokens: Number(form.maxTokens),
          systemPrompt: form.systemPrompt.trim() || undefined,
          ...(form.type === 'acp' ? { acpPreset: form.acpPreset } : {}),
        },
        skills: selectedSkills,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const applyAcpPreset = (presetId: string) => {
    const p = acpPresets.find((x) => x.id === presetId);
    if (!p) {
      setForm((prev) => ({ ...prev, acpPreset: presetId }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      acpPreset: presetId,
      // Only overwrite command/args if the user hadn't customized them —
      // i.e. they still match some known preset value.
      cliCommand: looksLikePreset('cliCommand', prev.cliCommand) ? p.command : prev.cliCommand,
      cliArgs:    looksLikePreset('cliArgs', prev.cliArgs)       ? p.args.join(' ') : prev.cliArgs,
    }));
  };

  const toggleSkill = (skill: string) => {
    setSelectedSkills((prev) =>
      prev.includes(skill)
        ? prev.filter((s) => s !== skill)
        : [...prev, skill],
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={initial ? '编辑 Agent' : '创建 Agent'} size="lg">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>名称 *</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="我的 Claude"
          />
        </div>
        <div>
          <Label>类型</Label>
          <Select
            value={form.type}
            onChange={(e) => {
              const nextType = e.target.value as AgentType;
              const preset = PRESETS[nextType];
              // Preserve any field the user has explicitly customized. If a
              // field still matches ANY preset (including the previous default),
              // it's safe to overwrite with the new one.
              setForm((prev) => ({
                ...prev,
                type: nextType,
                cliCommand: looksLikePreset('cliCommand', prev.cliCommand) ? preset.cliCommand : prev.cliCommand,
                cliArgs:    looksLikePreset('cliArgs', prev.cliArgs)       ? preset.cliArgs    : prev.cliArgs,
                model:      looksLikePreset('model', prev.model)           ? preset.model      : prev.model,
              }));
            }}
          >
            <option value="claude">claude</option>
            <option value="codex">codex</option>
            <option value="hermes">hermes</option>
            <option value="agentflow">agentflow</option>
            <option value="custom">custom</option>
            <option value="acp">acp (Agent Client Protocol)</option>
          </Select>
        </div>

        {form.type === 'acp' && (
          <div className="col-span-2">
            <Label>ACP Preset</Label>
            <Select
              value={form.acpPreset}
              onChange={(e) => applyAcpPreset(e.target.value)}
            >
              {acpPresets.length === 0 ? (
                <option value="claude-code">claude-code (加载中…)</option>
              ) : (
                acpPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.description ? ` — ${p.description}` : ''}
                  </option>
                ))
              )}
            </Select>
            <p className="mt-1 text-xs text-slate-500">
              选择一个内置 preset 会自动填充下方 CLI 命令与参数；也可留空/覆盖为本地已安装的
              <code className="mx-1 mono">claude-code-acp</code> 等命令。
            </p>
          </div>
        )}

        <div className="col-span-2">
          <Label>描述</Label>
          <Input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="做什么用的?"
          />
        </div>

        <div>
          <Label>CLI 命令 *</Label>
          <Input
            value={form.cliCommand}
            onChange={(e) => setForm({ ...form, cliCommand: e.target.value })}
            placeholder="claude / codex / agentflow"
            className="mono"
          />
        </div>
        <div>
          <Label>额外参数 (空格分隔)</Label>
          <Input
            value={form.cliArgs}
            onChange={(e) => setForm({ ...form, cliArgs: e.target.value })}
            placeholder="--print --no-stream"
            className="mono"
          />
        </div>

        <div className="col-span-2">
          <Label>工作目录</Label>
          <Input
            value={form.workingDir}
            onChange={(e) => setForm({ ...form, workingDir: e.target.value })}
            placeholder="留空则使用当前目录"
            className="mono"
          />
        </div>

        <div>
          <Label>模型</Label>
          <Input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="claude-sonnet-5"
            className="mono"
          />
        </div>
        <div>
          <Label>Temperature</Label>
          <Input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={form.temperature}
            onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
          />
        </div>

        <div>
          <Label>Max Tokens</Label>
          <Input
            type="number"
            value={form.maxTokens}
            onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })}
          />
        </div>

        <div className="col-span-2">
          <Label>系统提示词</Label>
          <Textarea
            rows={4}
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            placeholder="You are a helpful assistant..."
          />
        </div>

        <div className="col-span-2">
          <Label>Skills (软链接)</Label>
          {loadingSkills ? (
            <p className="text-sm text-gray-500">加载中...</p>
          ) : availableSkills.length === 0 ? (
            <p className="text-sm text-gray-500">没有可用的 skills</p>
          ) : (
            <div className="mt-2 max-h-40 overflow-y-auto border rounded-md p-2 space-y-1">
              {availableSkills.map((skill) => (
                <label
                  key={skill}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-2 py-1"
                >
                  <input
                    type="checkbox"
                    checked={selectedSkills.includes(skill)}
                    onChange={() => toggleSkill(skill)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">{skill}</span>
                </label>
              ))}
            </div>
          )}
          {selectedSkills.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              已选择: {selectedSkills.length} 个 skill
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>
    </Modal>
  );
}
