import { useEffect, useMemo, useState } from "react";

import {
  LAUNCH_RECIPES,
  selectActiveSession,
  useSessionStore,
} from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";

export const LaunchPanel = () => {
  const session = useSessionStore(selectActiveSession);
  const skills = useSessionStore((state) => state.skills);
  const skillsLoaded = useSessionStore((state) => state.skillsLoaded);
  const loadSkills = useSessionStore((state) => state.loadSkills);
  const launchRecipe = useSessionStore((state) => state.launchRecipe);
  const launchSkill = useSessionStore((state) => state.launchSkill);
  const [topic, setTopic] = useState("the current product experience");
  const [target, setTarget] = useState("the active UI surface");
  const [url, setUrl] = useState("http://localhost:5173");
  const [skillArgs, setSkillArgs] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!skillsLoaded) void loadSkills();
  }, [skillsLoaded, loadSkills]);

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((skill) =>
      `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(q),
    );
  }, [skills, query]);

  if (!session) {
    return <EmptyState>Open a session to launch workflows and skills in-GUI.</EmptyState>;
  }

  const run = async (id: string, fn: () => Promise<boolean>) => {
    setBusy(id);
    setError(null);
    try {
      const ok = await fn();
      if (!ok) setError("Could not launch — is the session ready?");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="launch-panel">
      <section className="launch-panel__vars">
        <h3>Inputs</h3>
        <label className="onboard-field">
          <span>Topic</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} />
        </label>
        <label className="onboard-field">
          <span>Target</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="onboard-field">
          <span>URL</span>
          <input value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
        </label>
      </section>

      <section>
        <h3>Recipes</h3>
        <div className="launch-grid">
          {LAUNCH_RECIPES.map((recipe) => (
            <article key={recipe.id} className="launch-card">
              <header>
                <strong>{recipe.label}</strong>
                <span>{recipe.group}</span>
              </header>
              <p>{recipe.detail}</p>
              <button
                type="button"
                className="panel-button panel-button--primary"
                disabled={busy !== null}
                onClick={() =>
                  void run(recipe.id, () =>
                    launchRecipe(recipe, { topic, target, url }),
                  )
                }
              >
                {busy === recipe.id ? "Launching…" : "Launch"}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="ssh-modal__section-head">
          <h3>Skills</h3>
          <button
            type="button"
            className="panel-button"
            onClick={() => void loadSkills()}
            disabled={busy !== null}
          >
            Refresh
          </button>
        </div>
        <label className="onboard-field">
          <span>Filter skills</span>
          <input
            value={query}
            placeholder="brainstorm, impeccable, …"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="onboard-field">
          <span>Skill args</span>
          <input
            value={skillArgs}
            placeholder="optional instruction for the skill"
            onChange={(e) => setSkillArgs(e.target.value)}
          />
        </label>
        {!skillsLoaded ? (
          <p className="onboard-muted">Loading skills…</p>
        ) : filteredSkills.length === 0 ? (
          <EmptyState>No skills discovered in ~/.omp/agent/skills or ~/.agents/skills.</EmptyState>
        ) : (
          <div className="launch-skill-list">
            {filteredSkills.map((skill) => (
              <article key={`${skill.source}:${skill.name}`} className="launch-skill">
                <div>
                  <strong>{skill.name}</strong>
                  <span>{skill.source}</span>
                  <p>{skill.description || "No description"}</p>
                </div>
                <button
                  type="button"
                  className="panel-button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(skill.name, () => launchSkill(skill.name, skillArgs))
                  }
                >
                  {busy === skill.name ? "…" : "Run"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {error ? <p className="panel-feedback panel-feedback--error">{error}</p> : null}
    </div>
  );
};
