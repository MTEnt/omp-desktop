import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../lib/tauri.ts";
import {
  HOST_SLASH_COMMANDS,
  mergeSlashCommands,
  normalizeCommandsPayload,
  type SlashCommand,
} from "../session/slash.ts";
import {
  selectActiveSession,
  useSessionStore,
} from "../session/session-store.ts";
import type { CatalogItem, CatalogSnapshot } from "../session/types.ts";
import { EmptyState } from "./empty-state.tsx";

type CatalogTab = "skills" | "mcp" | "agents" | "commands";

const TABS: Array<{ id: CatalogTab; label: string }> = [
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" },
  { id: "agents", label: "Agents" },
  { id: "commands", label: "Commands" },
];

const emptySnapshot = (): CatalogSnapshot => ({
  mcpServers: [],
  agents: [],
  skills: [],
  notes: [],
});

const filterItems = (items: CatalogItem[], query: string): CatalogItem[] => {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    `${item.name} ${item.source} ${item.detail ?? ""}`.toLowerCase().includes(q),
  );
};

const filterCommands = (commands: SlashCommand[], query: string): SlashCommand[] => {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((cmd) =>
    `${cmd.name} ${cmd.description ?? ""} ${cmd.source ?? ""}`
      .toLowerCase()
      .includes(q),
  );
};

export const CatalogPanel = () => {
  const session = useSessionStore(selectActiveSession);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const commandsBySession = useSessionStore((state) => state.commandsBySession);
  const loadAvailableCommands = useSessionStore(
    (state) => state.loadAvailableCommands,
  );

  const [tab, setTab] = useState<CatalogTab>("skills");
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<CatalogSnapshot>(emptySnapshot);
  const [catalogState, setCatalogState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [commandsState, setCommandsState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [localCommands, setLocalCommands] = useState<SlashCommand[] | null>(
    null,
  );

  const cwd = session?.cwd ?? null;

  const reloadCatalog = useCallback(async () => {
    setCatalogState("loading");
    setCatalogError(null);
    try {
      const next = await api.getCatalog(cwd);
      setSnapshot(next ?? emptySnapshot());
      setCatalogState("ready");
    } catch (error) {
      setSnapshot(emptySnapshot());
      setCatalogState("error");
      setCatalogError(
        error instanceof Error ? error.message : "Unable to load local catalog",
      );
    }
  }, [cwd]);

  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);

  const reloadCommands = useCallback(async () => {
    if (!activeSessionId) {
      setLocalCommands(null);
      setCommandsState("idle");
      return;
    }
    setCommandsState("loading");
    try {
      // Prefer live RPC so the panel works even if store cache is stale.
      const raw = await api.getAvailableCommands(activeSessionId);
      const remote = normalizeCommandsPayload(raw);
      const merged = mergeSlashCommands(HOST_SLASH_COMMANDS, remote);
      setLocalCommands(merged);
      setCommandsState("ready");
      // Keep session store in sync for composer autocomplete.
      void loadAvailableCommands(activeSessionId);
    } catch {
      const cached = commandsBySession[activeSessionId];
      if (cached && cached.length > 0) {
        setLocalCommands(cached);
        setCommandsState("ready");
      } else {
        setLocalCommands([...HOST_SLASH_COMMANDS]);
        setCommandsState("error");
      }
    }
  }, [activeSessionId, commandsBySession, loadAvailableCommands]);

  useEffect(() => {
    if (tab !== "commands") return;
    void reloadCommands();
  }, [tab, reloadCommands]);

  const skills = useMemo(
    () => filterItems(snapshot.skills, query),
    [snapshot.skills, query],
  );
  const mcpServers = useMemo(
    () => filterItems(snapshot.mcpServers, query),
    [snapshot.mcpServers, query],
  );
  const agents = useMemo(
    () => filterItems(snapshot.agents, query),
    [snapshot.agents, query],
  );

  const commands = useMemo(() => {
    if (!activeSessionId) return [] as SlashCommand[];
    const list =
      localCommands ??
      commandsBySession[activeSessionId] ??
      HOST_SLASH_COMMANDS;
    return filterCommands(list, query);
  }, [activeSessionId, localCommands, commandsBySession, query]);

  const itemCount = (id: CatalogTab): number | null => {
    if (id === "skills") return snapshot.skills.length;
    if (id === "mcp") return snapshot.mcpServers.length;
    if (id === "agents") return snapshot.agents.length;
    if (id === "commands" && activeSessionId) {
      return (
        localCommands?.length ??
        commandsBySession[activeSessionId]?.length ??
        null
      );
    }
    return null;
  };

  return (
    <div className="catalog-panel">
      <div className="catalog-panel__tabs" role="tablist" aria-label="Catalog views">
        {TABS.map((entry) => {
          const count = itemCount(entry.id);
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`catalog-tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`catalog-tabpanel-${entry.id}`}
              className={`catalog-panel__tab${tab === entry.id ? " is-active" : ""}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {count !== null ? (
                <span className="catalog-panel__count">{count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="catalog-panel__toolbar">
        <label className="onboard-field catalog-panel__filter">
          <span>Filter</span>
          <input
            value={query}
            placeholder={
              tab === "commands"
                ? "compact, export, …"
                : "name, source, detail…"
            }
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="panel-button"
          onClick={() => {
            if (tab === "commands") void reloadCommands();
            else void reloadCatalog();
          }}
          disabled={
            tab === "commands"
              ? commandsState === "loading" || !activeSessionId
              : catalogState === "loading"
          }
        >
          Refresh
        </button>
      </div>

      {catalogState === "error" && tab !== "commands" ? (
        <p className="panel-feedback panel-feedback--error">
          {catalogError ?? "Unable to load catalog"}
        </p>
      ) : null}

      {tab !== "commands" && snapshot.notes.length > 0 ? (
        <ul className="catalog-panel__notes" aria-label="Catalog notes">
          {snapshot.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <div
        className="catalog-panel__tabpanel"
        role="tabpanel"
        id={`catalog-tabpanel-${tab}`}
        aria-labelledby={`catalog-tab-${tab}`}
      >
        {tab === "skills" ? (
          catalogState === "loading" && snapshot.skills.length === 0 ? (
            <EmptyState>Scanning local skills…</EmptyState>
          ) : skills.length === 0 ? (
            <EmptyState>
              No skills found under ~/.omp/agent/skills or ~/.agents/skills.
            </EmptyState>
          ) : (
            <ul className="catalog-list" aria-label="Skills">
              {skills.map((item) => (
                <CatalogRow key={item.id} item={item} kind="skill" />
              ))}
            </ul>
          )
        ) : null}

        {tab === "mcp" ? (
          catalogState === "loading" && snapshot.mcpServers.length === 0 ? (
            <EmptyState>Scanning MCP configs…</EmptyState>
          ) : mcpServers.length === 0 ? (
            <EmptyState>
              No MCP servers in ~/.omp/agent/mcp.json or project .mcp.json.
            </EmptyState>
          ) : (
            <ul className="catalog-list" aria-label="MCP servers">
              {mcpServers.map((item) => (
                <CatalogRow key={item.id} item={item} kind="mcp" />
              ))}
            </ul>
          )
        ) : null}

        {tab === "agents" ? (
          catalogState === "loading" && snapshot.agents.length === 0 ? (
            <EmptyState>Scanning agent definitions…</EmptyState>
          ) : agents.length === 0 ? (
            <EmptyState>
              No task agents in ~/.omp/agent/agents or project .omp/agents.
            </EmptyState>
          ) : (
            <ul className="catalog-list" aria-label="Agents">
              {agents.map((item) => (
                <CatalogRow key={item.id} item={item} kind="agent" />
              ))}
            </ul>
          )
        ) : null}

        {tab === "commands" ? (
          !activeSessionId ? (
            <EmptyState>
              Open a session to list live slash commands from OMP.
            </EmptyState>
          ) : commandsState === "loading" && commands.length === 0 ? (
            <EmptyState>Loading available commands…</EmptyState>
          ) : commands.length === 0 ? (
            <EmptyState>No commands reported for this session.</EmptyState>
          ) : (
            <ul className="catalog-list" aria-label="Slash commands">
              {commands.map((cmd) => (
                <li key={cmd.name} className="catalog-row">
                  <div className="catalog-row__body">
                    <strong className="catalog-row__name">/{cmd.name}</strong>
                    <span className="catalog-row__source">
                      {cmd.source ?? "omp"}
                    </span>
                    {cmd.description ? (
                      <span className="catalog-row__detail">
                        {cmd.description}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
};

const CatalogRow = ({
  item,
  kind,
}: {
  item: CatalogItem;
  kind: "skill" | "mcp" | "agent";
}) => (
  <li className={`catalog-row catalog-row--${kind}`}>
    <div className="catalog-row__body">
      <strong className="catalog-row__name">{item.name}</strong>
      <span className="catalog-row__source">{item.source}</span>
      {item.detail ? (
        <span className="catalog-row__detail">{item.detail}</span>
      ) : null}
    </div>
  </li>
);
