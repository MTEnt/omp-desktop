import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/tauri.ts";
import {
  projectKeyForSession,
  selectActiveSession,
  useSessionStore,
} from "../session/session-store.ts";
import type { RoleMemoryNote } from "../session/types.ts";
import { EmptyState } from "./empty-state.tsx";


export const MemoryPanel = () => {
  const session = useSessionStore(selectActiveSession);
  const modelRoles = useSessionStore((state) => state.modelRoles);
  const [role, setRole] = useState("default");
  const [notes, setNotes] = useState<RoleMemoryNote[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);

  const roles = useMemo(() => {
    const set = new Set(modelRoles.map((item) => item.role));
    set.add("default");
    set.add("smol");
    set.add("slow");
    set.add("plan");
    return [...set];
  }, [modelRoles]);

  const projectKey = session ? projectKeyForSession(session) : null;
  const queryKey = `${role}\u0000${projectKey ?? ""}`;
  const activeQueryKey = useRef(queryKey);
  activeQueryKey.current = queryKey;

  const reload = useCallback(async () => {
    if (!projectKey) return;
    const request = ++requestGeneration.current;
    const requestedQuery = queryKey;
    const next = await api.listRoleNotes(role, projectKey);
    if (
      request === requestGeneration.current &&
      requestedQuery === activeQueryKey.current
    ) {
      setNotes(next);
    }
  }, [projectKey, queryKey, role]);

  useEffect(() => {
    if (!projectKey) {
      setNotes([]);
      return;
    }
    void reload().catch(console.warn);
    return () => {
      requestGeneration.current += 1;
    };
  }, [projectKey, reload]);

  if (!session || !projectKey) {
    return <EmptyState>Open a session to view per-role memory.</EmptyState>;
  }

  return (
    <div className="memory-panel">
      <div className="memory-panel__toolbar">
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void reload()}>
          Refresh
        </button>
      </div>

      <form
        className="memory-panel__compose"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim() || !body.trim()) return;
          setBusy(true);
          void api
            .addRoleNote({
              role,
              projectKey,
              kind: "interaction",
              title: title.trim(),
              body: body.trim(),
              sourceSessionId: session.id,
            })
            .then(() => {
              setTitle("");
              setBody("");
              return reload();
            })
            .finally(() => setBusy(false));
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Memory title (decision, feedback, pitfall…)"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What should this role remember for next time?"
          rows={4}
        />
        <button type="submit" disabled={busy || !title.trim() || !body.trim()}>
          {busy ? "Saving…" : "Save memory"}
        </button>
      </form>

      <div className="memory-panel__list">
        {notes.length === 0 ? (
          <EmptyState>{`No memories yet for ${role} on this project.`}</EmptyState>
        ) : (
          notes.map((note) => (
            <article key={note.id} className="memory-card">
              <header>
                <strong>{note.title}</strong>
                <button
                  type="button"
                  onClick={() =>
                    void api.deleteRoleNote(note.id).then(() => reload())
                  }
                >
                  Delete
                </button>
              </header>
              <p>{note.body}</p>
              <footer>
                {note.kind} · {new Date(note.updatedAt).toLocaleString()}
              </footer>
            </article>
          ))
        )}
      </div>
    </div>
  );
};
