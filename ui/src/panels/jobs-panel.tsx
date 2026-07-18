import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/tauri.ts";
import { selectActiveSession, useSessionStore } from "../session/session-store.ts";
import type { JobCard, PersistentAgent } from "../session/types.ts";
import { EmptyState } from "./empty-state.tsx";

const projectKeyFromCwd = (cwd: string) => cwd.replaceAll("\\", "/");

export const JobsPanel = () => {
  const session = useSessionStore(selectActiveSession);
  const [jobs, setJobs] = useState<JobCard[]>([]);
  const [agents, setAgents] = useState<PersistentAgent[]>([]);
  const [scope, setScope] = useState<"project" | "all">("project");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [role, setRole] = useState("default");

  const projectKey = session ? projectKeyFromCwd(session.cwd) : null;
  const projectLabel = session
    ? session.cwd.split(/[\\/]/).filter(Boolean).at(-1) || session.title
    : "project";

  const reload = async () => {
    const key = scope === "project" ? projectKey : null;
    const [nextJobs, nextAgents] = await Promise.all([
      api.listJobs(key),
      api.listAgents(key),
    ]);
    setJobs(nextJobs);
    setAgents(nextAgents);
  };

  useEffect(() => {
    void reload().catch(console.warn);
    const timer = window.setInterval(() => void reload().catch(() => undefined), 8000);
    return () => window.clearInterval(timer);
  }, [projectKey, scope]);

  const grouped = useMemo(() => {
    const map = new Map<string, JobCard[]>();
    for (const job of jobs) {
      const list = map.get(job.projectLabel) ?? [];
      list.push(job);
      map.set(job.projectLabel, list);
    }
    return [...map.entries()];
  }, [jobs]);

  return (
    <div className="jobs-panel">
      <div className="memory-panel__toolbar">
        <label>
          Scope
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "project" | "all")}
          >
            <option value="project">This project</option>
            <option value="all">All projects</option>
          </select>
        </label>
        <button type="button" onClick={() => void reload()}>
          Refresh
        </button>
      </div>

      <section className="jobs-panel__agents">
        <h3>Persistent agents</h3>
        {agents.length === 0 ? (
          <EmptyState>No agents yet. Open a session to create one.</EmptyState>
        ) : (
          <div className="jobs-agent-list">
            {agents.map((agent) => (
              <article key={agent.id} className="jobs-agent-card">
                <strong>{agent.displayName}</strong>
                <span className={`job-status job-status--${agent.status}`}>
                  {agent.status}
                </span>
                <p>{agent.currentJob || "Idle"}</p>
                <footer>
                  {agent.role} · {agent.projectKey}
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      <form
        className="memory-panel__compose"
        onSubmit={(event) => {
          event.preventDefault();
          if (!projectKey || !title.trim()) return;
          const id = `job:manual:${Date.now()}`;
          void api
            .upsertJob({
              id,
              projectKey,
              projectLabel,
              title: title.trim(),
              detail: detail.trim(),
              status: "queued",
              assigneeRole: role,
              sessionId: session?.id ?? null,
            })
            .then(() => {
              setTitle("");
              setDetail("");
              return reload();
            });
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New job title"
          disabled={!projectKey}
        />
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Details / acceptance notes"
          rows={3}
          disabled={!projectKey}
        />
        <label>
          Assign role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {["default", "smol", "slow", "plan", "task", "advisor"].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={!projectKey || !title.trim()}>
          Add job
        </button>
      </form>

      <div className="jobs-board">
        {grouped.length === 0 ? (
          <EmptyState>No jobs yet.</EmptyState>
        ) : (
          grouped.map(([label, projectJobs]) => (
            <section key={label} className="jobs-board__project">
              <header>{label}</header>
              {projectJobs.map((job) => (
                <article key={job.id} className="job-card">
                  <div className="job-card__top">
                    <strong>{job.title}</strong>
                    <select
                      value={job.status}
                      onChange={(e) =>
                        void api
                          .upsertJob({
                            id: job.id,
                            projectKey: job.projectKey,
                            projectLabel: job.projectLabel,
                            title: job.title,
                            detail: job.detail,
                            status: e.target.value,
                            assigneeAgentId: job.assigneeAgentId,
                            assigneeRole: job.assigneeRole,
                            sessionId: job.sessionId,
                          })
                          .then(() => reload())
                      }
                    >
                      {["queued", "running", "blocked", "done"].map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                  {job.detail ? <p>{job.detail}</p> : null}
                  <footer>
                    {job.assigneeRole || "unassigned"}
                    {job.sessionId ? ` · session ${job.sessionId.slice(0, 8)}` : ""}
                  </footer>
                </article>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
};
