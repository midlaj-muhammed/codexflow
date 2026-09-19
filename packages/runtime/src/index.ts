import { randomUUID } from 'node:crypto';
import type { AgentRole, TaskStatus } from '@codexflow/shared';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CoreAgentPipeline,
  ApprovalService,
  RepairAgent,
  ReviewerAgent,
  TesterAgent,
  VerificationRepairLoop,
  OpenAIResponsesProvider,
  OrchestrationSupervisor,
  RiskEngine,
  scanProject,
  type CoderModelOutput,
  type PipelineStage,
  type PipelineStageEvent,
  type PlannerResult,
  type ProjectMetadata,
  type ReviewerResult,
  type StructuredCoderProvider,
  type OrchestrationPlan,
  type TestExecution,
} from '@codexflow/agents';
import type { CodexFlowStore } from '@codexflow/database';
import { GitEngine } from '@codexflow/git';
import { WorkspaceManager, type Workspace } from '@codexflow/workspace';

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
  | 'delivery.started'
  | 'commit.started'
  | 'commit.completed'
  | 'commit.failed'
  | 'push.started'
  | 'push.completed'
  | 'push.failed'
  | 'pr.started'
  | 'pr.completed'
  | 'pr.failed'
  | 'delivery.reconciled'
  | 'delivery.completed'
  | 'delivery.blocked'
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
  hydrate(taskId: string, status: TaskStatus) {
    this.states.set(taskId, status);
    return status;
  }
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

type StoreTask = {
  id: string;
  projectId: string;
  prompt: string;
  status: TaskStatus;
};
type StoreProject = {
  id: string;
  repositoryId: string;
  name: string;
  metadata?: Record<string, unknown>;
};
type StoreRepository = {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  localPath?: string;
};
type PersistedWorkspace = {
  id: string;
  taskId: string;
  rootPath: string;
  branch: string;
  baselineCommit: string;
  status: string;
};
type RuntimeExecutionStageStatus = 'STARTED' | 'COMPLETED' | 'FAILED';
export type RuntimeExecutionStage = {
  stage: PipelineStage;
  role: AgentRole;
  status: RuntimeExecutionStageStatus;
  agentRunId?: string;
  error?: string;
};
export type RuntimeExecutionResult = {
  taskId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED';
  finalState?: TaskStatus;
  workspace?: {
    id: string;
    rootPath: string;
    branch: string;
    baselineCommit: string;
  };
  stages: RuntimeExecutionStage[];
  changedFiles: string[];
  diff?: string;
  review?: ReviewerResult;
  tests: TestExecution[];
  repairAttempts: number;
  orchestration?: OrchestrationPlan;
  error?: {
    code: string;
    message: string;
  };
};
export class RuntimeExecutorError extends Error {
  constructor(
    public readonly code:
      | 'TASK_NOT_FOUND'
      | 'PROJECT_NOT_FOUND'
      | 'REPOSITORY_NOT_FOUND'
      | 'REPOSITORY_NOT_CONFIGURED'
      | 'INVALID_TASK_STATE'
      | 'DUPLICATE_EXECUTION'
      | 'PROVIDER_NOT_CONFIGURED'
      | 'WORKSPACE_ERROR'
      | 'PIPELINE_FAILED'
      | 'REPAIR_REQUIRED',
    message: string,
  ) {
    super(message);
  }
}
export type RuntimeExecutorOptions = {
  store: CodexFlowStore;
  provider?: StructuredCoderProvider;
  lifecycle?: TaskLifecycleManager;
  events?: EventBus;
  workspaceManager?: WorkspaceManager;
  git?: GitEngine;
  pipeline?: CoreAgentPipeline;
};

const stageRoles: Record<PipelineStage, AgentRole> = {
  PLANNER: 'PLANNER',
  CODER: 'CODER',
  REVIEWER: 'REVIEWER',
  TESTER: 'TESTER',
  REPAIR: 'REPAIR',
};
const startableStates = new Set<TaskStatus>(['CREATED', 'QUEUED']);
const agentEventTypes: Record<RuntimeExecutionStageStatus, RuntimeEventType> = {
  STARTED: 'agent.started',
  COMPLETED: 'agent.completed',
  FAILED: 'agent.failed',
};
const contextFileLimit = 12;
const contextByteLimit = 24_000;
const ignoredContextPath = /(^|\/)(\.git|node_modules|dist|build|coverage|\.next|\.env)(\/|$)|(^|\/)([^/]*secret[^/]*|[^/]*credential[^/]*|[^/]*\.pem|[^/]*\.key)$/i;

export class RuntimeExecutor {
  private readonly store: CodexFlowStore;
  private readonly provider?: StructuredCoderProvider;
  private readonly lifecycle: TaskLifecycleManager;
  private readonly events: EventBus;
  private readonly workspaceManager: WorkspaceManager;
  private readonly git: GitEngine;
  private readonly pipeline: CoreAgentPipeline;
  private readonly activeTasks = new Set<string>();

  constructor(options: RuntimeExecutorOptions) {
    this.store = options.store;
    this.provider = options.provider;
    this.lifecycle =
      options.lifecycle ??
      new TaskLifecycleManager({
        saveTaskState: (taskId, status) => {
          this.store.transitionTask(taskId, status);
        },
        saveDeliveryState: (taskId, status, error) => {
          this.store.setTaskDeliveryStatus(taskId, status, error);
        },
        appendEvent: () => {},
      });
    this.events = options.events ?? new EventBus();
    this.workspaceManager = options.workspaceManager ?? new WorkspaceManager();
    this.git = options.git ?? new GitEngine();
    this.pipeline = options.pipeline ?? new CoreAgentPipeline();
  }

  static fromEnvironment(options: Omit<RuntimeExecutorOptions, 'provider'>) {
    const apiKey = process.env.OPENAI_API_KEY;
    return new RuntimeExecutor({
      ...options,
      provider: apiKey ? new OpenAIResponsesProvider(apiKey) : undefined,
    });
  }

  async execute(taskId: string): Promise<RuntimeExecutionResult> {
    if (this.activeTasks.has(taskId))
      return this.failed(
        taskId,
        [],
        new RuntimeExecutorError('DUPLICATE_EXECUTION', `Task is already executing: ${taskId}`),
      );
    this.activeTasks.add(taskId);
    const lockOwner = randomUUID();
    let hasExecutionLock = false;
    const stages: RuntimeExecutionStage[] = [];
    let currentState: TaskStatus | undefined;
    let workspace: PersistedWorkspace | undefined;
    let changedFiles: string[] = [];
    let diff = '';
    let review: ReviewerResult | undefined;
    let tests: TestExecution[] = [];
    let repairAttempts = 0;
    let orchestration: OrchestrationPlan | undefined;
    const stageRuns = new Map<PipelineStage, string>();

    try {
      const task = this.loadTask(taskId);
      hasExecutionLock = this.store.acquireTaskExecutionLock(taskId, lockOwner);
      if (!hasExecutionLock)
        throw new RuntimeExecutorError(
          'DUPLICATE_EXECUTION',
          `Task is already executing: ${taskId}`,
        );
      if (!startableStates.has(task.status))
        throw new RuntimeExecutorError(
          'INVALID_TASK_STATE',
          `Task ${taskId} cannot execute from ${task.status}`,
        );
      currentState = this.lifecycle.hydrate(taskId, task.status);
      if (currentState === 'CREATED')
        currentState = await this.transition(taskId, currentState, 'QUEUED');
      await this.events.emit({ type: 'task.started', taskId, at: new Date().toISOString() });
      currentState = await this.transition(taskId, currentState, 'PLANNING');

      const project = this.loadProject(task.projectId);
      const repository = this.loadRepository(project.repositoryId);
      if (!repository.localPath)
        throw new RuntimeExecutorError(
          'REPOSITORY_NOT_CONFIGURED',
          `Repository ${repository.id} does not have a local path`,
        );
      if (!this.provider)
        throw new RuntimeExecutorError(
          'PROVIDER_NOT_CONFIGURED',
          'Structured coder provider is not configured',
        );

      workspace = await this.resolveWorkspace(task.id, repository);
      await this.events.emit({
        type: 'workspace.created',
        taskId,
        at: new Date().toISOString(),
        payload: {
          workspaceId: workspace.id,
          branch: workspace.branch,
          baselineCommit: workspace.baselineCommit,
        },
      });

      const metadata = await this.loadProjectMetadata(workspace.rootPath, project);
      orchestration = new OrchestrationSupervisor().select({ prompt: task.prompt, metadata });
      const supervisorRun = this.store.createAgentRun({ taskId, workspaceId: workspace.id, role: 'SUPERVISOR', attempt: 1 });
      this.store.updateAgentRun(supervisorRun.id, { status: 'COMPLETED' });
      this.store.appendAgentEvent({ agentRunId: supervisorRun.id, type: 'agent.completed', payload: {
        role: 'SUPERVISOR', strategy: orchestration.strategy, stages: orchestration.stages,
        maxProviderRequests: orchestration.maxProviderRequests, maxTotalAttempts: orchestration.maxTotalAttempts,
      } });
      await this.events.emit({ type: 'agent.completed', taskId, at: new Date().toISOString(), payload: {
        role: 'SUPERVISOR', strategy: orchestration.strategy, maxProviderRequests: orchestration.maxProviderRequests,
      } });
      const result = await this.pipeline.run({
        prompt: task.prompt,
        metadata,
        workspacePath: workspace.rootPath,
        resolveCoderOutput: ({ plan, attempt }) =>
          this.runCoderProvider(task, workspace!, metadata, plan, attempt, stageRuns.get('CODER')),
        resolveDiff: async () => {
          const [diffResult, changedResult] = await Promise.all([
            this.git.diff(workspace!.rootPath),
            this.git.changedFiles(workspace!.rootPath),
          ]);
          diff = diffResult.stdout;
          changedFiles = changedResult.stdout
            .split('\n')
            .map((file) => file.trim())
            .filter(Boolean);
          return { diff, changedFiles };
        },
        diff,
        changedFiles,
        onStage: async (event) => {
          currentState = await this.handleStage(
            taskId,
            workspace!,
            event,
            currentState!,
            stageRuns,
            stages,
          );
        },
      });
      changedFiles = result.code.changedFiles;
      diff = result.code.diff ?? diff;
      review = result.review;
      tests = result.tests;
      let readyForApproval = result.next === 'READY_FOR_APPROVAL';

      if (!readyForApproval) {
        const repair = await new VerificationRepairLoop(new TesterAgent()).run({
          workspacePath: workspace.rootPath,
          plan: result.plan.verification,
          repair: async (attempt) => {
            const failureContext = this.repairFailureContext(review, tests, attempt);
            const output = await this.runCoderProvider(
              task,
              workspace!,
              metadata,
              result.plan,
              attempt + 1,
              stageRuns.get('REPAIR'),
              failureContext,
            );
            await new RepairAgent().applyEdits(workspace!.rootPath, output.edits);
            const observed = await this.collectDiff(workspace!.rootPath);
            diff = observed.diff;
            changedFiles = observed.changedFiles;
          },
          onStage: async (event) => {
            currentState = await this.handleStage(
              taskId,
              workspace!,
              event,
              currentState!,
              stageRuns,
              stages,
            );
          },
        });
        repairAttempts = repair.repairs;
        if (repair.status !== 'PASSED') {
          currentState = await this.transition(taskId, currentState!, 'BLOCKED');
          throw new RuntimeExecutorError('REPAIR_REQUIRED', 'Verification remained failed after repair attempts');
        }

        // VerificationRepairLoop applies the repair; re-review and re-run the
        // real tests against that repaired diff before approval is possible.
        const observed = await this.collectDiff(workspace.rootPath);
        diff = observed.diff;
        changedFiles = observed.changedFiles;
        const reviewStart: PipelineStageEvent = { stage: 'REVIEWER', status: 'STARTED', at: new Date().toISOString() };
        currentState = await this.handleStage(taskId, workspace, reviewStart, currentState!, stageRuns, stages);
        review = new ReviewerAgent().review({ changedFiles, diff });
        const reviewComplete: PipelineStageEvent = { stage: 'REVIEWER', status: 'COMPLETED', at: new Date().toISOString(), result: review };
        currentState = await this.handleStage(taskId, workspace, reviewComplete, currentState!, stageRuns, stages);
        const testerStart: PipelineStageEvent = { stage: 'TESTER', status: 'STARTED', at: new Date().toISOString() };
        currentState = await this.handleStage(taskId, workspace, testerStart, currentState!, stageRuns, stages);
        tests = await new TesterAgent().verify(workspace.rootPath, result.plan.verification);
        const testerComplete: PipelineStageEvent = { stage: 'TESTER', status: 'COMPLETED', at: new Date().toISOString(), result: { tests, passed: tests.every((test) => test.status === 'PASSED') } };
        currentState = await this.handleStage(taskId, workspace, testerComplete, currentState!, stageRuns, stages);
        readyForApproval = review.verdict === 'APPROVED' && tests.every((test) => test.status === 'PASSED');
        if (!readyForApproval) {
          currentState = await this.transition(taskId, currentState!, 'REPAIRING');
          currentState = await this.transition(taskId, currentState, 'BLOCKED');
          throw new RuntimeExecutorError('REPAIR_REQUIRED', 'Repaired workspace did not pass review and verification');
        }
      }

      if (readyForApproval) {
        const approval = new ApprovalService(this.store).request(
          taskId,
          workspace.id,
          diff,
          this.assessRisk(changedFiles, diff, review, tests),
        );
        currentState = await this.transition(taskId, currentState!, 'READY_FOR_APPROVAL');
        await this.events.emit({
          type: 'approval.required',
          taskId,
          at: new Date().toISOString(),
          payload: { workspaceId: workspace.id, riskLevel: approval.risk.level },
        });
        return {
          taskId,
          status: 'SUCCEEDED',
          finalState: currentState,
          workspace: this.publicWorkspace(workspace),
          stages,
          changedFiles,
          diff,
          review,
          tests,
          repairAttempts,
          orchestration,
        };
      }

      throw new RuntimeExecutorError('REPAIR_REQUIRED', 'Pipeline requires repair');
    } catch (error) {
      const failure =
        error instanceof RuntimeExecutorError
          ? error
          : new RuntimeExecutorError(
              workspace ? 'PIPELINE_FAILED' : 'WORKSPACE_ERROR',
              error instanceof Error ? error.message : 'Runtime execution failed',
            );
      if (currentState && currentState !== 'FAILED' && currentState !== 'BLOCKED') {
        currentState = await this.failLifecycle(taskId, currentState);
      }
      await this.events.emit({
        type: 'agent.failed',
        taskId,
        at: new Date().toISOString(),
        payload: { error: failure.message, code: failure.code },
      });
      return { ...this.failed(taskId, stages, failure, currentState, workspace, changedFiles, diff, review, tests), orchestration };
    } finally {
      if (hasExecutionLock) this.store.releaseTaskExecutionLock(taskId, lockOwner);
      this.activeTasks.delete(taskId);
    }
  }

  private assessRisk(
    changedFiles: string[],
    diff: string,
    review: ReviewerResult | undefined,
    tests: TestExecution[],
  ) {
    const additions = diff.split('\n').filter((line) => /^\+[^+]/.test(line)).length;
    const deletions = diff.split('\n').filter((line) => /^-[^-]/.test(line)).length;
    return new RiskEngine().assess({
      changedFiles,
      additions,
      deletions,
      failedChecks: tests.filter((test) => test.status !== 'PASSED').map((test) => test.command),
      reviewerFindings: review?.findings,
    });
  }

  private loadTask(taskId: string): StoreTask {
    const task = this.store.getTask(taskId) as Record<string, unknown> | undefined;
    if (!task) throw new RuntimeExecutorError('TASK_NOT_FOUND', `Task not found: ${taskId}`);
    return {
      id: String(task.id),
      projectId: String(task.projectId),
      prompt: String(task.prompt),
      status: task.status as TaskStatus,
    };
  }

  private loadProject(projectId: string): StoreProject {
    const project = this.store.getProject(projectId) as Record<string, unknown> | undefined;
    if (!project)
      throw new RuntimeExecutorError('PROJECT_NOT_FOUND', `Project not found: ${projectId}`);
    return {
      id: String(project.id),
      repositoryId: String(project.repositoryId),
      name: String(project.name),
      metadata: (project.metadata as Record<string, unknown>) ?? {},
    };
  }

  private loadRepository(repositoryId: string): StoreRepository {
    const repository = this.store.getRepository(repositoryId) as Record<string, unknown> | undefined;
    if (!repository)
      throw new RuntimeExecutorError(
        'REPOSITORY_NOT_FOUND',
        `Repository not found: ${repositoryId}`,
      );
    return {
      id: String(repository.id),
      owner: String(repository.owner),
      name: String(repository.name),
      defaultBranch: String(repository.defaultBranch),
      localPath: repository.localPath ? String(repository.localPath) : undefined,
    };
  }

  private async resolveWorkspace(taskId: string, repository: StoreRepository) {
    const persisted = this.store.getWorkspaceForTask(taskId) as Record<string, unknown> | undefined;
    if (persisted) return this.mapWorkspace(persisted);
    const workspace = await this.workspaceManager.createWorkspace({
      repositoryPath: repository.localPath!,
      taskId,
      baseBranch: repository.defaultBranch,
    });
    const record = this.store.createWorkspace(
      taskId,
      workspace.rootPath,
      workspace.branch,
      workspace.baselineCommit,
    );
    return this.mapWorkspace(record);
  }

  private mapWorkspace(row: Record<string, unknown> | Workspace): PersistedWorkspace {
    return {
      id: String(row.id),
      taskId: String(row.taskId),
      rootPath: String(row.rootPath),
      branch: String(row.branch),
      baselineCommit: String(row.baselineCommit),
      status: String(row.status),
    };
  }

  private async loadProjectMetadata(
    workspacePath: string,
    project: StoreProject,
  ): Promise<ProjectMetadata> {
    const scanned = await scanProject(workspacePath);
    return { ...scanned, ...(project.metadata as Partial<ProjectMetadata>) };
  }

  private async runCoderProvider(
    task: StoreTask,
    workspace: PersistedWorkspace,
    metadata: ProjectMetadata,
    plan: PlannerResult,
    attempt: number,
    runId?: string,
    repairContext?: string,
  ): Promise<CoderModelOutput> {
    if (!this.provider)
      throw new RuntimeExecutorError(
        'PROVIDER_NOT_CONFIGURED',
        'Structured coder provider is not configured',
      );
    return this.provider.runCoder({
      runId: runId ?? `${task.id}:coder:${attempt}`,
      taskId: task.id,
      workspacePath: workspace.rootPath,
        role: 'CODER',
        prompt: [
          `Task: ${task.prompt}`,
          `Workspace branch: ${workspace.branch}`,
          `Project languages: ${metadata.language.join(', ') || 'unknown'}`,
          `Plan summary: ${plan.summary}`,
          `Expected behavior: ${plan.expectedBehavior}`,
          `Verification commands: ${plan.verification.commands.join(', ') || 'none'}`,
          repairContext ? `Repair context:\n${repairContext}` : '',
          await this.buildWorkspaceContext(workspace.rootPath),
          'Return complete file contents for each changed file as structured edits.',
          'Only edit files required by the task. Do not modify tests or package metadata unless the task explicitly requires it.',
        ].join('\n'),
    });
  }

  private async collectDiff(workspacePath: string) {
    const [diffResult, changedResult] = await Promise.all([
      this.git.diff(workspacePath),
      this.git.changedFiles(workspacePath),
    ]);
    return {
      diff: diffResult.stdout,
      changedFiles: changedResult.stdout.split('\n').map((file) => file.trim()).filter(Boolean),
    };
  }

  private repairFailureContext(review: ReviewerResult | undefined, tests: TestExecution[], attempt: number) {
    const failedTests = tests
      .filter((test) => test.status !== 'PASSED')
      .map((test) => `Command: ${test.command}\nExit: ${test.exitCode ?? 'unknown'}\nOutput: ${(test.stderr || test.stdout).slice(0, 4000)}`)
      .join('\n\n');
    const findings = review?.findings.map((finding) => `${finding.severity}: ${finding.message}`).join('\n') ?? '';
    return `Repair attempt: ${attempt}\nReviewer findings:\n${findings || 'none'}\nFailed verification:\n${failedTests || 'none'}`;
  }

  private async buildWorkspaceContext(workspacePath: string) {
    const files = await this.listContextFiles(workspacePath);
    let usedBytes = 0;
    const sections: string[] = [];
    for (const file of files) {
      if (usedBytes >= contextByteLimit) break;
      const content = await readFile(join(workspacePath, file), 'utf8').catch(() => undefined);
      if (content === undefined) continue;
      const remaining = contextByteLimit - usedBytes;
      const snippet = content.slice(0, remaining);
      usedBytes += Buffer.byteLength(snippet);
      sections.push(`File: ${file}\n${snippet}`);
    }
    return sections.length
      ? `Workspace context:\n${sections.join('\n\n')}`
      : 'Workspace context: no safe text files selected.';
  }

  private async listContextFiles(root: string, dir = ''): Promise<string[]> {
    const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
    const files: string[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = dir ? `${dir}/${entry.name}` : entry.name;
      if (ignoredContextPath.test(relativePath)) continue;
      if (entry.isDirectory()) {
        files.push(...(await this.listContextFiles(root, relativePath)));
      } else if (this.isContextFile(relativePath)) {
        files.push(relativePath);
      }
      if (files.length >= contextFileLimit) break;
    }
    return files.slice(0, contextFileLimit);
  }

  private isContextFile(path: string) {
    return /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|css|html)$/i.test(path) && !ignoredContextPath.test(path);
  }

  private async handleStage(
    taskId: string,
    workspace: PersistedWorkspace,
    event: PipelineStageEvent,
    currentState: TaskStatus,
    stageRuns: Map<PipelineStage, string>,
    stages: RuntimeExecutionStage[],
  ) {
    const role = stageRoles[event.stage];
    if (event.status === 'STARTED') {
      const agentRun = this.store.createAgentRun({
        taskId,
        workspaceId: workspace.id,
        role,
        attempt: 1,
      });
      stageRuns.set(event.stage, agentRun.id);
      stages.push({ stage: event.stage, role, status: event.status, agentRunId: agentRun.id });
      await this.publishAgentEvent(taskId, event, agentRun.id, role);
      return this.transitionForStageStart(taskId, currentState, event.stage);
    }

    const agentRunId = stageRuns.get(event.stage);
    if (agentRunId) {
      this.store.updateAgentRun(agentRunId, {
        status: event.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        error: event.status === 'FAILED' ? event.error : undefined,
      });
      this.store.appendAgentEvent({
        agentRunId,
        type: agentEventTypes[event.status],
        payload: this.safeStagePayload(event),
      });
    }
    stages.push({
      stage: event.stage,
      role,
      status: event.status,
      agentRunId,
      error: event.status === 'FAILED' ? event.error : undefined,
    });
    await this.publishAgentEvent(taskId, event, agentRunId, role);

    if (event.status === 'COMPLETED') {
      this.persistStageResult(taskId, agentRunId, event);
      if (event.stage === 'PLANNER') return this.transition(taskId, currentState, 'CONTEXT_READY');
    }
    return currentState;
  }

  private async transitionForStageStart(taskId: string, current: TaskStatus, stage: PipelineStage) {
    if (stage === 'CODER') return this.transition(taskId, current, 'CODING');
    if (stage === 'REVIEWER') return this.transition(taskId, current, 'REVIEWING');
    if (stage === 'TESTER') return this.transition(taskId, current, 'TESTING');
    if (stage === 'REPAIR') return this.transition(taskId, current, 'REPAIRING');
    return current;
  }

  private persistStageResult(
    taskId: string,
    agentRunId: string | undefined,
    event: Extract<PipelineStageEvent, { status: 'COMPLETED' }>,
  ) {
    if (event.stage === 'PLANNER') {
      const result = event.result as PlannerResult;
      this.store.createPlan({
        taskId,
        agentRunId,
        content: result.summary,
        affectedFiles: result.affectedFiles,
        risks: result.riskSignals,
      });
    }
    if (event.stage === 'REVIEWER') {
      const result = event.result as ReviewerResult;
      this.store.createReview({
        taskId,
        agentRunId,
        verdict: result.verdict,
        findings: result.findings,
      });
    }
    if (event.stage === 'TESTER') {
      const result = event.result as { tests: TestExecution[] };
      for (const test of result.tests)
        this.store.recordTestRun({
          taskId,
          command: test.command,
          status: test.status,
          exitCode: test.exitCode,
          stdout: test.stdout,
          stderr: test.stderr,
          durationMs: test.durationMs,
        });
    }
  }

  private async publishAgentEvent(
    taskId: string,
    event: PipelineStageEvent,
    agentRunId: string | undefined,
    role: AgentRole,
  ) {
    await this.events.emit({
      type: agentEventTypes[event.status],
      taskId,
      at: event.at,
      payload: {
        role,
        stage: event.stage,
        agentRunId,
        ...this.safeStagePayload(event),
      },
    });
  }

  private safeStagePayload(event: PipelineStageEvent): Record<string, unknown> {
    if (event.status === 'FAILED') return { error: event.error };
    if (event.status === 'STARTED') return {};
    if (event.stage === 'PLANNER') {
      const result = event.result as PlannerResult;
      return {
        summary: result.summary,
        affectedFiles: result.affectedFiles,
        riskSignals: result.riskSignals,
        verificationCommands: result.verification.commands,
      };
    }
    if (event.stage === 'CODER') {
      const result = event.result as { changedFiles: string[]; appliedEdits: { path: string }[] };
      return {
        changedFiles: result.changedFiles,
        editPaths: result.appliedEdits.map((edit) => edit.path),
      };
    }
    if (event.stage === 'REVIEWER') {
      const result = event.result as ReviewerResult;
      return { verdict: result.verdict, findings: result.findings };
    }
    if (event.stage === 'TESTER') {
      const result = event.result as { tests: TestExecution[]; passed: boolean };
      return {
        passed: result.passed,
        tests: result.tests.map((test) => ({
          command: test.command,
          status: test.status,
          exitCode: test.exitCode,
          durationMs: test.durationMs,
        })),
      };
    }
    return {};
  }

  private async transition(taskId: string, current: TaskStatus, target: TaskStatus) {
    if (current === target) return current;
    return this.lifecycle.transition(taskId, target);
  }

  private async failLifecycle(taskId: string, current: TaskStatus) {
    if (current === 'TESTING') {
      try {
        return await this.transition(taskId, current, 'FAILED');
      } catch {
        return current;
      }
    }
    if (
      ['PLANNING', 'CONTEXT_READY', 'CODING', 'REVIEWING', 'REPAIRING', 'APPROVED'].includes(
        current,
      )
    ) {
      try {
        return await this.transition(taskId, current, 'FAILED');
      } catch {
        return current;
      }
    }
    return current;
  }

  private failed(
    taskId: string,
    stages: RuntimeExecutionStage[],
    error: RuntimeExecutorError,
    finalState?: TaskStatus,
    workspace?: PersistedWorkspace,
    changedFiles: string[] = [],
    diff = '',
    review?: ReviewerResult,
    tests: TestExecution[] = [],
  ): RuntimeExecutionResult {
    return {
      taskId,
      status: finalState === 'BLOCKED' ? 'BLOCKED' : 'FAILED',
      finalState,
      workspace: workspace ? this.publicWorkspace(workspace) : undefined,
      stages,
      changedFiles,
      diff,
      review,
      tests,
      repairAttempts: finalState === 'BLOCKED' ? 1 : 0,
      error: { code: error.code, message: error.message },
    };
  }

  private publicWorkspace(workspace: PersistedWorkspace) {
    return {
      id: workspace.id,
      rootPath: workspace.rootPath,
      branch: workspace.branch,
      baselineCommit: workspace.baselineCommit,
    };
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
