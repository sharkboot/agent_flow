import { Bot, Sparkles, Code2, Cpu, Zap, type LucideIcon } from 'lucide-react';
import type { AgentType } from '@/types';

const icons: Record<AgentType, LucideIcon> = {
  claude: Sparkles,
  codex: Code2,
  hermes: Zap,
  agentflow: Bot,
  custom: Cpu,
};

const colors: Record<AgentType, string> = {
  claude: 'text-orange-500 bg-orange-50',
  codex: 'text-emerald-600 bg-emerald-50',
  hermes: 'text-violet-600 bg-violet-50',
  agentflow: 'text-brand-600 bg-brand-50',
  custom: 'text-slate-600 bg-slate-100',
};

export function AgentIcon({ type, size = 20 }: { type: AgentType; size?: number }) {
  const Icon = icons[type] ?? Cpu;
  return (
    <div
      className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors[type] ?? colors.custom}`}
    >
      <Icon size={size} />
    </div>
  );
}
