import { create } from 'zustand';
import type { LocalAgent } from '@/types';

interface AgentStore {
  agents: LocalAgent[];
  loading: boolean;
  selectedId: string | null;
  /** When true, the next ChatPage mount will force terminal view mode */
  terminalLaunch: boolean;
  fetchAgents: () => Promise<void>;
  createAgent: (agent: Omit<LocalAgent, 'id' | 'createdAt' | 'updatedAt'>) => Promise<LocalAgent>;
  updateAgent: (id: string, patch: Partial<LocalAgent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  select: (id: string | null) => void;
  launchTerminal: () => void;
  clearTerminalLaunch: () => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  loading: false,
  selectedId: null,
  terminalLaunch: false,

  fetchAgents: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/config/agents');
      const data = (await res.json()) as LocalAgent[];
      set({ agents: data, loading: false });
    } catch (err) {
      console.error('fetchAgents failed', err);
      set({ loading: false });
    }
  },

  createAgent: async (agent) => {
    const res = await fetch('/api/config/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(agent),
    });
    const created = (await res.json()) as LocalAgent;
    set({ agents: [...get().agents, created] });
    return created;
  },

  updateAgent: async (id, patch) => {
    const res = await fetch(`/api/config/agents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const updated = (await res.json()) as LocalAgent;
    set({
      agents: get().agents.map((a) => (a.id === id ? updated : a)),
    });
  },

  deleteAgent: async (id) => {
    await fetch(`/api/config/agents/${id}`, { method: 'DELETE' });
    set({
      agents: get().agents.filter((a) => a.id !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
    });
  },

  select: (id) => set({ selectedId: id }),
  launchTerminal: () => set({ terminalLaunch: true }),
  clearTerminalLaunch: () => set({ terminalLaunch: false }),
}));
