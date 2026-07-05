import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  nodes: Node[];
  edges: Edge[];
  variables: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowStore {
  workflows: WorkflowDefinition[];
  currentWorkflow: WorkflowDefinition | null;
  isRunning: boolean;
  executionLog: Array<{ nodeId: string; status: string; output: string; timestamp: string }>;
  
  fetchWorkflows: () => Promise<void>;
  loadWorkflow: (id: string) => Promise<void>;
  saveWorkflow: (workflow: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt'>) => Promise<WorkflowDefinition>;
  updateWorkflow: (id: string, workflow: Partial<WorkflowDefinition>) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
  
  executeWorkflow: (workflowId: string, inputs: Record<string, string>) => Promise<void>;
  clearExecutionLog: () => void;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows: [],
  currentWorkflow: null,
  isRunning: false,
  executionLog: [],

  fetchWorkflows: async () => {
    try {
      const res = await fetch('/api/workflows');
      const data = (await res.json()) as WorkflowDefinition[];
      set({ workflows: data });
    } catch (err) {
      console.error('fetchWorkflows failed', err);
    }
  },

  loadWorkflow: async (id: string) => {
    try {
      const res = await fetch(`/api/workflows/${id}`);
      const data = (await res.json()) as WorkflowDefinition;
      set({ currentWorkflow: data });
    } catch (err) {
      console.error('loadWorkflow failed', err);
    }
  },

  saveWorkflow: async (workflow) => {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow),
    });
    const created = (await res.json()) as WorkflowDefinition;
    set({ 
      workflows: [...get().workflows, created],
      currentWorkflow: created 
    });
    return created;
  },

  updateWorkflow: async (id, patch) => {
    const res = await fetch(`/api/workflows/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const updated = (await res.json()) as WorkflowDefinition;
    set({
      workflows: get().workflows.map((w) => (w.id === id ? updated : w)),
      currentWorkflow: get().currentWorkflow?.id === id ? updated : get().currentWorkflow,
    });
  },

  deleteWorkflow: async (id) => {
    await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
    set({
      workflows: get().workflows.filter((w) => w.id !== id),
      currentWorkflow: get().currentWorkflow?.id === id ? null : get().currentWorkflow,
    });
  },

  executeWorkflow: async (workflowId, inputs) => {
    set({ isRunning: true, executionLog: [] });
    
    try {
      const res = await fetch(`/api/workflows/${workflowId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs }),
      });
      
      if (!res.ok) {
        throw new Error(`Execution failed: ${res.statusText}`);
      }
      
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          try {
            const event = JSON.parse(trimmed.slice(5));
            if (event.type === 'log') {
              set({ 
                executionLog: [...get().executionLog, event.data] 
              });
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    } catch (err) {
      console.error('executeWorkflow failed', err);
      set({
        executionLog: [...get().executionLog, {
          nodeId: 'system',
          status: 'error',
          output: String(err),
          timestamp: new Date().toISOString(),
        }],
      });
    } finally {
      set({ isRunning: false });
    }
  },

  clearExecutionLog: () => set({ executionLog: [] }),
}));
