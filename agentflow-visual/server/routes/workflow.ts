import { Router } from 'express';
import {
  listWorkflows,
  createWorkflow,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
} from '../cli/workflowStorage.js';
import { WorkflowExecutor } from '../cli/workflowExecutor.js';

export const workflowRouter = Router();

workflowRouter.get('/', async (_req, res) => {
  const workflows = await listWorkflows();
  res.json(workflows);
});

workflowRouter.get('/:id', async (req, res) => {
  const workflow = await getWorkflow(req.params.id);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  res.json(workflow);
});

workflowRouter.post('/', async (req, res) => {
  const body = req.body;
  if (!body?.name || !body?.nodes) {
    res.status(400).json({ error: 'name and nodes are required' });
    return;
  }
  const workflow = await createWorkflow({
    name: body.name,
    description: body.description,
    nodes: body.nodes || [],
    edges: body.edges || [],
    variables: body.variables || {},
  });
  res.status(201).json(workflow);
});

workflowRouter.put('/:id', async (req, res) => {
  const updated = await updateWorkflow(req.params.id, req.body ?? {});
  if (!updated) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  res.json(updated);
});

workflowRouter.delete('/:id', async (req, res) => {
  const ok = await deleteWorkflow(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  res.json({ success: true });
});

workflowRouter.post('/:id/execute', async (req, res) => {
  const workflow = await getWorkflow(req.params.id);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }

  const inputs = req.body?.inputs || {};
  const executor = new WorkflowExecutor();

  // Set up SSE streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (type: string, data: unknown) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  executor.on('step:start', (step) => {
    sendEvent('log', {
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      label: step.label,
      status: 'running',
      output: 'Starting...',
      startedAt: step.startedAt,
      timestamp: new Date().toISOString(),
    });
  });

  executor.on('step:complete', (step) => {
    sendEvent('log', {
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      label: step.label,
      status: 'completed',
      output: step.output,
      durationMs: step.durationMs,
      timestamp: new Date().toISOString(),
    });
  });

  executor.on('step:error', (step) => {
    sendEvent('log', {
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      label: step.label,
      status: 'failed',
      output: step.error,
      durationMs: step.durationMs,
      timestamp: new Date().toISOString(),
    });
  });

  try {
    const result = await executor.execute(workflow, inputs);
    sendEvent('complete', result);
  } catch (err) {
    sendEvent('error', { message: String(err) });
  } finally {
    res.end();
  }
});
