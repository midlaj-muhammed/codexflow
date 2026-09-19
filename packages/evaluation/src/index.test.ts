import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type StructuredCoderProvider } from '@codexflow/agents';
import { CodexFlowStore, openDatabase } from '@codexflow/database';
import { GitEngine } from '@codexflow/git';
import { RuntimeExecutor } from '@codexflow/runtime';
import { WorkspaceManager } from '@codexflow/workspace';
import { calculateEvaluationMetrics, EvaluationRunner, starterBenchmarkFixtures } from './index.js';

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd }).toString().trim();
}

describe('evaluation persistence and metrics', () => {
  it('persists reproducible benchmark evaluations without inventing token or cost values', () => {
    const store = new CodexFlowStore(openDatabase());
    const benchmark = store.createBenchmark({ name: 'starter', description: 'controlled local fixtures', version: '1.0.0' });
    const task = store.createBenchmarkTask({ benchmarkId: benchmark.id, ...starterBenchmarkFixtures[0] });
    const result = store.createEvaluationRun({ benchmarkTaskId: task.id, finalState: 'READY_FOR_APPROVAL', technicalSuccess: true, reviewPassed: true, verificationPassed: true, repairAttempts: 0, durationMs: 42, filesChanged: 1, linesAdded: 1, linesRemoved: 1 });
    expect(store.getEvaluationRun(result.id)).toMatchObject({ benchmarkTaskId: task.id, tokenUsage: undefined, costUsd: undefined, plannedStages: [], executedStages: [], specialistOutcomes: {} });
    expect(calculateEvaluationMetrics(store.listEvaluationRuns())).toMatchObject({ passAt1: 1, finalTaskSuccessRate: 1, repairRate: 0 });
  });
  it('keeps blocked and repaired outcomes distinct', () => {
    const store = new CodexFlowStore(openDatabase());
    const benchmark = store.createBenchmark({ name: 'outcomes', description: 'outcome metrics', version: '1' });
    const task = store.createBenchmarkTask({ benchmarkId: benchmark.id, ...starterBenchmarkFixtures[1] });
    store.createEvaluationRun({ benchmarkTaskId: task.id, finalState: 'BLOCKED', technicalSuccess: false, repairAttempts: 2, durationMs: 10, filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
    const metrics = calculateEvaluationMetrics(store.listEvaluationRuns());
    expect(metrics).toMatchObject({ blockedRate: 1, repairRate: 1, repairSuccessRate: 0 });
  });
  it('ships a controlled initial benchmark catalogue', () => {
    expect(starterBenchmarkFixtures).toHaveLength(12);
    expect(new Set(starterBenchmarkFixtures.map((fixture) => fixture.category)).size).toBeGreaterThanOrEqual(6);
  });
  it('uses RuntimeExecutor rather than a separate evaluator execution path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evaluation-runtime-'));
    const repositoryPath = join(root, 'repo');
    mkdirSync(join(repositoryPath, 'src'), { recursive: true });
    git(repositoryPath, 'init', '-b', 'main');
    git(repositoryPath, 'config', 'user.email', 'test@example.com');
    git(repositoryPath, 'config', 'user.name', 'Test');
    writeFileSync(join(repositoryPath, 'src', 'message.txt'), 'hello\n');
    writeFileSync(join(repositoryPath, 'package.json'), JSON.stringify({ scripts: { test: "grep -qx 'hello codexflow' src/message.txt" } }));
    git(repositoryPath, 'add', '.');
    const baseline = git(repositoryPath, 'commit', '-m', 'base');
    const store = new CodexFlowStore(openDatabase());
    const repository = store.createRepository({ provider: 'github', owner: 'acme', name: 'evaluation', url: 'https://example.test/evaluation', defaultBranch: 'main', localPath: repositoryPath });
    const project = store.createProject(String(repository.id), 'evaluation');
    const task = store.createTask(String(project.id), 'Change src/message.txt to hello codexflow');
    const benchmark = store.createBenchmark({ name: 'runtime', description: 'real executor fixture', version: '1' });
    const benchmarkTask = store.createBenchmarkTask({ benchmarkId: benchmark.id, ...starterBenchmarkFixtures[0] });
    const provider: StructuredCoderProvider = { runCoder: async () => ({ edits: [{ path: 'src/message.txt', content: 'hello codexflow\n' }] }) };
    const runtime = new RuntimeExecutor({ store, provider, workspaceManager: new WorkspaceManager(new GitEngine(), join(root, 'workspaces')) });
    const runner = new EvaluationRunner(store, runtime);
    const result = await runner.run(benchmarkTask, async () => ({ taskId: String(task.id), repositoryCommit: baseline, provider: 'test', model: 'deterministic' }));
    expect(result).toMatchObject({
      taskId: task.id,
      technicalSuccess: true,
      verificationPassed: true,
      filesChanged: 1,
      strategy: 'BUG_FIX',
      plannedStages: ['PLANNER', 'CODER', 'REVIEWER', 'TESTER'],
      executedStages: expect.arrayContaining([
        expect.objectContaining({ role: 'PLANNER', status: 'COMPLETED' }),
        expect.objectContaining({ role: 'CODER', status: 'COMPLETED' }),
      ]),
    });
    expect(store.listTestRuns(String(task.id))).toEqual([expect.objectContaining({ status: 'PASSED' })]);
  });
  it('persists specialist provenance for strategy-aware evaluation runs', async () => {
    const store = new CodexFlowStore(openDatabase());
    const benchmark = store.createBenchmark({ name: 'specialists', description: 'strategy provenance', version: '1' });
    const benchmarkTask = store.createBenchmarkTask({ benchmarkId: benchmark.id, ...starterBenchmarkFixtures[4] });
    const repository = store.createRepository({ provider: 'github', owner: 'acme', name: 'specialists', url: 'https://example.test/specialists', defaultBranch: 'main' });
    const project = store.createProject(String(repository.id), 'specialists');
    const task = store.createTask(String(project.id), 'Add regression test coverage');
    const runtime = {
      execute: async () => ({
        taskId: 'task-1',
        status: 'SUCCEEDED' as const,
        finalState: 'READY_FOR_APPROVAL' as const,
        stages: [
          { stage: 'PLANNER' as const, role: 'PLANNER' as const, status: 'COMPLETED' as const },
          { stage: 'CODER' as const, role: 'CODER' as const, status: 'COMPLETED' as const },
          { stage: 'TEST_GENERATOR' as const, role: 'TEST_GENERATOR' as const, status: 'COMPLETED' as const },
          { stage: 'REVIEWER' as const, role: 'REVIEWER' as const, status: 'COMPLETED' as const },
          { stage: 'TESTER' as const, role: 'TESTER' as const, status: 'COMPLETED' as const },
        ],
        changedFiles: ['tests/generated.test.js'],
        diff: '+generated',
        review: { verdict: 'APPROVED' as const, findings: [] },
        tests: [{ command: 'node tests/generated.test.js', exitCode: 0, stdout: '', stderr: '', durationMs: 1, status: 'PASSED' as const }],
        repairAttempts: 0,
        orchestration: { strategy: 'TEST_GENERATION' as const, stages: ['PLANNER', 'CODER', 'TEST_GENERATOR', 'REVIEWER', 'TESTER'] as const, maxProviderRequests: 3, maxTotalAttempts: 3, verification: 'TESTS' as const },
      }),
    };
    const runner = new EvaluationRunner(store, runtime);
    const result = await runner.run(benchmarkTask, async () => ({ taskId: String(task.id) }));
    expect(result).toMatchObject({
      strategy: 'TEST_GENERATION',
      plannedStages: ['PLANNER', 'CODER', 'TEST_GENERATOR', 'REVIEWER', 'TESTER'],
      specialistOutcomes: { TEST_GENERATOR: 'COMPLETED' },
    });
  });
});
