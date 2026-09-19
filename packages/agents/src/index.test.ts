import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentRunner,
  CoderAgent,
  CoreAgentPipeline,
  MockAgentProvider,
  OpenAIResponsesProvider,
  OrchestrationSupervisor,
  PlannerAgent,
  ReviewerAgent,
  SecurityReviewerAgent,
  RiskEngine,
  SupervisorAgent,
  TesterAgent,
  VerificationRepairLoop,
  ApprovalService,
  type PipelineStageEvent,
  scanProject,
} from './index.js';
describe('scanner and mock provider', () => {
  it('detects a Next/Vitest project from files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scan-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        packageManager: 'pnpm@9',
        dependencies: { next: 'x', vitest: 'x' },
        scripts: { test: 'vitest run', build: 'next build' },
      }),
    );
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    const result = await scanProject(root);
    expect(result).toMatchObject({
      framework: 'Next.js',
      testFramework: 'Vitest',
      packageManager: 'pnpm',
      language: expect.arrayContaining(['TypeScript']),
    });
  });
  it('streams deterministic mock agent events', async () => {
    const provider = new MockAgentProvider();
    await provider.run({
      runId: 'r',
      taskId: 't',
      workspacePath: '/tmp',
      role: 'PLANNER',
      prompt: 'x',
    });
    const events = [];
    for await (const event of provider.stream('r')) events.push(event);
    expect(events).toHaveLength(2);
  });
  it('uses the verified Responses API contract without leaking the key in results', async () => {
    const provider = new OpenAIResponsesProvider('top-secret', 'gpt-5', async (_url, init) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer top-secret' });
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'gpt-5', store: false });
      return new Response(JSON.stringify({ id: 'resp_1', output_text: 'structured result' }));
    });
    await expect(
      provider.run({
        runId: 'r',
        taskId: 't',
        workspacePath: '/tmp',
        role: 'PLANNER',
        prompt: 'Plan',
      }),
    ).resolves.toMatchObject({ output: 'structured result' });
  });
  it('requests schema-constrained structured coder output from OpenAI', async () => {
    const provider = new OpenAIResponsesProvider('top-secret', 'gpt-5', async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        text?: { format?: { type?: string; name?: string; strict?: boolean } };
      };
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer top-secret' });
      expect(body.text?.format).toMatchObject({
        type: 'json_schema',
        name: 'coder_model_output',
        strict: true,
      });
      return new Response(
        JSON.stringify({
          id: 'resp_2',
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    edits: [{ path: 'src/message.txt', content: 'hello' }],
                    explanation: 'fixture',
                  }),
                },
              ],
            },
          ],
        }),
      );
    });
    await expect(
      provider.runCoder({
        runId: 'coder',
        taskId: 't',
        workspacePath: '/tmp',
        role: 'CODER',
        prompt: 'Change a file',
      }),
    ).resolves.toEqual({
      edits: [{ path: 'src/message.txt', content: 'hello' }],
      explanation: 'fixture',
    });
  });
  it('persists runner attempts and failures through a provider-neutral runner', async () => {
    const calls: string[] = [];
    const runner = new AgentRunner(new MockAgentProvider(), {
      createRun: () => {
        calls.push('create');
      },
      appendEvent: () => {
        calls.push('event');
      },
      finishRun: () => {
        calls.push('finish');
      },
    });
    await runner.run({
      runId: 'r',
      taskId: 't',
      workspacePath: '/tmp',
      role: 'PLANNER',
      prompt: 'Plan',
      attempt: 1,
    });
    expect(calls).toEqual(['create', 'event', 'event', 'finish']);
  });
  it('cancels and records a timed out agent run', async () => {
    let cancelled = false;
    const provider = {
      run: async () => new Promise<never>(() => {}),
      cancel: async () => {
        cancelled = true;
      },
      async *stream() {},
    };
    const finishes: string[] = [];
    const runner = new AgentRunner(provider, {
      createRun: () => {},
      appendEvent: () => {},
      finishRun: (_runId, status) => {
        finishes.push(status);
      },
    });
    await expect(
      runner.run({
        runId: 'slow',
        taskId: 't',
        workspacePath: '/tmp',
        role: 'PLANNER',
        prompt: 'Plan',
        attempt: 1,
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(cancelled).toBe(true);
    expect(finishes).toEqual(['FAILED']);
  });
  it('creates a task-specific verification strategy without inventing tests for normal work', () => {
    const planner = new PlannerAgent();
    const normal = planner.plan({
      prompt: 'Rename a button',
      metadata: {
        language: ['TypeScript'],
        testDirectories: ['test'],
        sourceDirectories: [],
        configFiles: [],
        testCommand: 'echo test',
      },
    });
    const bug = planner.plan({
      prompt: 'Fix timeout bug',
      metadata: {
        language: ['TypeScript'],
        testDirectories: ['test'],
        sourceDirectories: [],
        configFiles: [],
        testCommand: 'echo test',
      },
    });
    expect(normal.verification.requiresNewTests).toBe(false);
    expect(bug.verification.requiresNewTests).toBe(true);
  });
  it('executes actual verification and rejects destructive commands', async () => {
    const tester = new TesterAgent();
    await expect(
      tester.verify('/tmp', {
        commands: ['printf verification'],
        requiresNewTests: false,
        rationale: 'test',
      }),
    ).resolves.toEqual([expect.objectContaining({ status: 'PASSED', stdout: 'verification' })]);
    await expect(
      tester.verify('/tmp', {
        commands: ['rm -rf temporary'],
        requiresNewTests: false,
        rationale: 'test',
      }),
    ).rejects.toThrow('denied');
  });
  it('reports deterministic security review findings', () => {
    expect(new ReviewerAgent().review({ changedFiles: ['.env'], diff: '+SECRET=x' })).toMatchObject(
      { verdict: 'CHANGES_REQUESTED', findings: [expect.objectContaining({ severity: 'HIGH' })] },
    );
  });
  it('writes only safe relative files inside the task worktree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coder-'));
    const coder = new CoderAgent();
    await coder.applyEdits(root, [{ path: 'feature.txt', content: 'done' }]);
    await coder.applyModelOutput(
      root,
      JSON.stringify({ edits: [{ path: 'model.txt', content: 'model' }] }),
    );
    await expect(coder.applyEdits(root, [{ path: '.env', content: 'secret' }])).rejects.toThrow(
      'denied',
    );
  });
  it('blocks after the configured repair limit', () => {
    const supervisor = new SupervisorAgent(2);
    expect(supervisor.nextAfterVerification(1, false)).toBe('REPAIRING');
    expect(supervisor.nextAfterVerification(2, false)).toBe('BLOCKED');
    expect(supervisor.nextAfterVerification(1, true)).toBe('READY_FOR_APPROVAL');
  });
  it('runs planner, coder, reviewer, and actual tester as one task pipeline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pipeline-'));
    const result = await new CoreAgentPipeline().run({
      prompt: 'Rename label',
      metadata: {
        language: ['TypeScript'],
        sourceDirectories: [],
        testDirectories: [],
        configFiles: [],
        testCommand: 'printf pass',
      },
      workspacePath: root,
      modelOutput: JSON.stringify({ edits: [{ path: 'label.txt', content: 'new' }] }),
      diff: '+new',
      changedFiles: ['label.txt'],
    });
    expect(result).toMatchObject({
      next: 'READY_FOR_APPROVAL',
      tests: [expect.objectContaining({ status: 'PASSED' })],
    });
  });
  it('exposes real pipeline stage boundaries and typed stage results', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pipeline-events-'));
    const events: PipelineStageEvent[] = [];
    await new CoreAgentPipeline().run({
      prompt: 'Rename label',
      metadata: {
        language: ['TypeScript'],
        sourceDirectories: [],
        testDirectories: [],
        configFiles: [],
        testCommand: 'printf pass',
      },
      workspacePath: root,
      modelOutput: JSON.stringify({
        edits: [{ path: 'label.txt', content: 'new' }],
        explanation: 'fixture edit',
      }),
      diff: '+new',
      changedFiles: ['label.txt'],
      onStage: (event) => {
        events.push(event);
      },
    });

    expect(events.map((event) => `${event.stage}:${event.status}`)).toEqual([
      'PLANNER:STARTED',
      'PLANNER:COMPLETED',
      'CODER:STARTED',
      'CODER:COMPLETED',
      'REVIEWER:STARTED',
      'REVIEWER:COMPLETED',
      'TESTER:STARTED',
      'TESTER:COMPLETED',
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'PLANNER',
          status: 'COMPLETED',
          result: expect.objectContaining({ summary: 'Rename label' }),
        }),
        expect.objectContaining({
          stage: 'CODER',
          status: 'COMPLETED',
          result: expect.objectContaining({
            modelOutput: expect.objectContaining({ explanation: 'fixture edit' }),
            changedFiles: ['label.txt'],
          }),
        }),
        expect.objectContaining({
          stage: 'REVIEWER',
          status: 'COMPLETED',
          result: expect.objectContaining({ verdict: 'APPROVED' }),
        }),
        expect.objectContaining({
          stage: 'TESTER',
          status: 'COMPLETED',
          result: expect.objectContaining({
            tests: [expect.objectContaining({ command: 'printf pass', status: 'PASSED' })],
            passed: true,
          }),
        }),
      ]),
    );
  });
  it('emits a failed stage boundary when model output is invalid', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pipeline-failure-'));
    const events: PipelineStageEvent[] = [];
    await expect(
      new CoreAgentPipeline().run({
        prompt: 'Rename label',
        metadata: {
          language: ['TypeScript'],
          sourceDirectories: [],
          testDirectories: [],
          configFiles: [],
        },
        workspacePath: root,
        modelOutput: JSON.stringify({ edits: [{ path: '.env', content: 'SECRET=1' }] }),
        diff: '+SECRET=1',
        changedFiles: ['.env'],
        onStage: (event) => {
          events.push(event);
        },
      }),
    ).rejects.toThrow('denied');
    expect(events.at(-1)).toMatchObject({
      stage: 'CODER',
      status: 'FAILED',
      error: expect.stringContaining('denied'),
    });
  });
  it('reruns real verification after repair until it passes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repair-'));
    const loop = new VerificationRepairLoop(new TesterAgent());
    const events: PipelineStageEvent[] = [];
    const result = await loop.run({
      workspacePath: root,
      plan: { commands: ['test -f fixed.txt'], requiresNewTests: false, rationale: 'fixture' },
      repair: async () => {
        writeFileSync(join(root, 'fixed.txt'), 'fixed');
      },
      onStage: (event) => {
        events.push(event);
      },
    });
    expect(result).toMatchObject({
      status: 'PASSED',
      repairs: 1,
      tests: [expect.objectContaining({ status: 'PASSED' })],
    });
    expect(events.map((event) => `${event.stage}:${event.status}`)).toEqual([
      'REPAIR:STARTED',
      'REPAIR:COMPLETED',
    ]);
  });
  it('produces explainable deterministic high risk and enforces approval', () => {
    const risk = new RiskEngine().assess({
      changedFiles: ['src/auth.ts', '.env'],
      additions: 2,
      deletions: 0,
      failedChecks: ['test'],
    });
    const approvals = new ApprovalService();
    approvals.request('t', 'w', 'diff', risk);
    expect(risk).toMatchObject({
      level: 'HIGH',
      reasons: expect.arrayContaining(['Authentication or authorization-related file changed']),
    });
    expect(() => approvals.assertMayApply('t', 'diff')).toThrow('requires explicit');
    approvals.approve('t', 'human', 'diff');
    expect(approvals.assertMayApply('t', 'diff').state).toBe('APPROVED');
  });
  it('invalidates an approval after workspace diff changes', () => {
    const approvals = new ApprovalService();
    approvals.request('t', 'w', 'before', { level: 'HIGH', score: 80, reasons: ['x'] });
    approvals.approve('t', 'human', 'before');
    expect(() => approvals.assertMayApply('t', 'after')).toThrow('EXPIRED');
  });
  it('hydrates a fingerprint-bound approval from persistence after restart', () => {
    const saved = new Map();
    const persistence = {
      saveApproval: (approval: { taskId: string }) => {
        saved.set(approval.taskId, structuredClone(approval));
      },
      loadApproval: (taskId: string) => saved.get(taskId),
    };
    const first = new ApprovalService(persistence);
    first.request('t', 'w', 'diff', { level: 'HIGH', score: 80, reasons: ['x'] });
    first.approve('t', 'human', 'diff');
    const restarted = new ApprovalService(persistence);
    expect(restarted.assertMayApply('t', 'diff')).toMatchObject({ state: 'APPROVED' });
  });
  it('selects bounded, validated strategies without letting an agent invent a graph', () => {
    const supervisor = new OrchestrationSupervisor();
    const metadata = { language: ['TypeScript'], sourceDirectories: ['src'], testDirectories: ['tests'], configFiles: [], testCommand: 'pnpm test', lintCommand: 'pnpm lint', buildCommand: 'pnpm build' };
    expect(supervisor.select({ prompt: 'Fix authentication security bug', metadata })).toMatchObject({
      strategy: 'SECURITY', stages: ['PLANNER', 'CODER', 'REVIEWER', 'TESTER'], verification: 'TESTS_LINT_AND_BUILD', maxTotalAttempts: 3,
    });
    expect(supervisor.select({ prompt: 'Refactor parser names', metadata }).strategy).toBe('REFACTOR');
    expect(supervisor.select({ prompt: 'Add regression coverage', metadata }).strategy).toBe('TEST_GENERATION');
    expect(supervisor.select({ prompt: 'Fix the parser bug', metadata }).strategy).toBe('BUG_FIX');
  });
  it('runs the read-only security specialist against the actual diff', () => {
    const reviewer = new SecurityReviewerAgent();
    expect(reviewer.review({ changedFiles: ['src/a.ts'], diff: '+const ok = true;' })).toMatchObject({ verdict: 'PASSED' });
    expect(reviewer.review({ changedFiles: ['.env'], diff: '+TOKEN=value' })).toMatchObject({ verdict: 'FINDINGS' });
  });
  it('runs TestGenerator before review and verification through the safe edit path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'test-generator-'));
    writeFileSync(join(root, 'code.txt'), 'code');
    const stages: string[] = [];
    const result = await new CoreAgentPipeline().run({
      prompt: 'Add regression test coverage', metadata: { language: [], sourceDirectories: [], testDirectories: [], configFiles: [], testCommand: 'test -f generated.test.txt' }, workspacePath: root,
      resolveCoderOutput: async () => ({ edits: [{ path: 'code.txt', content: 'changed' }] }),
      runTestGenerator: true,
      resolveTestGeneratorOutput: async () => ({ edits: [{ path: 'generated.test.txt', content: 'coverage' }], explanation: 'test fixture' }),
      resolveDiff: async (stage) => ({ diff: stage.changedFiles.join('\n'), changedFiles: stage.changedFiles }), diff: '', changedFiles: [],
      onStage: (event) => { if (event.status === 'STARTED') stages.push(event.stage); },
    });
    expect(readFileSync(join(root, 'generated.test.txt'), 'utf8')).toBe('coverage');
    expect(stages).toEqual(['PLANNER', 'CODER', 'TEST_GENERATOR', 'REVIEWER', 'TESTER']);
    expect(result.tests).toEqual([expect.objectContaining({ status: 'PASSED' })]);
  });
});
