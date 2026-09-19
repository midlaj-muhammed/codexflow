import { describe, expect, it } from 'vitest';
import {
  AgentLifecycleManager,
  CommandBus,
  EventBus,
  PluginRegistry,
  TaskLifecycleManager,
  runMockWorkflow,
} from './index.js';
describe('runtime', () => {
  it('registers plugins and rejects duplicate roles', () => {
    const registry = new PluginRegistry();
    const plugin = {
      id: 'plan',
      role: 'PLANNER' as const,
      permissions: ['READ'] as const,
      run: async () => {},
    };
    registry.register(plugin);
    expect(registry.get('PLANNER')).toBe(plugin);
    expect(() => registry.register(plugin)).toThrow('already registered');
  });
  it('dispatches commands and delivers events', async () => {
    const observed: string[] = [];
    const lifecycle = new TaskLifecycleManager();
    const events = new EventBus();
    events.subscribe((event) => {
      observed.push(event.type);
    });
    const commands = new CommandBus(lifecycle, events);
    await commands.dispatch({ type: 'createTask', taskId: 'x' });
    await commands.dispatch({ type: 'startTask', taskId: 'x' });
    expect(lifecycle.get('x')).toBe('QUEUED');
    expect(observed).toEqual(['task.created', 'task.started']);
  });
  it('rejects invalid transitions', async () => {
    const lifecycle = new TaskLifecycleManager();
    await lifecycle.create('x');
    await expect(lifecycle.transition('x', 'APPLIED')).rejects.toThrow('Invalid');
  });
  it('persists delivery state checkpoints through the lifecycle persistence hook', async () => {
    const saved: string[] = [];
    const lifecycle = new TaskLifecycleManager({
      saveTaskState: () => {},
      saveDeliveryState: (_taskId, status) => {
        saved.push(status);
      },
      appendEvent: () => {},
    });
    await lifecycle.recordDeliveryState('x', 'COMMITTED');
    await lifecycle.recordDeliveryState('x', 'PUSHED');
    expect(lifecycle.getDeliveryState('x')).toBe('PUSHED');
    expect(saved).toEqual(['COMMITTED', 'PUSHED']);
  });
  it('cancels an active plugin', async () => {
    const manager = new AgentLifecycleManager();
    let cancelled = false;
    const plugin = {
      id: 'coder',
      role: 'CODER' as const,
      permissions: ['READ', 'WRITE'] as ('READ' | 'WRITE')[],
      run: async (context: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          context.signal.addEventListener('abort', () => {
            cancelled = true;
            resolve();
          }),
        );
      },
    };
    const running = manager.run(plugin, {
      taskId: 'x',
      role: 'CODER',
      permissions: ['READ', 'WRITE'],
      attempt: 1,
    });
    expect(manager.cancel('x', 'CODER')).toBe(true);
    await running;
    expect(cancelled).toBe(true);
  });
  it('executes deterministic workflow to approval', async () => {
    await expect(runMockWorkflow('x')).resolves.toMatchObject({
      status: 'READY_FOR_APPROVAL',
      timeline: expect.arrayContaining([expect.objectContaining({ type: 'approval.required' })]),
    });
  });
});
