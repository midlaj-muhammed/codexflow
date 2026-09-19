import { z } from 'zod';

export const CODEXFLOW_PACKAGE_NAME = '@codexflow/shared';

export const providerSchema = z.enum(['github', 'gitlab', 'bitbucket']);
export const taskStatusSchema = z.enum([
  'CREATED',
  'QUEUED',
  'PLANNING',
  'CONTEXT_READY',
  'CODING',
  'REVIEWING',
  'TESTING',
  'REPAIRING',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'APPLIED',
  'REJECTED',
  'ROLLED_BACK',
  'FAILED',
  'CANCELLED',
  'BLOCKED',
]);
export const agentRoleSchema = z.enum([
  'PLANNER',
  'CODER',
  'REVIEWER',
  'TESTER',
  'REPAIR',
  'SECURITY_REVIEWER',
  'TEST_GENERATOR',
  'REPORTER',
  'SUPERVISOR',
  'INTEGRATION',
]);
export const agentStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
]);
export const riskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const testRunStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'PASSED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
]);
export const approvalDecisionSchema = z.enum(['APPROVED', 'REJECTED', 'PENDING']);

export type Provider = z.infer<typeof providerSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type AgentRole = z.infer<typeof agentRoleSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type TestRunStatus = z.infer<typeof testRunStatusSchema>;

const entity = {
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};
export const repositorySchema = z.object({
  ...entity,
  provider: providerSchema,
  owner: z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
  defaultBranch: z.string().min(1),
  localPath: z.string().optional(),
});
export const projectSchema = z.object({
  ...entity,
  repositoryId: z.string().uuid(),
  name: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export const taskSchema = z.object({
  ...entity,
  projectId: z.string().uuid(),
  prompt: z.string().min(1),
  status: taskStatusSchema.default('CREATED'),
  riskLevel: riskLevelSchema.optional(),
});
export const workspaceSchema = z.object({
  ...entity,
  taskId: z.string().uuid(),
  rootPath: z.string().min(1),
  branch: z.string().min(1),
  baselineCommit: z.string().min(1),
  status: z.enum(['ACTIVE', 'CLEANED_UP', 'FAILED']).default('ACTIVE'),
});
export const agentRunSchema = z.object({
  ...entity,
  taskId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
  role: agentRoleSchema,
  status: agentStatusSchema.default('PENDING'),
  attempt: z.number().int().min(1),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});
export const agentEventSchema = z.object({
  ...entity,
  agentRunId: z.string().uuid(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export const planSchema = z.object({
  ...entity,
  taskId: z.string().uuid(),
  agentRunId: z.string().uuid().optional(),
  content: z.string().min(1),
  affectedFiles: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
});
export const testPlanSchema = z.object({
  ...entity,
  taskId: z.string().uuid(),
  strategy: z.string().min(1),
  commands: z.array(z.string()).min(1),
  requiresNewTests: z.boolean().default(false),
  rationale: z.string().min(1),
});
export const testRunSchema = z.object({
  ...entity,
  taskId: z.string().uuid(),
  testPlanId: z.string().uuid().optional(),
  command: z.string().min(1),
  status: testRunStatusSchema,
  exitCode: z.number().int().nullable(),
  stdout: z.string().default(''),
  stderr: z.string().default(''),
  durationMs: z.number().int().min(0),
});
export const reviewSchema = z.object({
  ...entity,
  taskId: z.string().uuid(),
  agentRunId: z.string().uuid().optional(),
  verdict: z.enum(['APPROVED', 'CHANGES_REQUESTED']),
  findings: z
    .array(
      z.object({
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
        message: z.string(),
        file: z.string().optional(),
      }),
    )
    .default([]),
});
export const approvalSchema = z.object({
  ...entity,
  taskId: z.string().uuid(),
  decision: approvalDecisionSchema,
  approvedBy: z.string().optional(),
  note: z.string().optional(),
});
export const commitSchema = z.object({
  ...entity,
  taskId: z.string().uuid(),
  sha: z.string().min(1),
  message: z.string().min(1),
});
export const pullRequestSchema = z.object({
  ...entity,
  taskId: z.string().uuid(),
  providerId: z.string().min(1),
  number: z.number().int().positive(),
  url: z.url(),
  title: z.string().min(1),
  body: z.string().default(''),
  status: z.enum(['OPEN', 'CLOSED', 'MERGED']),
});
export const pullRequestCommentSchema = z.object({
  ...entity,
  pullRequestId: z.string().uuid(),
  providerId: z.string().optional(),
  body: z.string().min(1),
  author: z.string().min(1),
});
export const evaluationSchema = z.object({
  ...entity,
  taskId: z.string().uuid().optional(),
  benchmarkId: z.string().min(1),
  passAt1: z.boolean(),
  passAt3: z.boolean(),
  regressionDetected: z.boolean(),
  repairAttempts: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  filesChanged: z.number().int().min(0),
  linesAdded: z.number().int().min(0),
  linesRemoved: z.number().int().min(0),
});
