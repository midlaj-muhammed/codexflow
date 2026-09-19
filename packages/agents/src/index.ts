import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
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
