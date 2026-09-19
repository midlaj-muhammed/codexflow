import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentRunner,
  CoderAgent,
  CoreAgentPipeline,
  MockAgentProvider,
  OpenAIResponsesProvider,
  PlannerAgent,
  ReviewerAgent,
  SupervisorAgent,
  TesterAgent,
  VerificationRepairLoop,
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
  it('reruns real verification after repair until it passes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'repair-'));
    const loop = new VerificationRepairLoop(new TesterAgent());
    const result = await loop.run({
      workspacePath: root,
      plan: { commands: ['test -f fixed.txt'], requiresNewTests: false, rationale: 'fixture' },
      repair: async () => {
        writeFileSync(join(root, 'fixed.txt'), 'fixed');
      },
    });
    expect(result).toMatchObject({
      status: 'PASSED',
      repairs: 1,
      tests: [expect.objectContaining({ status: 'PASSED' })],
    });
  });
});
