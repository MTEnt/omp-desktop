import { useEffect, useMemo, useRef, useState } from "react";

import { PRIMARY_MODEL_ROLES, useSessionStore } from "../session/session-store.ts";
import type { AvailableModel, ModelRoleAssignment } from "../session/types.ts";

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

const splitSelector = (selector: string) => {
  const match = selector.match(/^(.*?)(?::(off|minimal|low|medium|high|xhigh|max|auto))?$/);
  const base = match?.[1] ?? selector;
  const thinking = match?.[2] ?? null;
  const slash = base.indexOf("/");
  if (slash === -1) {
    return { provider: null as string | null, modelId: base, thinking, base };
  }
  return {
    provider: base.slice(0, slash),
    modelId: base.slice(slash + 1),
    thinking,
    base,
  };
};

const shortModel = (model: AvailableModel) => {
  const label = model.name || model.id;
  return label.length > 34 ? `${label.slice(0, 33)}…` : label;
};

const RolePicker = ({
  role,
  assignment,
  models,
  modelsLoaded,
  onEnsureModels,
}: {
  role: string;
  assignment?: ModelRoleAssignment;
  models: AvailableModel[];
  modelsLoaded: boolean;
  onEnsureModels: () => void;
}) => {
  const setModelRole = useSessionStore((state) => state.setModelRole);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [thinking, setThinking] = useState<string>(
    assignment?.thinking ?? "high",
  );
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThinking(assignment?.thinking ?? "high");
  }, [assignment?.selector, assignment?.thinking]);

  useEffect(() => {
    if (!open) return;
    onEnsureModels();
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onEnsureModels]);

  const providers = useMemo(() => {
    const set = new Set(models.map((model) => model.provider));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [models]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = !needle
      ? models
      : models.filter((model) => {
          const hay = `${model.provider} ${model.id} ${model.name}`.toLowerCase();
          return hay.includes(needle);
        });
    return list.slice(0, 120);
  }, [models, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, AvailableModel[]>();
    for (const model of filtered) {
      const bucket = map.get(model.provider) ?? [];
      bucket.push(model);
      map.set(model.provider, bucket);
    }
    return [...map.entries()];
  }, [filtered]);

  const currentLabel = assignment?.shortLabel ?? "not set";
  const currentBase = assignment ? splitSelector(assignment.selector).base : null;

  const choose = async (model: AvailableModel) => {
    const efforts = model.thinkingEfforts;
    const nextThinking =
      efforts.length > 0
        ? efforts.includes(thinking)
          ? thinking
          : efforts.includes("high")
            ? "high"
            : efforts[efforts.length - 1]
        : thinking;
    const selector =
      model.reasoning || efforts.length > 0
        ? `${model.selector}:${nextThinking}`
        : model.selector;
    setSaving(true);
    try {
      const ok = await setModelRole(role, selector);
      if (ok) {
        setOpen(false);
        setQuery("");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`role-picker${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="role-chip role-chip--button"
        title={`${role}: ${assignment?.selector ?? "click to choose a logged-in model"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="role-chip__role">{role}</span>
        <span className="role-chip__model">{currentLabel}</span>
        <span className="role-chip__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="role-picker__menu" role="listbox" aria-label={`${role} model`}>
          <div className="role-picker__toolbar">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter provider or model…"
              aria-label={`Filter models for ${role}`}
            />
            <label className="role-picker__thinking">
              <span>think</span>
              <select
                value={thinking}
                onChange={(event) => setThinking(event.target.value)}
              >
                {THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="role-picker__meta">
            {modelsLoaded
              ? `${providers.length} providers · ${models.length} authenticated models`
              : "Loading authenticated models…"}
            {saving ? " · saving…" : ""}
          </div>

          <div className="role-picker__list">
            {!modelsLoaded ? (
              <div className="role-picker__empty">Loading…</div>
            ) : grouped.length === 0 ? (
              <div className="role-picker__empty">
                No authenticated models matched. Log in via OMP CLI first.
              </div>
            ) : (
              grouped.map(([provider, providerModels]) => (
                <section key={provider}>
                  <header>{provider}</header>
                  {providerModels.map((model) => {
                    const selected = currentBase === model.selector;
                    return (
                      <button
                        type="button"
                        key={model.selector}
                        className={`role-picker__option${selected ? " is-selected" : ""}`}
                        onClick={() => void choose(model)}
                        disabled={saving}
                        title={model.selector}
                      >
                        <span className="role-picker__option-name">
                          {shortModel(model)}
                        </span>
                        <span className="role-picker__option-id">{model.id}</span>
                      </button>
                    );
                  })}
                </section>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const RoleModelStrip = () => {
  const modelRoles = useSessionStore((state) => state.modelRoles);
  const availableModels = useSessionStore((state) => state.availableModels);
  const availableModelsLoaded = useSessionStore(
    (state) => state.availableModelsLoaded,
  );
  const loadAvailableModels = useSessionStore((state) => state.loadAvailableModels);
  const runtimeSnapshot = useSessionStore((state) =>
    state.activeSessionId ? state.states[state.activeSessionId] : undefined,
  );

  const roles = useMemo(() => {
    const preferred = new Set<string>(PRIMARY_MODEL_ROLES);
    const map = new Map(modelRoles.map((role) => [role.role, role]));
    const ordered = [
      ...PRIMARY_MODEL_ROLES.map((role) => map.get(role)).filter(Boolean),
      ...modelRoles.filter((role) => !preferred.has(role.role)),
    ] as ModelRoleAssignment[];

    // Always show core roles even if unset in config.
    for (const role of PRIMARY_MODEL_ROLES) {
      if (!ordered.some((item) => item.role === role)) {
        ordered.unshift({
          role,
          selector: "",
          shortLabel: "not set",
        });
      }
    }

    // de-dupe after unshift
    const seen = new Set<string>();
    return ordered
      .filter((role) => {
        if (seen.has(role.role)) return false;
        seen.add(role.role);
        return true;
      })
      .slice(0, 8);
  }, [modelRoles]);

  // Keep selector stable by not depending on runtime snapshot object identity beyond active highlight.
  void runtimeSnapshot;

  return (
    <div className="runtime-strip__roles" aria-label="OMP model roles">
      {roles.map((role) => (
        <RolePicker
          key={role.role}
          role={role.role}
          assignment={role.selector ? role : undefined}
          models={availableModels}
          modelsLoaded={availableModelsLoaded}
          onEnsureModels={() => {
            if (!availableModelsLoaded || availableModels.length === 0) {
              void loadAvailableModels();
            }
          }}
        />
      ))}
    </div>
  );
};
