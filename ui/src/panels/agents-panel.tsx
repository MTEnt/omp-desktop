import { useEffect, useMemo, useState } from "react";

import { useLayoutStore } from "../app/layout-store.ts";
import { PRIMARY_MODEL_ROLES, useSessionStore } from "../session/session-store.ts";
import type { AvailableModel, ModelRolePreset } from "../session/types.ts";

const FALLBACK_THINKING = ["off", "low", "medium", "high"] as const;

const shortModel = (model: AvailableModel) => {
  const label = model.name || model.id;
  return label.length > 40 ? `${label.slice(0, 39)}…` : label;
};

const thinkingOptionsFor = (model: AvailableModel | null): string[] => {
  if (!model) return [];
  if (model.thinkingEfforts.length > 0) return model.thinkingEfforts;
  if (model.reasoning) return [...FALLBACK_THINKING];
  return [];
};

const buildSelector = (model: AvailableModel, thinking: string | null) => {
  const efforts = thinkingOptionsFor(model);
  if (efforts.length === 0 || !thinking) return model.selector;
  return `${model.selector}:${thinking}`;
};

const suggestBuiltinPresets = (
  models: AvailableModel[],
): ModelRolePreset[] => {
  if (models.length === 0) return [];
  const flat = models;
  const pick = (index: number) => flat[Math.min(index, flat.length - 1)];
  const withThink = (model: AvailableModel, prefer: string) => {
    const efforts = thinkingOptionsFor(model);
    if (efforts.length === 0) return model.selector;
    const level = efforts.includes(prefer)
      ? prefer
      : efforts.includes("high")
        ? "high"
        : efforts[efforts.length - 1];
    return `${model.selector}:${level}`;
  };

  const mid = pick(Math.floor(flat.length / 2));
  const fast = pick(0);
  const deep = pick(flat.length - 1);

  return [
    {
      name: "Balanced",
      roles: {
        default: withThink(mid, "medium"),
        smol: withThink(fast, "low"),
        slow: withThink(deep, "high"),
        plan: withThink(mid, "high"),
      },
    },
    {
      name: "Fast",
      roles: {
        default: withThink(fast, "low"),
        smol: withThink(fast, "off"),
        slow: withThink(mid, "medium"),
        plan: withThink(fast, "medium"),
      },
    },
    {
      name: "Deep",
      roles: {
        default: withThink(deep, "high"),
        smol: withThink(mid, "low"),
        slow: withThink(deep, "max"),
        plan: withThink(deep, "high"),
      },
    },
  ].map((preset) => {
    // Clamp unknown thinking levels like "max" if unsupported.
    const roles: Record<string, string> = {};
    for (const [role, selector] of Object.entries(preset.roles)) {
      const [base, thinking] = selector.includes(":")
        ? (() => {
            const i = selector.lastIndexOf(":");
            return [selector.slice(0, i), selector.slice(i + 1)] as const;
          })()
        : ([selector, null] as const);
      const model = models.find((item) => item.selector === base);
      if (!model) {
        roles[role] = selector;
        continue;
      }
      const efforts = thinkingOptionsFor(model);
      if (!thinking || efforts.length === 0) {
        roles[role] = model.selector;
        continue;
      }
      const level = efforts.includes(thinking)
        ? thinking
        : efforts.includes("high")
          ? "high"
          : efforts[efforts.length - 1];
      roles[role] = `${model.selector}:${level}`;
    }
    return { name: preset.name, roles };
  });
};

export const AgentsPanel = () => {
  const modelRoles = useSessionStore((state) => state.modelRoles);
  const availableModels = useSessionStore((state) => state.availableModels);
  const availableModelsLoaded = useSessionStore(
    (state) => state.availableModelsLoaded,
  );
  const loadAvailableModels = useSessionStore((state) => state.loadAvailableModels);
  const loadModelRoles = useSessionStore((state) => state.loadModelRoles);
  const setModelRole = useSessionStore((state) => state.setModelRole);
  const settings = useSessionStore((state) => state.settings);
  const saveSettings = useSessionStore((state) => state.saveSettings);
  const loadSettings = useSessionStore((state) => state.loadSettings);

  const agentsFocusRole = useLayoutStore((state) => state.agentsFocusRole);
  const setAgentsFocusRole = useLayoutStore((state) => state.setAgentsFocusRole);

  const [activeRole, setActiveRole] = useState<string>("default");
  const [query, setQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState<AvailableModel | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");

  useEffect(() => {
    void loadSettings();
    void loadModelRoles();
    void loadAvailableModels();
  }, [loadSettings, loadModelRoles, loadAvailableModels]);

  useEffect(() => {
    if (!agentsFocusRole) return;
    setActiveRole(agentsFocusRole);
    setAgentsFocusRole(null);
  }, [agentsFocusRole, setAgentsFocusRole]);

  const roleAssignments = useMemo(() => {
    const map = new Map(modelRoles.map((role) => [role.role, role]));
    return PRIMARY_MODEL_ROLES.map((role) => {
      const current = map.get(role);
      return (
        current ?? {
          role,
          selector: "",
          shortLabel: "—",
        }
      );
    });
  }, [modelRoles]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = !needle
      ? availableModels
      : availableModels.filter((model) => {
          const hay = `${model.provider} ${model.id} ${model.name}`.toLowerCase();
          return hay.includes(needle);
        });
    return list.slice(0, 160);
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

  const thinkingOptions = thinkingOptionsFor(selectedModel);
  const userPresets = settings?.modelRolePresets ?? [];
  const builtinPresets = useMemo(
    () => suggestBuiltinPresets(availableModels),
    [availableModels],
  );

  const selectModel = (model: AvailableModel) => {
    setSelectedModel(model);
    const efforts = thinkingOptionsFor(model);
    if (efforts.length === 0) {
      setThinking(null);
      return;
    }
    const current = roleAssignments.find((item) => item.role === activeRole);
    const fromRole = current?.thinking;
    setThinking(
      fromRole && efforts.includes(fromRole)
        ? fromRole
        : efforts.includes("high")
          ? "high"
          : efforts[efforts.length - 1],
    );
  };

  const applyRole = async () => {
    if (!selectedModel) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const selector = buildSelector(selectedModel, thinking);
      const ok = await setModelRole(activeRole, selector);
      if (ok) setStatus(`Set ${activeRole} → ${selector}`);
      else setError(`Unable to set ${activeRole}`);
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = async (preset: ModelRolePreset) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      for (const [role, selector] of Object.entries(preset.roles)) {
        if (!selector.trim()) continue;
        const ok = await setModelRole(role, selector);
        if (!ok) {
          setError(`Failed applying ${role} from “${preset.name}”`);
          return;
        }
      }
      setStatus(`Applied preset “${preset.name}”`);
      void loadModelRoles();
    } finally {
      setBusy(false);
    }
  };

  const saveCurrentAsPreset = async () => {
    const name = presetName.trim();
    if (!name) {
      setError("Enter a preset name");
      return;
    }
    if (!settings) {
      setError("Settings not loaded");
      return;
    }
    const roles: Record<string, string> = {};
    for (const role of roleAssignments) {
      if (role.selector) roles[role.role] = role.selector;
    }
    if (Object.keys(roles).length === 0) {
      setError("Assign at least one role before saving a preset");
      return;
    }
    const nextPresets = [
      ...userPresets.filter(
        (preset) => preset.name.toLowerCase() !== name.toLowerCase(),
      ),
      { name, roles },
    ];
    setBusy(true);
    setError(null);
    try {
      const ok = await saveSettings({
        ...settings,
        modelRolePresets: nextPresets,
      });
      if (ok) {
        setPresetName("");
        setStatus(`Saved preset “${name}”`);
      } else {
        setError("Unable to save preset");
      }
    } finally {
      setBusy(false);
    }
  };

  const deletePreset = async (name: string) => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await saveSettings({
        ...settings,
        modelRolePresets: userPresets.filter((preset) => preset.name !== name),
      });
      if (ok) setStatus(`Deleted preset “${name}”`);
      else setError("Unable to delete preset");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="agents-panel">
      <section className="settings-section">
        <header className="settings-section__head">
          <p className="eyebrow">Roles</p>
          <p className="settings-section__blurb">
            Assign models for default / smol / slow / plan. Thinking is chosen
            per model from its supported efforts.
          </p>
        </header>

        <div className="settings-list agents-roles" role="list">
          {roleAssignments.map((role) => (
            <button
              type="button"
              role="listitem"
              key={role.role}
              className={`settings-list__row agents-roles__row${activeRole === role.role ? " is-active" : ""}`}
              onClick={() => setActiveRole(role.role)}
            >
              <div className="settings-list__copy">
                <span className="settings-list__title">{role.role}</span>
                <span className="settings-list__id">
                  {role.selector || "not set"}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <header className="settings-section__head">
          <p className="eyebrow">Model · {activeRole}</p>
          <p className="settings-section__blurb">
            {availableModelsLoaded
              ? `${availableModels.length} authenticated models`
              : "Loading models…"}
          </p>
        </header>

        <label className="panel-field">
          <span>Filter</span>
          <input
            type="search"
            value={query}
            placeholder="provider or model…"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="agents-models" role="listbox" aria-label="Models">
          {!availableModelsLoaded ? (
            <p className="settings-list__empty">Loading…</p>
          ) : grouped.length === 0 ? (
            <p className="settings-list__empty">
              No models. Sign in or add an API key in Settings.
            </p>
          ) : (
            grouped.map(([provider, models]) => (
              <section key={provider}>
                <header className="agents-models__provider">{provider}</header>
                {models.map((model) => {
                  const selected = selectedModel?.selector === model.selector;
                  return (
                    <button
                      type="button"
                      key={model.selector}
                      role="option"
                      aria-selected={selected}
                      className={`agents-models__option${selected ? " is-selected" : ""}`}
                      onClick={() => selectModel(model)}
                    >
                      <span>{shortModel(model)}</span>
                      <span>{model.id}</span>
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>

        {selectedModel && (
          <div className="agents-thinking">
            <div className="agents-thinking__head">
              <span>Thinking</span>
              <em>{selectedModel.selector}</em>
            </div>
            {thinkingOptions.length === 0 ? (
              <p className="settings-section__note">No thinking levels for this model.</p>
            ) : (
              <div className="agents-thinking__chips">
                {thinkingOptions.map((level) => (
                  <button
                    type="button"
                    key={level}
                    className={`agents-chip${thinking === level ? " is-active" : ""}`}
                    onClick={() => setThinking(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            )}
            <div className="settings-form__footer">
              <button
                type="button"
                className="panel-button panel-button--primary"
                disabled={busy || !selectedModel}
                onClick={() => void applyRole()}
              >
                {busy ? "Saving…" : `Set ${activeRole}`}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="settings-section">
        <header className="settings-section__head">
          <p className="eyebrow">Presets</p>
          <p className="settings-section__blurb">
            Apply a bundle of role assignments, or save the current map.
          </p>
        </header>

        <div className="agents-presets">
          {builtinPresets.map((preset) => (
            <div className="agents-presets__row" key={`builtin-${preset.name}`}>
              <div className="settings-list__copy">
                <span className="settings-list__title">{preset.name}</span>
                <span className="settings-list__id">suggested</span>
              </div>
              <button
                type="button"
                className="panel-button panel-button--primary"
                disabled={busy || availableModels.length === 0}
                onClick={() => void applyPreset(preset)}
              >
                Apply
              </button>
            </div>
          ))}

          {userPresets.map((preset) => (
            <div className="agents-presets__row" key={`user-${preset.name}`}>
              <div className="settings-list__copy">
                <span className="settings-list__title">{preset.name}</span>
                <span className="settings-list__id">saved</span>
              </div>
              <div className="settings-list__actions">
                <button
                  type="button"
                  className="panel-button panel-button--primary"
                  disabled={busy}
                  onClick={() => void applyPreset(preset)}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="panel-button"
                  disabled={busy}
                  onClick={() => void deletePreset(preset.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="agents-presets__save">
          <label className="panel-field">
            <span>Save current as</span>
            <input
              type="text"
              value={presetName}
              placeholder="Preset name"
              spellCheck={false}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="panel-button"
            disabled={busy}
            onClick={() => void saveCurrentAsPreset()}
          >
            Save preset
          </button>
        </div>
      </section>

      {status && <p className="settings-section__note">{status}</p>}
      {error && (
        <p className="panel-feedback panel-feedback--error settings-section__error">
          {error}
        </p>
      )}
    </div>
  );
};
