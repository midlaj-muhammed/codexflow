'use client';

import { FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

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
  approval?: Json;
  delivery: { commit?: Json; pushes: Json[]; pullRequests: Json[] };
};

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
  async function action(name: 'approve' | 'reject' | 'cancel' | 'execute') {
    try {
      const result = await request<{ task: TaskDetail }>(`/api/tasks/${String(task.id)}/${name}`, { method: 'POST' });
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
        <article className="panel"><h3>Pull request</h3>{pr ? <><p><span className={statusClass(pr.status)}>PR #{String(pr.number)}</span></p><p>{text(pr.title)}</p><a className="button secondary" href={String(pr.url)} target="_blank" rel="noreferrer">Open GitHub PR ↗</a></> : <Empty>No persisted pull request.</Empty>}</article>
        <article className="panel"><h3>Evaluation</h3><Empty>Technical evaluation is recorded separately from delivery success.</Empty></article>
      </div>
    </section>
  );
}

export function ControlPlane() {
  const [repositories, setRepositories] = useState<Json[]>([]);
  const [projects, setProjects] = useState<Json[]>([]);
  const [tasks, setTasks] = useState<Json[]>([]);
  const [detail, setDetail] = useState<TaskDetail>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');

  const refresh = useCallback(async () => {
    try {
      setError(undefined);
      const [repoResult, projectResult, taskResult] = await Promise.all([
        request<{ repositories: Json[] }>('/api/repositories'),
        request<{ projects: Json[] }>('/api/projects'),
        request<{ tasks: Json[] }>('/api/tasks'),
      ]);
      setRepositories(repoResult.repositories);
      setProjects(projectResult.projects);
      setTasks(taskResult.tasks);
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
  }, [detail?.task.id, detail?.task.status, refresh]);

  async function importRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await request('/api/repositories/import', { method: 'POST', body: JSON.stringify({ owner: form.get('owner'), name: form.get('name'), url: form.get('url'), defaultBranch: form.get('defaultBranch'), localPath: form.get('localPath') }) });
      event.currentTarget.reset(); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Import failed'); } finally { setBusy(false); }
  }
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await request<{ task: TaskDetail }>('/api/tasks', { method: 'POST', body: JSON.stringify({ projectId: form.get('projectId'), description: form.get('description') }) });
      setDetail(result.task); event.currentTarget.reset(); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Task creation failed'); } finally { setBusy(false); }
  }
  async function openTask(id: string) {
    try { setDetail((await request<{ task: TaskDetail }>(`/api/tasks/${id}`)).task); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load task'); }
  }
  const active = useMemo(() => tasks.filter((task) => !['APPLIED', 'REJECTED', 'CANCELLED', 'FAILED'].includes(String(task.status))).length, [tasks]);
  return <main className="shell">
    <header className="topbar"><a className="brand" href="#top">CODEX<span>FLOW</span></a><nav><a href="#projects">Projects</a><a href="#tasks">Tasks</a><a href="#delivery">Delivery</a></nav><button className="button secondary" onClick={() => void refresh()} disabled={busy}>Refresh</button></header>
    <section className="hero" id="top"><p className="eyebrow">DEVELOPER CONTROL PLANE</p><h1>Understand every agent change before it reaches GitHub.</h1><p>Live data is persisted by CodexFlow’s runtime. Approval, verification, and delivery remain backend-enforced.</p><div className="metrics"><div><strong>{repositories.length}</strong><span>repositories</span></div><div><strong>{projects.length}</strong><span>projects</span></div><div><strong>{active}</strong><span>active tasks</span></div></div></section>
    {error && <section className="notice" role="alert"><strong>Action blocked.</strong> {error}</section>}
    <section className="workflow" aria-label="CodexFlow workflow">{['Repository','Scan','Task','Agents','Review','Verify','Approve','Deliver','PR'].map((step) => <span key={step}>{step}</span>)}</section>
    <section className="split" id="projects"><article className="card"><h2>Import a local repository</h2><p className="subtle">Imports scan actual files and Git status. Credentials stay server-side.</p><form onSubmit={importRepository} className="form"><input name="owner" placeholder="GitHub owner" required /><input name="name" placeholder="Repository name" required /><input name="url" type="url" placeholder="https://github.com/owner/repository" required /><input name="defaultBranch" defaultValue="main" required /><input name="localPath" placeholder="Absolute local clone path" required /><button className="button" disabled={busy}>Import & scan</button></form></article><article className="card"><h2>Create task</h2><p className="subtle">Describe the work. The runtime owns agents, Git, risk, approval, and delivery.</p>{projects.length ? <form onSubmit={createTask} className="form"><select name="projectId" value={selectedProject || String(projects[0]?.id ?? '')} onChange={(event) => setSelectedProject(event.target.value)}>{projects.map((project) => <option key={String(project.id)} value={String(project.id)}>{String(project.name)}</option>)}</select><textarea name="description" placeholder="Describe the coding task" minLength={3} required /><button className="button" disabled={busy}>Create task</button></form> : <Empty>Import a local repository before creating a task.</Empty>}</article></section>
    <section className="card" id="projects"><h2>Projects & repository status</h2>{repositories.length ? <div className="table">{repositories.map((repo) => <div className="row" key={String(repo.id)}><div><strong>{String(repo.owner)}/{String(repo.name)}</strong><small>{String(repo.defaultBranch)} · {String((repo.git as Json | undefined)?.status ?? 'UNKNOWN')}</small></div><div>{projects.filter((project) => project.repositoryId === repo.id).map((project) => <span className="tag" key={String(project.id)}>{String(project.name)}</span>)}</div></div>)}</div> : <Empty>No repository has been imported.</Empty>}</section>
    <section className="card" id="tasks"><h2>Tasks</h2>{tasks.length ? <div className="table">{tasks.map((task) => <button className="row task-row" onClick={() => void openTask(String(task.id))} key={String(task.id)}><div><strong>{String(task.prompt)}</strong><small>{String(task.createdAt)}</small></div><span className={statusClass(task.deliveryStatus ?? task.status)}>{String(task.deliveryStatus ?? task.status)}</span></button>)}</div> : <Empty>No tasks yet. Create one to start a persisted lifecycle.</Empty>}</section>
  <div id="delivery">{detail ? <Detail detail={detail} onUpdate={(task) => { setDetail(task); void refresh(); }} onError={setError} /> : <section className="card"><h2>Agent run</h2><Empty>Select a task to inspect its plan, agents, verification, risk, approval, delivery, and evaluation records.</Empty></section>}</div>
  </main>;
}
