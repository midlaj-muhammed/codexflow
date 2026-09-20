'use client';

import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LocalFolderPicker } from './local-folder-picker';

type Json = Record<string, unknown>;
type TaskDetail = {
  task: Json;
  project?: Json;
  repository?: Json;
  workspace?: Json;
  agents: Json[];
  agentEvents: Json[];
  plans: Json[];
  reviews: Json[];
  tests: Json[];
  evaluations: Json[];
  approval?: Json;
  delivery: { commit?: Json; pushes: Json[]; pullRequests: Json[] };
};
type EvaluationSummary = { benchmarks: Array<Json & { taskCount: number }>; runs: Json[]; metrics: Json };
type Operations = { tasks: { total: number; failed: number; byState: Json }; agents: { total: number; failed: number }; execution: { activeLeases: number; reclaimedStaleLeases: number } };
type GitHubConnection = { connected: boolean; login?: string };

const statusClass = (value: unknown) => `status status-${String(value ?? 'UNKNOWN').toLowerCase()}`;
const text = (value: unknown, fallback = 'Not available') =>
  typeof value === 'string' && value.length ? value : fallback;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? 'Request failed');
  return body;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

function Detail({ detail, onUpdate, onError }: { detail: TaskDetail; onUpdate: (task: TaskDetail) => void; onError: (error: string) => void }) {
  const task = detail.task;
  const delivery = detail.delivery;
  const metadata = (detail.project?.metadata ?? {}) as Json;
  const risk = (detail.approval?.risk ?? {}) as Json;
  const risks = Array.isArray(detail.approval?.risk && (detail.approval.risk as Json).reasons)
    ? ((detail.approval?.risk as Json).reasons as unknown[])
    : [];
  const pr = delivery.pullRequests.find((entry) => entry.status === 'SUCCEEDED');
  const coderEvent = detail.agentEvents.find((event) => event.type === 'agent.completed' && (event.payload as Json | undefined)?.stage === 'CODER');
  async function action(name: 'approve' | 'reject' | 'cancel' | 'execute' | 'refresh-pr') {
    try {
      const suffix = name === 'refresh-pr' ? 'pull-request/refresh' : name;
      const result = await request<{ task: TaskDetail }>(`/api/tasks/${String(task.id)}/${suffix}`, { method: 'POST' });
      if (result.task) onUpdate(result.task);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'Task action failed');
    }
  }
  return (
    <section className="task-detail" aria-label="Task detail">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">TASK</p>
          <h2>{text(task.prompt)}</h2>
          <p className="subtle">{text(detail.repository?.owner)}/{text(detail.repository?.name)}</p>
        </div>
        <span className={statusClass(task.deliveryStatus ?? task.status)}>{String(task.deliveryStatus ?? task.status)}</span>
      </div>
      <div className="detail-grid">
        <article className="panel"><h3>Plan & scan</h3><p>{text(metadata.framework, 'No framework detected')} · {text(metadata.packageManager, 'No package manager detected')}</p><p className="subtle">Verification: {text(metadata.testCommand, 'No detected test command')}</p>{detail.plans.length ? <p>{text(detail.plans[0].content)}</p> : <p className="subtle">No persisted Planner output.</p>}{['CREATED', 'QUEUED'].includes(String(task.status)) ? <button className="button" onClick={() => void action('execute')}>Start task</button> : null}</article>
        <article className="panel"><h3>Workspace</h3><p>Branch: <code>{text(detail.workspace?.branch)}</code></p><p className="subtle">{text(detail.workspace?.rootPath)}</p><p>Baseline: <code>{text(detail.workspace?.baselineCommit)}</code></p></article>
        <article className="panel"><h3>Risk & approval</h3><p><span className={statusClass(risk.level)}> {String(risk.level ?? 'PENDING')}</span> <strong>{String(risk.score ?? '—')}</strong></p><ul>{risks.length ? risks.map((reason) => <li key={String(reason)}>{String(reason)}</li>) : <li>No persisted risk result.</li>}</ul><p className="subtle">Approval: {text(detail.approval?.state, 'Not requested')}</p>{detail.approval?.state === 'PENDING' && task.status === 'READY_FOR_APPROVAL' ? <div className="actions"><button className="button" onClick={() => void action('approve')}>Approve</button><button className="button secondary" onClick={() => void action('reject')}>Reject</button></div> : null}{!['APPLIED','REJECTED','CANCELLED','FAILED','BLOCKED'].includes(String(task.status)) ? <button className="link-button" onClick={() => void action('cancel')}>Cancel task</button> : null}</article>
        <article className="panel"><h3>Verification</h3>{detail.tests.length ? <ul className="runs">{detail.tests.map((run) => <li key={String(run.id)}><span className={statusClass(run.status)}>{String(run.status)}</span><code>{String(run.command)}</code><small>exit {String(run.exitCode ?? '—')} · {String(run.durationMs ?? 0)}ms</small></li>)}</ul> : <Empty>No verification command has executed.</Empty>}</article>
        <article className="panel"><h3>Agent timeline</h3>{detail.agents.length ? <ol className="timeline">{detail.agents.map((agent) => <li key={String(agent.id)}><strong>{String(agent.role)}</strong><span>{String(agent.status)} · attempt {String(agent.attempt)}</span></li>)}</ol> : <Empty>No persisted agent events yet.</Empty>}</article>
        <article className="panel"><h3>Review & changes</h3>{detail.reviews.length ? <ul>{((detail.reviews[0].findings as unknown[]) ?? []).map((finding) => <li key={JSON.stringify(finding)}>{JSON.stringify(finding)}</li>)}</ul> : <Empty>No persisted reviewer findings.</Empty>}{coderEvent ? <p className="subtle">Changed: {Array.isArray((coderEvent.payload as Json).changedFiles) ? ((coderEvent.payload as Json).changedFiles as unknown[]).join(', ') : 'recorded by runtime'}</p> : null}<p className="subtle">Proposed changes remain separate from committed delivery.</p></article>
        <article className="panel delivery"><h3>Delivery</h3>{delivery.commit ? <><p>Commit <code>{text(delivery.commit.sha)}</code></p><p>Branch <code>{text(delivery.commit.branch)}</code></p><ul className="runs">{delivery.pushes.map((push) => <li key={String(push.id)}><span className={statusClass(push.status)}>{String(push.status)}</span> Push attempt {String(push.attempt)}<small>{text(push.error, '')}</small></li>)}</ul></> : <Empty>Approval and final verification are required before delivery.</Empty>}</article>
        <article className="panel"><h3>Pull request</h3>{pr ? <><p><span className={statusClass(pr.remoteStatus ?? pr.status)}>PR #{String(pr.number)} · {String(pr.remoteStatus ?? 'UNREFRESHED')}</span></p><p>{text(pr.title)}</p><p className="subtle">Head: <code>{text(pr.headSha, 'Refresh to validate')}</code></p><div className="actions"><button className="button secondary" onClick={() => void action('refresh-pr')}>Refresh GitHub status</button><a className="button secondary" href={String(pr.url)} target="_blank" rel="noreferrer">Open GitHub PR ↗</a></div></> : <Empty>No persisted pull request.</Empty>}</article>
        <article className="panel"><h3>Evaluation</h3>{detail.evaluations.length ? <ul className="runs">{detail.evaluations.map((run) => <li key={String(run.id)}><span className={statusClass(run.technicalSuccess ? 'PASSED' : 'FAILED')}>{run.technicalSuccess ? 'TECHNICAL PASS' : 'TECHNICAL FAIL'}</span><small>{String(run.finalState)} · {String(run.durationMs)}ms · repairs {String(run.repairAttempts)}</small></li>)}</ul> : <Empty>Technical evaluation is recorded separately from delivery success.</Empty>}</article>
      </div>
    </section>
  );
}

export function ControlPlane() {
  const [repositories, setRepositories] = useState<Json[]>([]);
  const [projects, setProjects] = useState<Json[]>([]);
  const [tasks, setTasks] = useState<Json[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationSummary>();
  const [operations, setOperations] = useState<Operations>();
  const [detail, setDetail] = useState<TaskDetail>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [github, setGithub] = useState<GitHubConnection>({ connected: false });
  const [githubRepositories, setGithubRepositories] = useState<Json[]>([]);
  const [selectedGitHubRepository, setSelectedGitHubRepository] = useState<Json>();
  const [health, setHealth] = useState<Json>();

  const refresh = useCallback(async () => {
    try {
      setError(undefined);
      const [repoResult, projectResult, taskResult, evaluationResult, operationsResult, githubResult] = await Promise.all([
        request<{ repositories: Json[] }>('/api/repositories'),
        request<{ projects: Json[] }>('/api/projects'),
        request<{ tasks: Json[] }>('/api/tasks'),
        request<EvaluationSummary>('/api/evaluations'),
        request<{ operations: Operations }>('/api/operations'),
        request<{ github: GitHubConnection }>('/api/github/status'),
      ]);
      setRepositories(repoResult.repositories);
      setProjects(projectResult.projects);
      setTasks(taskResult.tasks);
      setEvaluation(evaluationResult);
      setOperations(operationsResult.operations);
      setGithub(githubResult.github);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load control-plane data'); }
  }, []);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [refresh]);
  useEffect(() => {
    const status = String(detail?.task.status ?? '');
    if (!detail || ['READY_FOR_APPROVAL', 'APPROVED', 'APPLIED', 'REJECTED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(status)) return;
    const timer = window.setInterval(() => {
      void openTask(String(detail.task.id));
      void refresh();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [detail, refresh]);

  async function importRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(undefined);
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      const result = await request<{ project: Json }>('/api/repositories/import', { method: 'POST', body: JSON.stringify({ localPath: form.get('localPath') }) });
      setSelectedProject(String(result.project.id));
      target.reset(); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Import failed'); } finally { setBusy(false); }
  }
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(undefined);
    const target = event.currentTarget;
    const form = new FormData(target);
    try {
      const result = await request<{ task: TaskDetail }>('/api/tasks', { method: 'POST', body: JSON.stringify({ projectId: form.get('projectId'), description: form.get('description') }) });
      setDetail(result.task); target.reset(); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Task creation failed'); } finally { setBusy(false); }
  }
  async function loadGitHubRepositories() {
    try {
      setBusy(true); setError(undefined);
      const result = await request<{ repositories: Json[] }>('/api/github/repositories');
      setGithubRepositories(result.repositories);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'GitHub repositories could not be loaded'); } finally { setBusy(false); }
  }
  async function importSelectedGitHubRepository() {
    if (!selectedGitHubRepository) return;
    try {
      setBusy(true); setError(undefined);
      const result = await request<{ project: Json }>('/api/github/import', { method: 'POST', body: JSON.stringify({ owner: selectedGitHubRepository.owner, name: selectedGitHubRepository.name }) });
      setSelectedProject(String(result.project.id)); setSelectedGitHubRepository(undefined); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Repository import failed'); } finally { setBusy(false); }
  }
  async function runHealth(projectId: string) {
    try { setBusy(true); setError(undefined); setHealth((await request<{ health: Json }>(`/api/projects/${projectId}/health`, { method: 'POST' })).health); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Project health inspection failed'); } finally { setBusy(false); }
  }
  async function publishProject(projectId: string, projectName: string) {
    const name = window.prompt('GitHub repository name', projectName);
    if (!name) return;
    try { setBusy(true); setError(undefined); await request(`/api/projects/${projectId}/publish`, { method: 'POST', body: JSON.stringify({ name, private: true }) }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Project publication failed'); } finally { setBusy(false); }
  }
  async function openTask(id: string) {
    try { setDetail((await request<{ task: TaskDetail }>(`/api/tasks/${id}`)).task); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load task'); }
  }
  const active = useMemo(() => tasks.filter((task) => !['APPLIED', 'REJECTED', 'CANCELLED', 'FAILED'].includes(String(task.status))).length, [tasks]);
  return <main className="shell">
    <header className="topbar"><Link className="brand" href="/">CODEX<span>FLOW</span></Link><nav><a href="#projects">Projects</a><a href="#tasks">Tasks</a><a href="#evaluation">Evaluations</a><a href="#operations">Operations</a></nav><div className="account-status">{github.connected ? <>GitHub <strong>@{github.login}</strong> <span className="status status-passed">CONNECTED</span></> : <span className="subtle">GitHub not connected</span>}</div><button className="button secondary" onClick={() => void refresh()} disabled={busy}>Refresh</button></header>
    <section className="hero" id="top"><p className="eyebrow">DEVELOPER CONTROL PLANE</p><h1>Take a verified change from task to GitHub.</h1><p>Select a project, describe the outcome you want, then inspect every persisted plan, agent result, review, test, risk, and delivery checkpoint.</p><div className="actions"><a className="button" href="#new-task">New task</a><a className="button secondary" href="#local-project">Import project</a>{github.connected ? <button className="button secondary" onClick={() => void loadGitHubRepositories()} disabled={busy}>Browse GitHub</button> : null}</div><div className="metrics"><div><strong>{repositories.length}</strong><span>repositories</span></div><div><strong>{projects.length}</strong><span>projects</span></div><div><strong>{active}</strong><span>active tasks</span></div></div></section>
    {error && <section className="notice" role="alert"><strong>Action blocked.</strong> {error}</section>}
    <section className="workflow" aria-label="CodexFlow workflow">{['Repository','Scan','Task','Agents','Review','Verify','Approve','Deliver','PR'].map((step) => <span key={step}>{step}</span>)}</section>
    <section className="split" id="projects"><article className="card" id="local-project"><p className="eyebrow">LOCAL PROJECT</p><h2>Open a project from this computer</h2><p className="subtle">Selected source files are copied into a CodexFlow-managed project workspace. Agents still receive separate task worktrees; your original folder is never modified.</p><LocalFolderPicker onImported={(projectId, summary) => { setSelectedProject(projectId); setError(undefined); void refresh(); setHealth({ importSummary: summary }); }} /><details><summary>Advanced: server-accessible Git checkout</summary><form onSubmit={importRepository} className="form"><label htmlFor="local-path">Server path</label><input id="local-path" name="localPath" placeholder="/absolute/path/to/project" required /><button className="button secondary" disabled={busy}>Import existing checkout</button></form></details></article><article className="card" id="new-task"><p className="eyebrow">NEW TASK</p><h2>What do you want CodexFlow to change?</h2><p className="subtle">The exact task text is persisted and becomes the runtime prompt.</p>{projects.length ? <form onSubmit={createTask} className="form"><label htmlFor="project">Project</label><select id="project" name="projectId" value={selectedProject || String(projects[0]?.id ?? '')} onChange={(event) => setSelectedProject(event.target.value)}>{projects.map((project) => <option key={String(project.id)} value={String(project.id)}>{String(project.name)}</option>)}</select><label htmlFor="task-prompt">Task</label><textarea id="task-prompt" name="description" placeholder="Fix the failing authentication tests and handle expired sessions correctly." minLength={3} maxLength={10_000} required /><button className="button" disabled={busy}>Start task</button></form> : <Empty>Open a local project or connect GitHub before creating a task.</Empty>}</article></section>
    {github.connected ? <section className="card"><p className="eyebrow">GITHUB</p><h2>Connect a repository</h2><p className="subtle">Connected as @{github.login}. Repository identity is read from GitHub and cloned into a CodexFlow-managed source workspace; credentials never reach this browser.</p><button className="button secondary" onClick={() => void loadGitHubRepositories()} disabled={busy}>Load repositories</button>{githubRepositories.length ? <div className="table">{githubRepositories.map((repo) => <button className="row task-row" type="button" key={String(repo.id)} onClick={() => setSelectedGitHubRepository(repo)}><div><strong>{String(repo.owner)}/{String(repo.name)}</strong><small>{String(repo.private) === 'true' ? 'Private' : 'Public'} · {String(repo.defaultBranch)}</small></div><span className="tag">Select</span></button>)}</div> : null}{selectedGitHubRepository ? <div className="form"><h3>Scan {String(selectedGitHubRepository.owner)}/{String(selectedGitHubRepository.name)}</h3><p className="subtle">CodexFlow will create a managed clone and scan its actual contents.</p><button className="button" type="button" onClick={() => void importSelectedGitHubRepository()} disabled={busy}>Clone & scan repository</button></div> : null}</section> : <section className="card"><h2>Connect GitHub</h2><p className="subtle">Authenticate with your GitHub account to browse repositories. Access tokens remain in an encrypted server-side session.</p><a className="button" href="/auth/github">Continue with GitHub</a></section>}
    <section className="card" id="projects"><p className="eyebrow">PROJECTS</p><h2>Project health and repository status</h2>{repositories.length ? <div className="table">{repositories.map((repo) => <div className="row" key={String(repo.id)}><div><strong>{String(repo.owner)}/{String(repo.name)}</strong><small>{String(repo.defaultBranch)} · {String((repo.git as Json | undefined)?.status ?? 'UNKNOWN')} · {String((repo.git as Json | undefined)?.branch ?? 'unknown branch')}</small></div><div className="row-actions">{projects.filter((project) => project.repositoryId === repo.id).map((project) => <span className="tag" key={String(project.id)}>{String(project.name)} <button type="button" onClick={() => void runHealth(String(project.id))}>Run checks</button><button type="button" onClick={() => void publishProject(String(project.id), String(project.name))} disabled={!github.connected || String(repo.owner) !== 'local'}>{String(repo.owner) === 'local' ? 'Publish to GitHub' : 'Connected'}</button></span>)}</div></div>)}</div> : <Empty>No project has been imported.</Empty>}{health ? <article className="panel health"><h3>Project health</h3><p>{String((health.git as Json | undefined)?.dirty) === 'true' ? 'Working tree has changes' : 'Git working tree is clean'}</p><p className="subtle">Detected: {Array.isArray((health.metadata as Json | undefined)?.language) ? ((health.metadata as Json).language as unknown[]).join(', ') : 'No language metadata'} · {text((health.metadata as Json | undefined)?.framework)}</p>{Array.isArray(health.results) && health.results.length ? <ul className="runs">{(health.results as Json[]).map((result) => <li key={String(result.command)}><span className={statusClass(result.status)}>{String(result.status)}</span><code>{String(result.command)}</code><small>exit {String(result.exitCode ?? '—')} · {String(result.durationMs)}ms</small>{result.stderr ? <small>{String(result.stderr).slice(0, 500)}</small> : null}</li>)}</ul> : <Empty>No safe lint, test, or build command was detected. Inspect the project configuration before creating a task.</Empty>}</article> : null}</section>
    <section className="card" id="tasks"><h2>Tasks</h2>{tasks.length ? <div className="table">{tasks.map((task) => <button className="row task-row" onClick={() => void openTask(String(task.id))} key={String(task.id)}><div><strong>{String(task.prompt)}</strong><small>{String(task.createdAt)}</small></div><span className={statusClass(task.deliveryStatus ?? task.status)}>{String(task.deliveryStatus ?? task.status)}</span></button>)}</div> : <Empty>No tasks yet. Create one to start a persisted lifecycle.</Empty>}</section>
    <section className="card" id="evaluation"><h2>Evaluation benchmarks</h2>{evaluation ? <><p className="subtle">{evaluation.benchmarks.reduce((count, benchmark) => count + Number(benchmark.taskCount), 0)} controlled tasks · {evaluation.runs.length} persisted runs</p><div className="metrics"><div><strong>{String(evaluation.metrics.finalTaskSuccessRate ?? '—')}</strong><span>technical success</span></div><div><strong>{String(evaluation.metrics.repairRate ?? '—')}</strong><span>repair rate</span></div><div><strong>{String(evaluation.metrics.blockedRate ?? '—')}</strong><span>blocked rate</span></div></div><ul className="runs">{evaluation.benchmarks.map((benchmark) => <li key={String(benchmark.id)}><strong>{String(benchmark.name)}</strong><small>v{String(benchmark.version)} · {String(benchmark.taskCount)} tasks</small></li>)}</ul></> : <Empty>Loading persisted benchmark records.</Empty>}</section>
    <section className="card" id="operations"><h2>Operations</h2>{operations ? <div className="metrics"><div><strong>{operations.tasks.total}</strong><span>persisted tasks</span></div><div><strong>{operations.agents.failed}</strong><span>agent failures</span></div><div><strong>{operations.execution.activeLeases}</strong><span>active leases</span></div><div><strong>{operations.tasks.failed}</strong><span>blocked/failed tasks</span></div></div> : <Empty>Loading persisted operational state.</Empty>}</section>
  <div id="delivery">{detail ? <Detail detail={detail} onUpdate={(task) => { setDetail(task); void refresh(); }} onError={setError} /> : <section className="card"><h2>Agent run</h2><Empty>Select a task to inspect its plan, agents, verification, risk, approval, delivery, and evaluation records.</Empty></section>}</div>
  </main>;
}
