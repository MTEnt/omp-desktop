import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/tauri.ts";
import { selectActiveSession, useSessionStore } from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";

const projectKeyFromCwd = (cwd: string) => cwd.replaceAll("\\", "/");

export const ScratchpadPanel = () => {
  const session = useSessionStore(selectActiveSession);
  const modelRoles = useSessionStore((state) => state.modelRoles);
  const [role, setRole] = useState("default");
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const roles = useMemo(() => {
    const set = new Set(modelRoles.map((item) => item.role));
    set.add("default");
    set.add("smol");
    set.add("slow");
    set.add("plan");
    return [...set];
  }, [modelRoles]);

  const projectKey = session ? projectKeyFromCwd(session.cwd) : null;

  useEffect(() => {
    if (!projectKey) {
      setContent("");
      setUpdatedAt(0);
      setDirty(false);
      return;
    }
    void api
      .getRoleScratchpad(role, projectKey)
      .then((pad) => {
        setContent(pad.content);
        setUpdatedAt(pad.updatedAt);
        setDirty(false);
      })
      .catch(console.warn);
  }, [projectKey, role]);

  if (!session || !projectKey) {
    return <EmptyState>Open a session to edit the role scratchpad.</EmptyState>;
  }

  return (
    <div className="scratchpad-panel">
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
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            setSaving(true);
            void api
              .saveRoleScratchpad(role, projectKey, content)
              .then((pad) => {
                setUpdatedAt(pad.updatedAt);
                setDirty(false);
              })
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving…" : dirty ? "Save scratchpad" : "Saved"}
        </button>
      </div>
      <p className="scratchpad-panel__hint">
        Persistent working notes for this role on this project. Survives session
        restarts.
      </p>
      <textarea
        className="scratchpad-panel__editor"
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
        }}
        placeholder="What is this role working on? Blockers? Next steps?"
      />
      {updatedAt > 0 ? (
        <footer className="scratchpad-panel__meta">
          Last saved {new Date(updatedAt).toLocaleString()}
        </footer>
      ) : null}
    </div>
  );
};
