import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/tauri.ts";
import { LAUNCH_RECIPES, readSessionRuntimeStatus, useSessionStore } from "../session/session-store.ts";
import type { ApprovalMode } from "../session/types.ts";
import { useLayoutStore, type PanelId } from "./layout-store.ts";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PaletteAction {
  id: string;
  group: string;
  label: string;
  detail: string;
  keywords?: string;
  shortcut?: string;
  disabled?: boolean;
  closeOnRun?: boolean;
  run: () => void | Promise<void>;
}

interface AvailableModel {
  id: string;
  label: string;
}

const panelActions: Array<{ id: PanelId; label: string }> = [
  { id: "sessions", label: "Sessions" },
  { id: "project", label: "Project" },
  { id: "plan", label: "Plan" },
  { id: "activity", label: "Activity" },
  { id: "attention", label: "Attention" },
  { id: "review", label: "Review" },
  { id: "subagents", label: "Subagents" },
  { id: "jobs", label: "Job board" },
  { id: "memory", label: "Role memory" },
  { id: "scratchpad", label: "Scratchpad" },
  { id: "settings", label: "Settings" },
  { id: "terminal", label: "Terminal" },
];

const approvalModes: Array<{ id: ApprovalMode; label: string; detail: string }> = [
  { id: "yolo", label: "Yolo", detail: "Run without approval prompts" },
  { id: "write", label: "Write", detail: "Approve file changes automatically" },
  { id: "alwaysAsk", label: "Always ask", detail: "Prompt before every approval" },
];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const extractModels = (response: unknown): AvailableModel[] => {
  const envelope = asRecord(response);
  const payload = envelope?.data ?? response;
  const payloadRecord = asRecord(payload);
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(payloadRecord?.models)
      ? payloadRecord.models
      : Array.isArray(payloadRecord?.availableModels)
        ? payloadRecord.availableModels
        : [];
  const models: AvailableModel[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const model = asRecord(candidate);
    const id =
      typeof candidate === "string"
        ? candidate
        : typeof model?.id === "string"
          ? model.id
          : typeof model?.model === "string"
            ? model.model
            : typeof model?.name === "string"
              ? model.name
              : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label =
      typeof model?.displayName === "string"
        ? model.displayName
        : typeof model?.label === "string"
          ? model.label
          : id;
    models.push({ id, label });
  }

  return models;
};

const focusTerminal = () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const terminals = document.querySelectorAll<HTMLElement>(
        ".terminal-panel .xterm-helper-textarea",
      );
      terminals.item(terminals.length - 1)?.focus();
    });
  });
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const CommandPalette = ({ open, onOpenChange }: CommandPaletteProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const states = useSessionStore((state) => state.states);
  const settings = useSessionStore((state) => state.settings);
  const setActive = useSessionStore((state) => state.setActive);
  const openFolder = useSessionStore((state) => state.openFolder);
  const refreshState = useSessionStore((state) => state.refreshState);
  const saveSettings = useSessionStore((state) => state.saveSettings);
  const drawer = useLayoutStore((state) => state.drawer);
  const toggleDrawer = useLayoutStore((state) => state.toggleDrawer);
  const openDrawer = useLayoutStore((state) => state.openDrawer);
  const toggleSessionsSidebar = useLayoutStore((state) => state.toggleSessionsSidebar);
  const sessionsSidebarOpen = useLayoutStore((state) => state.sessionsSidebarOpen);
  const [mode, setMode] = useState<"commands" | "models">("commands");
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [models, setModels] = useState<AvailableModel[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runtimeStatus = useMemo(
    () =>
      readSessionRuntimeStatus(
        activeSessionId ? states[activeSessionId] : undefined,
      ),
    [activeSessionId, states],
  );

  useEffect(() => {
    if (!open) return;
    setMode("commands");
    setQuery("");
    setSelectedIndex(0);
    setModels(null);
    setBusyId(null);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [mode, open, query]);

  const commandActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = [
      {
        id: "new-session",
        group: "Session",
        label: "New session",
        detail: "Choose a project folder",
        keywords: "open folder workspace",
        run: () => openFolder(),
      },
      ...sessions.map<PaletteAction>((session) => ({
        id: `session-${session.id}`,
        group: "Switch session",
        label: session.title,
        detail:
          session.id === activeSessionId ? "Current session" : session.cwd,
        keywords: `${session.cwd} ${session.status}`,
        disabled: session.id === activeSessionId,
        run: () => setActive(session.id),
      })),
      ...panelActions.map<PaletteAction>((panel) => ({
        id: `panel-${panel.id}`,
        group: "Panels",
        label: `Toggle ${panel.label}`,
        detail:
          panel.id === "sessions"
            ? sessionsSidebarOpen
              ? "Hide sidebar"
              : "Show sidebar"
            : drawer === panel.id
              ? "Close drawer"
              : "Open drawer",
        keywords: `view show hide ${panel.label}`,
        run: () =>
          panel.id === "sessions"
            ? toggleSessionsSidebar()
            : toggleDrawer(panel.id),
      })),
      {
        id: "ssh-connect",
        group: "Session",
        label: "Connect via SSH",
        detail: "Open a remote folder over SSH",
        keywords: "remote host server ssh folder",
        run: () => {
          window.dispatchEvent(new Event("omp-desktop:open-ssh"));
        },
      },
      ...LAUNCH_RECIPES.map((recipe) => ({
        id: `recipe-${recipe.id}`,
        group: "Launch",
        label: recipe.label,
        detail: recipe.detail,
        keywords: recipe.keywords,
        disabled: !activeSessionId,
        run: async () => {
          const ok = await useSessionStore.getState().launchRecipe(recipe, {
            url: "http://localhost:5173",
            topic: "the current project",
            target: "the active UI",
          });
          if (!ok) throw new Error("Launch failed");
        },
      })),
      {
        id: "open-launch-panel",
        group: "Launch",
        label: "Open Launch panel",
        detail: "Recipes, skills, browser and companion entry points",
        keywords: "skills workflows recipes",
        run: () => openDrawer("launch"),
      },
      {
        id: "open-settings",
        group: "Preferences",
        label: "Open settings",
        detail: "Show application preferences",
        keywords: "configuration options",
        run: () => openDrawer("settings"),
      },
      {
        id: "sign-in-providers",
        group: "Preferences",
        label: "Sign in to providers",
        detail: activeSessionId
          ? "Open settings provider login"
          : "Open a session first, then authenticate providers",
        keywords: "login auth authenticate oauth providers accounts",
        run: () => openDrawer("settings"),
      },
      {
        id: "focus-terminal",
        group: "Session",
        label: "Focus terminal",
        detail: activeSessionId
          ? "Open the active session shell"
          : "Open a session first",
        keywords: "shell pty console",
        disabled: !activeSessionId,
        run: () => {
          openDrawer("terminal");
          focusTerminal();
        },
      },
      ...approvalModes.map<PaletteAction>((modeOption) => ({
        id: `approval-${modeOption.id}`,
        group: "Approval mode",
        label: `Approval · ${modeOption.label}`,
        detail:
          settings?.approvalMode === modeOption.id
            ? `Active · ${modeOption.detail}`
            : modeOption.detail,
        keywords: `permissions ${modeOption.id}`,
        disabled: !settings || settings.approvalMode === modeOption.id,
        run: async () => {
          if (!settings) return;
          const didSave = await saveSettings({
            ...settings,
            approvalMode: modeOption.id,
          });
          if (!didSave) throw new Error("Settings could not be saved");
        },
      })),
      {
        id: "cycle-thinking",
        group: "Runtime",
        label: "Cycle thinking level",
        detail: activeSessionId
          ? `Current · ${runtimeStatus.thinkingLevel ?? "unknown"}`
          : "Open a session first",
        keywords: "reasoning effort",
        disabled: !activeSessionId,
        run: async () => {
          if (!activeSessionId) return;
          await api.rpcCommand(activeSessionId, "cycle_thinking_level");
          await refreshState(activeSessionId);
        },
      },
      {
        id: "choose-model",
        group: "Runtime",
        label: "Set model…",
        detail: activeSessionId
          ? `Current · ${runtimeStatus.model ?? "unknown"}`
          : "Open a session first",
        keywords: "provider available models",
        disabled: !activeSessionId,
        closeOnRun: false,
        run: async () => {
          if (!activeSessionId) return;
          setMode("models");
          setQuery("");
          setModels(null);
          try {
            const response = await api.rpcCommand(
              activeSessionId,
              "get_available_models",
            );
            setModels(extractModels(response));
          } catch (cause) {
            setModels([]);
            throw cause;
          }
        },
      },
    ];

    return actions;
  }, [
    activeSessionId,
    drawer,
    openDrawer,
    toggleSessionsSidebar,
    sessionsSidebarOpen,
    openFolder,
    refreshState,
    runtimeStatus.model,
    runtimeStatus.thinkingLevel,
    saveSettings,
    sessions,
    setActive,
    settings,
    toggleDrawer,
  ]);

  const modelActions = useMemo<PaletteAction[]>(
    () =>
      (models ?? []).map((model) => ({
        id: `model-${model.id}`,
        group: "Available models",
        label: model.label,
        detail:
          model.id === runtimeStatus.model ? "Current model" : model.id,
        keywords: model.id,
        disabled: model.id === runtimeStatus.model,
        run: async () => {
          if (!activeSessionId) return;
          await api.rpcCommand(activeSessionId, "set_model", {
            model: model.id,
          });
          await refreshState(activeSessionId);
        },
      })),
    [activeSessionId, models, refreshState, runtimeStatus.model],
  );

  const actions = mode === "commands" ? commandActions : modelActions;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredActions = actions.filter((action) =>
    `${action.label} ${action.detail} ${action.keywords ?? ""}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
  const selectableActions = filteredActions.filter((action) => !action.disabled);
  const groupedActions = filteredActions.reduce<Array<[string, PaletteAction[]]>>(
    (groups, action) => {
      const group = groups.find(([label]) => label === action.group);
      if (group) {
        group[1].push(action);
      } else {
        groups.push([action.group, [action]]);
      }
      return groups;
    },
    [],
  );

  const execute = async (action: PaletteAction) => {
    if (action.disabled || busyId) return;
    setBusyId(action.id);
    setError(null);
    if (action.closeOnRun !== false) onOpenChange(false);

    try {
      await action.run();
    } catch (cause) {
      setError(errorMessage(cause));
      onOpenChange(true);
    } finally {
      setBusyId(null);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (mode === "models") {
        setMode("commands");
        setQuery("");
      } else {
        onOpenChange(false);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (selectableActions.length === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setSelectedIndex(
        (current) =>
          (current + direction + selectableActions.length) %
          selectableActions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const action = selectableActions[selectedIndex];
      if (action) void execute(action);
    }
  };

  if (!open) return null;

  let selectableIndex = -1;

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "models" ? "Choose a model" : "Command palette"}
      >
        <header
          className={`command-palette__search${mode === "models" ? " command-palette__search--models" : ""}`}
        >
          {mode === "models" && (
            <button
              type="button"
              className="command-palette__back"
              aria-label="Back to commands"
              onClick={() => {
                setMode("commands");
                setQuery("");
              }}
            >
              ←
            </button>
          )}
          <span className="command-palette__prompt" aria-hidden="true">
            &gt;
          </span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={
              selectableActions[selectedIndex]
                ? `palette-${selectableActions[selectedIndex].id}`
                : undefined
            }
            autoComplete="off"
            spellCheck="false"
            value={query}
            placeholder={
              mode === "models" ? "Filter available models" : "Type a command"
            }
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd>ESC</kbd>
        </header>

        <div
          className="command-palette__results"
          id="command-palette-results"
          role="listbox"
        >
          {mode === "models" && models === null ? (
            <div className="command-palette__empty">
              <span className="command-palette__loader" aria-hidden="true" />
              Asking the active session for models…
            </div>
          ) : groupedActions.length === 0 ? (
            <div className="command-palette__empty">
              {mode === "models" && models?.length === 0
                ? "No models were returned by this session."
                : "No matching command."}
            </div>
          ) : (
            groupedActions.map(([group, groupActions]) => (
              <div className="command-palette__group" key={group}>
                <div className="command-palette__group-label">{group}</div>
                {groupActions.map((action) => {
                  const actionSelectableIndex = action.disabled
                    ? -1
                    : ++selectableIndex;
                  const isSelected =
                    actionSelectableIndex === selectedIndex;
                  return (
                    <button
                      id={`palette-${action.id}`}
                      className={isSelected ? "is-selected" : ""}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={action.disabled || busyId !== null}
                      key={action.id}
                      onMouseMove={() => {
                        if (!action.disabled) {
                          setSelectedIndex(actionSelectableIndex);
                        }
                      }}
                      onClick={() => void execute(action)}
                    >
                      <span className="command-palette__action-mark" aria-hidden="true">
                        {isSelected ? "›" : "·"}
                      </span>
                      <span className="command-palette__action-copy">
                        <strong>{action.label}</strong>
                        <small>{action.detail}</small>
                      </span>
                      {busyId === action.id ? (
                        <span className="command-palette__pending">Running</span>
                      ) : action.shortcut ? (
                        <kbd>{action.shortcut}</kbd>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <footer className="command-palette__footer">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> run
          </span>
          {error ? (
            <strong role="alert">{error}</strong>
          ) : (
            <span className="command-palette__scope">
              {activeSessionId ? "Session commands live" : "No active session"}
            </span>
          )}
        </footer>
      </section>
    </div>
  );
};
