import type { BenchmarkTaskRecord, CodexFlowStore, EvaluationRunRecord } from '@codexflow/database';
import type { RuntimeExecutionResult } from '@codexflow/runtime';

/** A deterministic, versioned task catalogue. Fixture setup stays at the runner boundary. */
export type BenchmarkFixture = Omit<BenchmarkTaskRecord, 'id' | 'benchmarkId' | 'createdAt' | 'updatedAt'> & {
  category: 'BUG_FIX' | 'FEATURE' | 'REFACTOR' | 'TEST' | 'VALIDATION' | 'API' | 'DEPENDENCY' | 'REGRESSION';
};

const starterFixtureRows = [
  ['add-sum', 'Implement add(a, b) so it returns the sum.', 'node tests/math.test.js', 'add(2, 3) returns 5', 'BUG_FIX'],
  ['greeting-feature', 'Add greet(name) returning Hello, <name>.', 'node tests/greeting.test.js', 'greeting is formatted', 'FEATURE'],
  ['null-validation', 'Reject a missing required name with a clear error.', 'node tests/validation.test.js', 'missing name is rejected', 'VALIDATION'],
  ['parse-refactor', 'Refactor parseValue without changing its public behavior.', 'node tests/parser.test.js', 'parser compatibility remains', 'REFACTOR'],
  ['test-regression', 'Add a regression test for empty input.', 'node tests/empty.test.js', 'empty input stays covered', 'TEST'],
  ['api-status', 'Return a 404 response for an unknown resource.', 'node tests/api.test.js', 'unknown resource returns 404', 'API'],
  ['trim-regression', 'Fix whitespace trimming in normalizeName.', 'node tests/name.test.js', 'name values are trimmed', 'REGRESSION'],
  ['config-validation', 'Validate that port is a positive integer.', 'node tests/config.test.js', 'invalid port is rejected', 'VALIDATION'],
  ['format-date', 'Add ISO date formatting for a valid Date input.', 'node tests/date.test.js', 'ISO date is returned', 'FEATURE'],
  ['dependency-safe', 'Use the existing utility instead of duplicating parsing logic.', 'node tests/utility.test.js', 'existing utility is used', 'DEPENDENCY'],
  ['array-bounds', 'Fix out-of-range array lookup to return undefined.', 'node tests/array.test.js', 'out-of-range is safe', 'BUG_FIX'],
  ['error-message', 'Add a test and implementation for invalid token errors.', 'node tests/token.test.js', 'invalid token error is stable', 'TEST'],
] as const;

export const starterBenchmarkFixtures: readonly BenchmarkFixture[] = starterFixtureRows.map(([name, prompt, verificationCommand, expectedBehavior, category]) => ({
  name,
  prompt,
  verificationCommand,
  expectedBehavior,
  metadata: { fixture: name },
  category,
}));

/** Idempotently installs the controlled starter catalogue into an existing store. */
export function ensureStarterBenchmark(store: CodexFlowStore) {
  const existing = store.listBenchmarks().find((benchmark) => benchmark.name === 'CodexFlow starter' && benchmark.version === '1.0.0');
  const benchmark = existing ?? store.createBenchmark({
    name: 'CodexFlow starter',
    description: 'Twelve deterministic local coding-task fixtures for repeatable evaluation.',
    version: '1.0.0',
  });
  const current = new Set(store.listBenchmarkTasks(benchmark.id).map((task) => task.name));
  for (const fixture of starterBenchmarkFixtures) {
    if (!current.has(fixture.name)) store.createBenchmarkTask({ ...fixture, benchmarkId: benchmark.id });
  }
  return { benchmark, tasks: store.listBenchmarkTasks(benchmark.id) };
}

export type EvaluationPreparation = {
  taskId: string;
  repositoryCommit?: string;
  provider?: string;
  model?: string;
};
export type RuntimeExecutorLike = { execute(taskId: string): Promise<RuntimeExecutionResult> };
export type EvaluationMetrics = {
  passAt1: number | null;
  passAtN: number | null;
  finalTaskSuccessRate: number | null;
  repairRate: number | null;
  repairSuccessRate: number | null;
  blockedRate: number | null;
  verificationFailureRate: number | null;
  averageRepairAttempts: number | null;
  averageExecutionDurationMs: number | null;
  averageFilesChanged: number | null;
  averageLinesChanged: number | null;
  regressionRate: number | null;
};

function diffStats(diff: string | undefined) {
  const lines = (diff ?? '').split('\n');
  return {
    linesAdded: lines.filter((line) => /^\+[^+]/.test(line)).length,
    linesRemoved: lines.filter((line) => /^-[^-]/.test(line)).length,
  };
}

/** Runs a persisted benchmark task through the authoritative RuntimeExecutor. */
export class EvaluationRunner {
  constructor(private readonly store: CodexFlowStore, private readonly runtime: RuntimeExecutorLike) {}

  async run(benchmarkTask: BenchmarkTaskRecord, prepare: () => Promise<EvaluationPreparation>) {
    const preparation = await prepare();
    const started = Date.now();
    const result = await this.runtime.execute(preparation.taskId);
    const testsPassed = result.tests?.length
      ? result.tests.every((test) => test.status === 'PASSED')
      : undefined;
    const reviewPassed = result.review?.verdict === 'APPROVED';
    const stats = diffStats(result.diff);
    return this.store.createEvaluationRun({
      benchmarkTaskId: benchmarkTask.id,
      taskId: preparation.taskId,
      repositoryCommit: preparation.repositoryCommit,
      provider: preparation.provider,
      model: preparation.model,
      finalState: result.finalState ?? 'FAILED',
      technicalSuccess: result.status === 'SUCCEEDED' && result.finalState === 'READY_FOR_APPROVAL',
      reviewPassed: result.review ? reviewPassed : undefined,
      verificationPassed: testsPassed,
      repairAttempts: result.repairAttempts ?? 0,
      durationMs: Date.now() - started,
      filesChanged: result.changedFiles?.length ?? 0,
      linesAdded: stats.linesAdded,
      linesRemoved: stats.linesRemoved,
      error: result.error?.message,
    });
  }
}

const average = (numbers: number[]) => numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
const rate = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;

/** Aggregates only persisted, actually executed evaluation records. */
export function calculateEvaluationMetrics(runs: readonly EvaluationRunRecord[], passAtN = 3): EvaluationMetrics {
  const successful = runs.filter((run) => run.technicalSuccess);
  const repaired = runs.filter((run) => run.repairAttempts > 0);
  const repairSucceeded = repaired.filter((run) => run.technicalSuccess);
  const verificationFailures = runs.filter((run) => run.verificationPassed === false);
  const grouped = new Map<string, EvaluationRunRecord[]>();
  for (const run of runs) grouped.set(run.benchmarkTaskId, [...(grouped.get(run.benchmarkTaskId) ?? []), run]);
  const groups = [...grouped.values()];
  const passAt1Groups = groups.filter((group) => group[0]?.technicalSuccess).length;
  const passAtNGroups = groups.filter((group) => group.slice(0, passAtN).some((run) => run.technicalSuccess)).length;
  return {
    passAt1: rate(passAt1Groups, groups.length),
    passAtN: rate(passAtNGroups, groups.length),
    finalTaskSuccessRate: rate(successful.length, runs.length),
    repairRate: rate(repaired.length, runs.length),
    repairSuccessRate: rate(repairSucceeded.length, repaired.length),
    blockedRate: rate(runs.filter((run) => run.finalState === 'BLOCKED').length, runs.length),
    verificationFailureRate: rate(verificationFailures.length, runs.length),
    averageRepairAttempts: average(runs.map((run) => run.repairAttempts)),
    averageExecutionDurationMs: average(runs.map((run) => run.durationMs)),
    averageFilesChanged: average(runs.map((run) => run.filesChanged)),
    averageLinesChanged: average(runs.map((run) => run.linesAdded + run.linesRemoved)),
    regressionRate: rate(runs.filter((run) => run.verificationPassed === false && run.technicalSuccess).length, runs.length),
  };
}
