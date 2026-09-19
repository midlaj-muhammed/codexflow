import type { TaskStatus } from '@codexflow/shared';
export type RuntimeEvent = {
  type: string;
  taskId: string;
  at: string;
  payload?: Record<string, unknown>;
};
export type RuntimeCommand = {
  type:
    | 'createTask'
    | 'createWorkspace'
    | 'runAgent'
    | 'cancelAgent'
    | 'approveTask'
    | 'rejectTask'
    | 'rollbackTask'
    | 'commitChanges'
    | 'pushBranch'
    | 'createPullRequest';
  taskId: string;
  payload?: Record<string, unknown>;
};
const transitions: Record<TaskStatus, TaskStatus[]> = {
  CREATED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['PLANNING', 'CANCELLED'],
  PLANNING: ['CONTEXT_READY', 'FAILED', 'CANCELLED'],
  CONTEXT_READY: ['CODING', 'FAILED', 'CANCELLED'],
  CODING: ['REVIEWING', 'FAILED', 'CANCELLED'],
  REVIEWING: ['TESTING', 'REPAIRING', 'FAILED', 'CANCELLED'],
  TESTING: ['READY_FOR_APPROVAL', 'REPAIRING', 'FAILED', 'CANCELLED'],
  REPAIRING: ['REVIEWING', 'BLOCKED', 'FAILED', 'CANCELLED'],
  READY_FOR_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['APPLIED', 'FAILED'],
  APPLIED: [],
  REJECTED: [],
  ROLLED_BACK: [],
  FAILED: [],
  CANCELLED: [],
  BLOCKED: [],
};
export class TaskLifecycle {
  private states = new Map<string, TaskStatus>();
  create(taskId: string) {
    this.states.set(taskId, 'CREATED');
    return 'CREATED' as const;
  }
  get(taskId: string) {
    const state = this.states.get(taskId);
    if (!state) throw new Error(`Unknown task: ${taskId}`);
    return state;
  }
  transition(taskId: string, target: TaskStatus) {
    const current = this.get(taskId);
    if (!transitions[current].includes(target))
      throw new Error(`Invalid task transition: ${current} → ${target}`);
    this.states.set(taskId, target);
    return target;
  }
}
export class EventBus {
  private listeners = new Set<(event: RuntimeEvent) => void>();
  subscribe(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: RuntimeEvent) {
    this.listeners.forEach((listener) => listener(event));
  }
}
export class PluginRegistry {
  private plugins = new Map<string, { id: string; roles: string[] }>();
  register(plugin: { id: string; roles: string[] }) {
    this.plugins.set(plugin.id, plugin);
  }
  get(id: string) {
    return this.plugins.get(id);
  }
}
export class CommandBus {
  constructor(
    private readonly lifecycle: TaskLifecycle,
    private readonly events: EventBus,
  ) {}
  dispatch(command: RuntimeCommand) {
    if (command.type === 'createTask') {
      this.lifecycle.create(command.taskId);
      this.publish('task.created', command.taskId);
      return;
    }
    const target: Partial<Record<RuntimeCommand['type'], TaskStatus>> = {
      approveTask: 'APPROVED',
      rejectTask: 'REJECTED',
      rollbackTask: 'ROLLED_BACK',
    };
    if (target[command.type]) this.lifecycle.transition(command.taskId, target[command.type]!);
    this.publish(command.type, command.taskId, command.payload);
  }
  private publish(type: string, taskId: string, payload?: Record<string, unknown>) {
    this.events.emit({ type, taskId, payload, at: new Date().toISOString() });
  }
}
export async function runMockWorkflow(taskId: string) {
  const lifecycle = new TaskLifecycle();
  const events = new EventBus();
  const timeline: RuntimeEvent[] = [];
  events.subscribe((event) => timeline.push(event));
  const command = new CommandBus(lifecycle, events);
  command.dispatch({ type: 'createTask', taskId });
  for (const [status, event] of [
    ['QUEUED', 'task.started'],
    ['PLANNING', 'agent.started'],
    ['CONTEXT_READY', 'plan.created'],
    ['CODING', 'workspace.ready'],
    ['REVIEWING', 'code.generated'],
    ['TESTING', 'review.completed'],
    ['READY_FOR_APPROVAL', 'test.completed'],
  ] as [TaskStatus, string][]) {
    lifecycle.transition(taskId, status);
    events.emit({ type: event, taskId, at: new Date().toISOString() });
  }
  return { status: lifecycle.get(taskId), timeline };
}
