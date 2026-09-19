import type { AgentRole, TaskStatus } from '@codexflow/shared';

export type Permission = 'READ' | 'WRITE' | 'EXECUTE' | 'CONTROL';
export type DeliveryStatus =
  | 'APPROVED'
  | 'COMMITTED'
  | 'PUSH_FAILED'
  | 'PUSHED'
  | 'PR_FAILED'
  | 'PR_CREATED';
export type RuntimeEventType =
  | 'task.created'
  | 'task.started'
  | 'workspace.created'
  | 'workspace.ready'
  | 'agent.started'
  | 'agent.progress'
  | 'agent.completed'
  | 'agent.failed'
  | 'plan.created'
  | 'code.generated'
  | 'review.started'
  | 'review.completed'
  | 'test.started'
  | 'test.completed'
  | 'repair.started'
  | 'repair.completed'
  | 'approval.required'
  | 'task.approved'
  | 'task.rejected'
  | 'commit.created'
  | 'branch.pushed'
  | 'pull_request.created'
  | 'evaluation.completed';
export type RuntimeEvent = {
  type: RuntimeEventType;
  taskId: string;
  at: string;
  payload?: Record<string, unknown>;
};
export type RuntimeCommandType =
  | 'createTask'
  | 'startTask'
  | 'createWorkspace'
  | 'runAgent'
  | 'cancelAgent'
  | 'approveTask'
  | 'rejectTask'
  | 'rollbackTask'
  | 'commitChanges'
  | 'pushBranch'
  | 'createPullRequest';
export type RuntimeCommand = {
  type: RuntimeCommandType;
  taskId: string;
  payload?: Record<string, unknown>;
};
export type ExecutionContext = {
  taskId: string;
  workspaceId?: string;
  workspacePath?: string;
  role: AgentRole;
  permissions: readonly Permission[];
  attempt: number;
  signal: AbortSignal;
};
export type AgentPlugin = {
  id: string;
  role: AgentRole;
  permissions: readonly Permission[];
  run(context: ExecutionContext): Promise<void>;
};
export interface RuntimePersistence {
  saveTaskState(taskId: string, status: TaskStatus): void | Promise<void>;
  saveDeliveryState?(taskId: string, status: DeliveryStatus, error?: string): void | Promise<void>;
  appendEvent(event: RuntimeEvent): void | Promise<void>;
}

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
export class TaskLifecycleManager {
  private states = new Map<string, TaskStatus>();
  private deliveryStates = new Map<string, DeliveryStatus>();
  constructor(private readonly persistence?: RuntimePersistence) {}
  async create(taskId: string) {
    this.states.set(taskId, 'CREATED');
    await this.persistence?.saveTaskState(taskId, 'CREATED');
    return 'CREATED' as const;
  }
  get(taskId: string) {
    const state = this.states.get(taskId);
    if (!state) throw new Error(`Unknown task: ${taskId}`);
    return state;
  }
  async transition(taskId: string, target: TaskStatus) {
    const current = this.get(taskId);
    if (!transitions[current].includes(target))
      throw new Error(`Invalid task transition: ${current} → ${target}`);
    this.states.set(taskId, target);
    await this.persistence?.saveTaskState(taskId, target);
    return target;
  }
  async recordDeliveryState(taskId: string, status: DeliveryStatus, error?: string) {
    this.deliveryStates.set(taskId, status);
    await this.persistence?.saveDeliveryState?.(taskId, status, error);
    return status;
  }
  getDeliveryState(taskId: string) {
    return this.deliveryStates.get(taskId);
  }
}
export class EventBus {
  private listeners = new Set<(event: RuntimeEvent) => void | Promise<void>>();
  constructor(private readonly persistence?: RuntimePersistence) {}
  subscribe(listener: (event: RuntimeEvent) => void | Promise<void>) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async emit(event: RuntimeEvent) {
    await this.persistence?.appendEvent(event);
    await Promise.all([...this.listeners].map((listener) => listener(event)));
  }
}
export class PluginRegistry {
  private plugins = new Map<AgentRole, AgentPlugin>();
  register(plugin: AgentPlugin) {
    if (this.plugins.has(plugin.role))
      throw new Error(`Plugin already registered for ${plugin.role}`);
    this.plugins.set(plugin.role, plugin);
  }
  get(role: AgentRole) {
    const plugin = this.plugins.get(role);
    if (!plugin) throw new Error(`No plugin registered for ${role}`);
    return plugin;
  }
  list() {
    return [...this.plugins.values()];
  }
}
export class AgentLifecycleManager {
  private controllers = new Map<string, AbortController>();
  async run(plugin: AgentPlugin, context: Omit<ExecutionContext, 'signal'>) {
    const controller = new AbortController();
    this.controllers.set(`${context.taskId}:${context.role}`, controller);
    try {
      await plugin.run({ ...context, signal: controller.signal });
    } finally {
      this.controllers.delete(`${context.taskId}:${context.role}`);
    }
  }
  cancel(taskId: string, role: AgentRole) {
    const controller = this.controllers.get(`${taskId}:${role}`);
    if (!controller) return false;
    controller.abort();
    return true;
  }
}
export class Scheduler {
  constructor(private readonly agents: AgentLifecycleManager) {}
  schedule(plugin: AgentPlugin, context: Omit<ExecutionContext, 'signal'>) {
    return this.agents.run(plugin, context);
  }
}
export class CommandBus {
  constructor(
    private readonly lifecycle: TaskLifecycleManager,
    private readonly events: EventBus,
  ) {}
  async dispatch(command: RuntimeCommand) {
    if (command.type === 'createTask') {
      await this.lifecycle.create(command.taskId);
      return this.publish('task.created', command.taskId);
    }
    const states: Partial<Record<RuntimeCommandType, TaskStatus>> = {
      startTask: 'QUEUED',
      approveTask: 'APPROVED',
      rejectTask: 'REJECTED',
      rollbackTask: 'ROLLED_BACK',
    };
    const eventTypes: Partial<Record<RuntimeCommandType, RuntimeEventType>> = {
      startTask: 'task.started',
      createWorkspace: 'workspace.created',
      runAgent: 'agent.started',
      cancelAgent: 'agent.failed',
      approveTask: 'task.approved',
      rejectTask: 'task.rejected',
      commitChanges: 'commit.created',
      pushBranch: 'branch.pushed',
      createPullRequest: 'pull_request.created',
    };
    if (states[command.type])
      await this.lifecycle.transition(command.taskId, states[command.type]!);
    if (!eventTypes[command.type]) throw new Error(`Unsupported command: ${command.type}`);
    await this.publish(eventTypes[command.type]!, command.taskId, command.payload);
  }
  private publish(type: RuntimeEventType, taskId: string, payload?: Record<string, unknown>) {
    return this.events.emit({ type, taskId, payload, at: new Date().toISOString() });
  }
}
export async function runMockWorkflow(taskId: string) {
  const lifecycle = new TaskLifecycleManager();
  const events = new EventBus();
  const timeline: RuntimeEvent[] = [];
  events.subscribe((event) => {
    timeline.push(event);
  });
  const commands = new CommandBus(lifecycle, events);
  await commands.dispatch({ type: 'createTask', taskId });
  await commands.dispatch({ type: 'startTask', taskId });
  for (const [state, event] of [
    ['PLANNING', 'agent.started'],
    ['CONTEXT_READY', 'plan.created'],
    ['CODING', 'workspace.ready'],
    ['REVIEWING', 'code.generated'],
    ['TESTING', 'review.completed'],
    ['READY_FOR_APPROVAL', 'test.completed'],
  ] as [TaskStatus, RuntimeEventType][]) {
    await lifecycle.transition(taskId, state);
    await events.emit({ type: event, taskId, at: new Date().toISOString() });
  }
  await events.emit({ type: 'approval.required', taskId, at: new Date().toISOString() });
  return { status: lifecycle.get(taskId), timeline };
}
export { TaskLifecycleManager as TaskLifecycle };
