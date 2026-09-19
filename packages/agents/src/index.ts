import { readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
export type ProjectMetadata = {
  language: string[];
  framework?: string;
  packageManager?: string;
  testFramework?: string;
  buildCommand?: string;
  testCommand?: string;
  lintCommand?: string;
  sourceDirectories: string[];
  testDirectories: string[];
  configFiles: string[];
  readme?: string;
};
async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
export async function scanProject(root: string): Promise<ProjectMetadata> {
  const files = await readdir(root);
  const configFiles = files.filter((file) =>
    /^(package\.json|tsconfig\.json|vite\.config|next\.config|pyproject\.toml|Cargo\.toml|go\.mod|Dockerfile)/.test(
      file,
    ),
  );
  const packageJson = (await exists(join(root, 'package.json')))
    ? (JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
        packageManager?: string;
      })
    : undefined;
  const dependencies = { ...packageJson?.dependencies, ...packageJson?.devDependencies };
  const sourceDirectories = ['src', 'app', 'pages', 'lib'].filter((name) => files.includes(name));
  const testDirectories = ['test', 'tests', '__tests__', 'e2e'].filter((name) =>
    files.includes(name),
  );
  const language = [
    files.includes('tsconfig.json') ? 'TypeScript' : '',
    packageJson ? 'JavaScript' : '',
    files.includes('pyproject.toml') ? 'Python' : '',
    files.includes('go.mod') ? 'Go' : '',
    files.includes('Cargo.toml') ? 'Rust' : '',
  ].filter(Boolean);
  const framework = dependencies.next
    ? 'Next.js'
    : dependencies.vite
      ? 'Vite'
      : dependencies.react
        ? 'React'
        : undefined;
  const testFramework = dependencies.vitest
    ? 'Vitest'
    : dependencies['@playwright/test']
      ? 'Playwright'
      : dependencies.jest
        ? 'Jest'
        : undefined;
  const readme = files.find((file) => /^readme\.md$/i.test(file));
  return {
    language,
    framework,
    packageManager:
      packageJson?.packageManager?.split('@')[0] ??
      (files.includes('pnpm-lock.yaml')
        ? 'pnpm'
        : files.includes('package-lock.json')
          ? 'npm'
          : undefined),
    testFramework,
    buildCommand: packageJson?.scripts?.build,
    testCommand: packageJson?.scripts?.test,
    lintCommand: packageJson?.scripts?.lint,
    sourceDirectories,
    testDirectories,
    configFiles,
    readme,
  };
}
export type AgentRunInput = {
  runId: string;
  taskId: string;
  workspacePath: string;
  role: string;
  prompt: string;
};
export type AgentEvent = { type: 'progress' | 'completed' | 'failed'; message: string; at: string };
export type AgentRunResult = { runId: string; output: string; events: AgentEvent[] };
export interface AgentProvider {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  cancel(runId: string): Promise<void>;
  stream(runId: string): AsyncIterable<AgentEvent>;
}
export class MockAgentProvider implements AgentProvider {
  private readonly runs = new Map<string, AgentEvent[]>();
  async run(input: AgentRunInput) {
    const events: AgentEvent[] = [
      { type: 'progress', message: `${input.role} started`, at: new Date().toISOString() },
      { type: 'completed', message: `${input.role} completed`, at: new Date().toISOString() },
    ];
    this.runs.set(input.runId, events);
    return { runId: input.runId, output: `Mock ${input.role} output for ${input.taskId}`, events };
  }
  async cancel(runId: string) {
    this.runs.set(runId, [{ type: 'failed', message: 'Cancelled', at: new Date().toISOString() }]);
  }
  async *stream(runId: string) {
    for (const event of this.runs.get(runId) ?? []) yield event;
  }
}

export class AgentProviderError extends Error {
  constructor(
    public readonly code:
      'AUTH_FAILED' | 'UNAVAILABLE' | 'MALFORMED_RESPONSE' | 'CANCELLED' | 'TIMEOUT',
    message: string,
  ) {
    super(message);
  }
}
export class OpenAIResponsesProvider implements AgentProvider {
  private readonly events = new Map<string, AgentEvent[]>();
  constructor(
    private readonly apiKey: string,
    private readonly model = 'gpt-5',
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!apiKey.trim()) throw new AgentProviderError('AUTH_FAILED', 'OpenAI API key is required');
  }
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const started: AgentEvent = {
      type: 'progress',
      message: `${input.role} request started`,
      at: new Date().toISOString(),
    };
    this.events.set(input.runId, [started]);
    let response: Response;
    try {
      response = await this.fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: input.prompt, store: false }),
      });
    } catch {
      throw new AgentProviderError('UNAVAILABLE', 'OpenAI Responses API is unavailable');
    }
    if (!response.ok)
      throw new AgentProviderError(
        response.status === 401 ? 'AUTH_FAILED' : 'UNAVAILABLE',
        `OpenAI request failed (${response.status})`,
      );
    const body = (await response.json()) as { id?: string; output_text?: string };
    if (!body.id || typeof body.output_text !== 'string')
      throw new AgentProviderError(
        'MALFORMED_RESPONSE',
        'OpenAI response did not contain output text',
      );
    const completed: AgentEvent = {
      type: 'completed',
      message: `${input.role} completed`,
      at: new Date().toISOString(),
    };
    const events = [started, completed];
    this.events.set(input.runId, events);
    return { runId: input.runId, output: body.output_text, events };
  }
  async cancel(runId: string) {
    this.events.set(runId, [
      { type: 'failed', message: 'Cancelled', at: new Date().toISOString() },
    ]);
  }
  async *stream(runId: string) {
    for (const event of this.events.get(runId) ?? []) yield event;
  }
}
export type AgentRunPersistence = {
  createRun(input: {
    runId: string;
    taskId: string;
    role: string;
    attempt: number;
  }): Promise<void> | void;
  appendEvent(runId: string, event: AgentEvent): Promise<void> | void;
  finishRun(
    runId: string,
    status: 'COMPLETED' | 'FAILED' | 'CANCELLED',
    error?: string,
  ): Promise<void> | void;
};
export class AgentRunner {
  constructor(
    private readonly provider: AgentProvider,
    private readonly persistence?: AgentRunPersistence,
  ) {}
  async run(
    input: AgentRunInput & { attempt: number; timeoutMs?: number },
  ): Promise<AgentRunResult> {
    await this.persistence?.createRun({
      runId: input.runId,
      taskId: input.taskId,
      role: input.role,
      attempt: input.attempt,
    });
    const timeout = input.timeoutMs
      ? setTimeout(() => void this.provider.cancel(input.runId), input.timeoutMs)
      : undefined;
    try {
      const result = await this.provider.run(input);
      for (const event of result.events) await this.persistence?.appendEvent(input.runId, event);
      await this.persistence?.finishRun(input.runId, 'COMPLETED');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent execution failed';
      await this.persistence?.finishRun(input.runId, 'FAILED', message);
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  cancel(runId: string) {
    return this.provider.cancel(runId);
  }
  stream(runId: string) {
    return this.provider.stream(runId);
  }
}

export type VerificationPlan = { commands: string[]; requiresNewTests: boolean; rationale: string };
export type PlannerResult = {
  summary: string;
  affectedFiles: string[];
  riskSignals: string[];
  verification: VerificationPlan;
  existingTests: string[];
  testsToCreate: string[];
  expectedBehavior: string;
};
export class PlannerAgent {
  plan(input: { prompt: string; metadata: ProjectMetadata }): PlannerResult {
    const commands = [
      input.metadata.testCommand,
      input.metadata.lintCommand,
      input.metadata.buildCommand,
    ].filter((command): command is string => Boolean(command));
    return {
      summary: input.prompt,
      affectedFiles: [],
      riskSignals: [],
      verification: {
        commands,
        requiresNewTests: /fix|bug|regression/i.test(input.prompt),
        rationale: commands.length
          ? 'Run detected project verification commands.'
          : 'No supported verification command was detected.',
      },
      existingTests: input.metadata.testDirectories,
      testsToCreate: /fix|bug|regression/i.test(input.prompt)
        ? ['Regression coverage when the bug is reproducible.']
        : [],
      expectedBehavior: input.prompt,
    };
  }
}
export type ReviewFinding = { severity: 'LOW' | 'MEDIUM' | 'HIGH'; message: string; file?: string };
export class ReviewerAgent {
  review(input: { changedFiles: string[]; diff: string }): {
    verdict: 'APPROVED' | 'CHANGES_REQUESTED';
    findings: ReviewFinding[];
  } {
    const findings: ReviewFinding[] = [];
    if (/\.env|credentials|\.pem|\.key/i.test(`${input.changedFiles.join('\n')}\n${input.diff}`))
      findings.push({ severity: 'HIGH', message: 'Sensitive file appears in the diff.' });
    if (/package\.json|pnpm-lock\.yaml/i.test(input.changedFiles.join('\n')))
      findings.push({ severity: 'MEDIUM', message: 'Dependency changes require review.' });
    return {
      verdict: findings.some((finding) => finding.severity === 'HIGH')
        ? 'CHANGES_REQUESTED'
        : 'APPROVED',
      findings,
    };
  }
}
export type FileEdit = { path: string; content: string };
export class CoderAgent {
  async applyEdits(workspacePath: string, edits: FileEdit[]) {
    for (const edit of edits) {
      const target = resolve(workspacePath, edit.path);
      if (
        isAbsolute(edit.path) ||
        relative(workspacePath, target).startsWith('..') ||
        /(^|\/)\.(env|git)(\.|\/|$)|\.pem$|\.key$/i.test(edit.path)
      )
        throw new Error(`Edit denied by workspace policy: ${edit.path}`);
      await writeFile(target, edit.content, 'utf8');
    }
    return { changedFiles: edits.map((edit) => edit.path) };
  }
  async applyModelOutput(workspacePath: string, output: string) {
    const payload = z
      .object({ edits: z.array(z.object({ path: z.string().min(1), content: z.string() })).min(1) })
      .parse(JSON.parse(output));
    return this.applyEdits(workspacePath, payload.edits);
  }
}
export class RepairAgent extends CoderAgent {}
export class SupervisorAgent {
  constructor(private readonly maxRepairs = 2) {}
  nextAfterVerification(
    attempt: number,
    passed: boolean,
  ): 'READY_FOR_APPROVAL' | 'REPAIRING' | 'BLOCKED' {
    if (passed) return 'READY_FOR_APPROVAL';
    return attempt < this.maxRepairs ? 'REPAIRING' : 'BLOCKED';
  }
}
export class CoreAgentPipeline {
  constructor(
    private readonly planner = new PlannerAgent(),
    private readonly coder = new CoderAgent(),
    private readonly reviewer = new ReviewerAgent(),
    private readonly tester = new TesterAgent(),
    private readonly supervisor = new SupervisorAgent(),
  ) {}
  async run(input: {
    prompt: string;
    metadata: ProjectMetadata;
    workspacePath: string;
    modelOutput: string;
    diff: string;
    changedFiles: string[];
    attempt?: number;
  }) {
    const plan = this.planner.plan({ prompt: input.prompt, metadata: input.metadata });
    const code = await this.coder.applyModelOutput(input.workspacePath, input.modelOutput);
    const review = this.reviewer.review({
      changedFiles: input.changedFiles.length ? input.changedFiles : code.changedFiles,
      diff: input.diff,
    });
    const tests = await this.tester.verify(input.workspacePath, plan.verification);
    const passed = review.verdict === 'APPROVED' && tests.every((test) => test.status === 'PASSED');
    return {
      plan,
      code,
      review,
      tests,
      next: this.supervisor.nextAfterVerification(input.attempt ?? 1, passed),
    };
  }
}
export class VerificationRepairLoop {
  constructor(
    private readonly tester: TesterAgent,
    private readonly maxRepairs = 2,
  ) {}
  async run(input: {
    workspacePath: string;
    plan: VerificationPlan;
    repair: (attempt: number) => Promise<void>;
  }) {
    let tests = await this.tester.verify(input.workspacePath, input.plan);
    for (
      let attempt = 1;
      !tests.every((test) => test.status === 'PASSED') && attempt <= this.maxRepairs;
      attempt += 1
    ) {
      await input.repair(attempt);
      tests = await this.tester.verify(input.workspacePath, input.plan);
      if (tests.every((test) => test.status === 'PASSED'))
        return { status: 'PASSED' as const, tests, repairs: attempt };
    }
    return {
      status: tests.every((test) => test.status === 'PASSED')
        ? ('PASSED' as const)
        : ('BLOCKED' as const),
      tests,
      repairs: this.maxRepairs,
    };
  }
}
export type TestExecution = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  status: 'PASSED' | 'FAILED';
};
const runProcess = promisify(execFile);
const prohibited =
  /(^|\s)(sudo|rm\s+-rf|git\s+reset\s+--hard|git\s+clean\s+-fd|curl|wget|npm\s+install|pnpm\s+add)(\s|$)|[;&|`]/;
export class TesterAgent {
  async verify(workspacePath: string, plan: VerificationPlan): Promise<TestExecution[]> {
    return Promise.all(plan.commands.map((command) => this.execute(workspacePath, command)));
  }
  private async execute(cwd: string, command: string): Promise<TestExecution> {
    if (prohibited.test(command)) throw new Error(`Command denied by policy: ${command}`);
    const started = Date.now();
    try {
      const { stdout, stderr } = await runProcess('sh', ['-lc', command], {
        cwd,
        maxBuffer: 10_000_000,
      });
      return {
        command,
        exitCode: 0,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        status: 'PASSED',
      };
    } catch (error) {
      const result = error as { code?: number; stdout?: string; stderr?: string };
      return {
        command,
        exitCode: typeof result.code === 'number' ? result.code : null,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        durationMs: Date.now() - started,
        status: 'FAILED',
      };
    }
  }
}
