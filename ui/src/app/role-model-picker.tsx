import { useEffect, useMemo, useRef, useState } from "react";

import { useLayoutStore } from "./layout-store.ts";
import { PRIMARY_MODEL_ROLES, useSessionStore } from "../session/session-store.ts";
import type { AvailableModel, ModelRoleAssignment } from "../session/types.ts";

const FALLBACK_THINKING = ["off", "low", "medium", "high"] as const;

/** Chip label: model id (+ optional :thinking), no provider prefix. */
const chipModelLabel = (role: ModelRoleAssignment) => {
  const raw = role.shortLabel?.trim() || role.selector?.trim() || "";
  if (!raw || raw === "—") return "—";
  const base = raw.includes(":") ? raw.slice(0, raw.lastIndexOf(":")) : raw;
  const thinking = raw.includes(":") ? raw.slice(raw.lastIndexOf(":")) : "";
  const model = base.includes("/") ? base.slice(base.lastIndexOf("/") + 1) : base;
  const label = `${model}${thinking}`;
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
};

const splitSelectorBase = (selector: string) => {
  if (!selector.includes(":")) return selector;
  return selector.slice(0, selector.lastIndexOf(":"));
};

const shortModel = (model: AvailableModel) => {
  const label = model.name || model.id;
  return label.length > 34 ? `${label.slice(0, 33)}…` : label;
};

const thinkingOptionsFor = (model: AvailableModel): string[] => {
  if (model.thinkingEfforts.length > 0) return model.thinkingEfforts;
  if (model.reasoning) return [...FALLBACK_THINKING];
  return [];
};

const DefaultRolePicker = ({
  assignment,
}: {
  assignment: ModelRoleAssignment;
}) => {
  const setModelRole = useSessionStore((state) => state.setModelRole);
  const availableModels = useSessionStore((state) => state.availableModels);
  const availableModelsLoaded = useSessionStore(
    (state) => state.availableModelsLoaded,
  );
  const loadAvailableModels = useSessionStore((state) => state.loadAvailableModels);
  const openDrawer = useLayoutStore((state) => state.openDrawer);
  const setAgentsFocusRole = useLayoutStore((state) => state.setAgentsFocusRole);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [thinking, setThinking] = useState(assignment.thinking ?? "high");
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThinking(assignment.thinking ?? "high");
  }, [assignment.selector, assignment.thinking]);

  useEffect(() => {
    if (!open) return;
    if (!availableModelsLoaded || availableModels.length === 0) {
      void loadAvailableModels();
    }
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
  }, [open, availableModelsLoaded, availableModels.length, loadAvailableModels]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = !needle
      ? availableModels
      : availableModels.filter((model) => {
          const hay = `${model.provider} ${model.id} ${model.name}`.toLowerCase();
          return hay.includes(needle);
        });
    return list.slice(0, 120);
  }, [availableModels, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, AvailableModel[]>();
    for (const model of filtered) {
      const bucket = map.get(model.provider) ?? [];
      bucket.push(model);
      map.set(model.provider, bucket);
    }
    return [...map.entries()];
  }, [filtered]);

  const providers = useMemo(
    () => [...new Set(availableModels.map((model) => model.provider))].sort(),
    [availableModels],
  );

  const currentBase = assignment.selector
    ? splitSelectorBase(assignment.selector)
    : null;
  const unset = !assignment.selector;
  const label = chipModelLabel(assignment);
  const full = assignment.selector?.trim() || "choose a model";

  const choose = async (model: AvailableModel) => {
    const efforts = thinkingOptionsFor(model);
    const nextThinking =
      efforts.length > 0
        ? efforts.includes(thinking)
          ? thinking
          : efforts.includes("high")
            ? "high"
            : efforts[efforts.length - 1]
        : null;
    const selector = nextThinking
      ? `${model.selector}:${nextThinking}`
      : model.selector;
    setSaving(true);
    try {
      const ok = await setModelRole("default", selector);
      if (ok) {
        setOpen(false);
        setQuery("");
      }
    } finally {
      setSaving(false);
    }
  };

  const openAgents = () => {
    setOpen(false);
    setQuery("");
    setAgentsFocusRole("default");
    openDrawer("agents");
  };

  return (
    <div className={`role-picker${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`role-chip role-chip--button${unset ? " is-unset" : ""}`}
        title={`default: ${full}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="role-chip__role">default</span>
        <span className="role-chip__model">{label}</span>
        <span className="role-chip__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="role-picker__menu" role="listbox" aria-label="default model">
          <div className="role-picker__toolbar">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter provider or model…"
              aria-label="Filter models for default"
            />
            <label className="role-picker__thinking">
              <span>think</span>
              <select
                value={thinking}
                onChange={(event) => setThinking(event.target.value)}
              >
                {[
                  ...new Set([
                    ...FALLBACK_THINKING,
                    "minimal",
                    "xhigh",
                    "max",
                    thinking,
                  ]),
                ].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="role-picker__meta">
            {availableModelsLoaded
              ? `${providers.length} providers · ${availableModels.length} models`
              : "Loading authenticated models…"}
            {saving ? " · saving…" : ""}
          </div>

          <div className="role-picker__list">
            {!availableModelsLoaded ? (
              <div className="role-picker__empty">Loading…</div>
            ) : grouped.length === 0 ? (
              <div className="role-picker__empty">
                No authenticated models matched. Sign in via Settings, or open Agents.
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

          <div className="role-picker__footer">
            <button type="button" onClick={openAgents}>
              Open Agents…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const RoleModelStrip = () => {
  const modelRoles = useSessionStore((state) => state.modelRoles);
  const openDrawer = useLayoutStore((state) => state.openDrawer);
  const setAgentsFocusRole = useLayoutStore((state) => state.setAgentsFocusRole);

  const roles = useMemo(() => {
    const preferred = new Set<string>(PRIMARY_MODEL_ROLES);
    const map = new Map(modelRoles.map((role) => [role.role, role]));
    const ordered = [
      ...PRIMARY_MODEL_ROLES.map((role) => map.get(role)).filter(Boolean),
      ...modelRoles.filter((role) => !preferred.has(role.role)),
    ] as ModelRoleAssignment[];

    for (const role of PRIMARY_MODEL_ROLES) {
      if (!ordered.some((item) => item.role === role)) {
        ordered.unshift({
          role,
          selector: "",
          shortLabel: "—",
        });
      }
    }

    const seen = new Set<string>();
    return ordered
      .filter((role) => {
        if (seen.has(role.role)) return false;
        seen.add(role.role);
        return true;
      })
      .slice(0, 8);
  }, [modelRoles]);

  const openAgents = (role: string) => {
    setAgentsFocusRole(role);
    openDrawer("agents");
  };

  return (
    <div className="runtime-strip__roles" aria-label="OMP model roles">
      {roles.map((role) => {
        if (role.role === "default") {
          return <DefaultRolePicker key={role.role} assignment={role} />;
        }

        const unset = !role.selector;
        const label = chipModelLabel(role);
        const full = role.selector?.trim() || "configure in Agents";
        return (
          <button
            key={role.role}
            type="button"
            className={`role-chip${unset ? " is-unset" : ""}`}
            title={`${role.role}: ${full}`}
            onClick={() => openAgents(role.role)}
          >
            <span className="role-chip__role">{role.role}</span>
            <span className="role-chip__model">{label}</span>
          </button>
        );
      })}
    </div>
  );
};
