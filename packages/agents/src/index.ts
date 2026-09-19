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
