import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/tauri.ts";
import {
  projectKeyForSession,
  selectActiveSession,
  useSessionStore,
} from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";


export const ScratchpadPanel = () => {
  const session = useSessionStore(selectActiveSession);
  const modelRoles = useSessionStore((state) => state.modelRoles);
  const [role, setRole] = useState("default");
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const activeKey = useRef("");
  const contentRef = useRef(content);
  const dirtyRef = useRef(dirty);
  const loadGeneration = useRef(0);
  const saveGeneration = useRef(0);

  const roles = useMemo(() => {
    const set = new Set(modelRoles.map((item) => item.role));
    set.add("default");
    set.add("smol");
    set.add("slow");
    set.add("plan");
    return [...set];
  }, [modelRoles]);

  const projectKey = session ? projectKeyForSession(session) : null;
  const editorKey = `${role}\u0000${projectKey ?? ""}`;
  activeKey.current = editorKey;
  contentRef.current = content;
  dirtyRef.current = dirty;

  useEffect(() => {
    const request = ++loadGeneration.current;
    saveGeneration.current += 1;
    setSaving(false);
    setContent("");
    setUpdatedAt(0);
    setDirty(false);
    dirtyRef.current = false;
    if (!projectKey) return;

    void api
      .getRoleScratchpad(role, projectKey)
      .then((pad) => {
        if (
          request !== loadGeneration.current ||
          editorKey !== activeKey.current ||
          dirtyRef.current
        ) {
          return;
        }
        setContent(pad.content);
        setUpdatedAt(pad.updatedAt);
        setDirty(false);
        dirtyRef.current = false;
      })
      .catch(console.warn);
    return () => {
      loadGeneration.current += 1;
    };
  }, [editorKey, projectKey, role]);

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
            const request = ++saveGeneration.current;
            const savedKey = editorKey;
            const savedContent = content;
            setSaving(true);
            void api
              .saveRoleScratchpad(role, projectKey, savedContent)
              .then((pad) => {
                if (
                  request !== saveGeneration.current ||
                  savedKey !== activeKey.current ||
                  savedContent !== contentRef.current
                ) {
                  return;
                }
                setUpdatedAt(pad.updatedAt);
                setDirty(false);
                dirtyRef.current = false;
              })
              .catch(console.warn)
              .finally(() => {
                if (
                  request === saveGeneration.current &&
                  savedKey === activeKey.current
                ) {
                  setSaving(false);
                }
              });
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
          loadGeneration.current += 1;
          saveGeneration.current += 1;
          setSaving(false);
          setContent(e.target.value);
          contentRef.current = e.target.value;
          setDirty(true);
          dirtyRef.current = true;
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
