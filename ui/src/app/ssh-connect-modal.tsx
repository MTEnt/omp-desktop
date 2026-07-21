import { useCallback, useEffect, useMemo, useState } from "react";

import { api, isTauriRuntime } from "../lib/tauri.ts";
import type {
  RemoteDirListing,
  RemoteTarget,
  SshHostInfo,
  SshProbeResult,
  SshRecent,
} from "../session/types.ts";
import { useSessionStore } from "../session/session-store.ts";

interface SshConnectModalProps {
  open: boolean;
  onClose: () => void;
}

const emptyForm = {
  name: "",
  host: "",
  user: "",
  port: "",
  keyPath: "",
  description: "",
};

export const SshConnectModal = ({ open, onClose }: SshConnectModalProps) => {
  const openSshSession = useSessionStore((state) => state.openSshSession);
  const [hosts, setHosts] = useState<SshHostInfo[]>([]);
  const [recents, setRecents] = useState<SshRecent[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [remoteCwd, setRemoteCwd] = useState("~");
  const [listing, setListing] = useState<RemoteDirListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [probing, setProbing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<SshProbeResult | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [hostQuery, setHostQuery] = useState("");
  const [form, setForm] = useState(emptyForm);

  const selected = useMemo(
    () => hosts.find((host) => host.name === selectedName) ?? null,
    [hosts, selectedName],
  );

  const filteredHosts = useMemo(() => {
    const q = hostQuery.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((host) => {
      const hay = `${host.name} ${host.host} ${host.user ?? ""} ${host.description ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [hosts, hostQuery]);

  const buildTarget = (cwd = remoteCwd): RemoteTarget | null => {
    if (!selected) return null;
    return {
      hostName: selected.name,
      host: selected.host,
      user: selected.user ?? null,
      port: selected.port ?? null,
      keyPath: selected.keyPath ?? null,
      remoteCwd: cwd.trim() || "~",
    };
  };

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) {
      setError("SSH connect requires the native OMP Desktop window.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextHosts, nextRecents] = await Promise.all([
        api.listSshHosts(),
        api.listSshRecents().catch(() => [] as SshRecent[]),
      ]);
      setHosts(nextHosts);
      setRecents(nextRecents);
      setSelectedName((current) => {
        if (!current || !nextHosts.some((host) => host.name === current)) {
          return nextHosts[0]?.name ?? "";
        }
        return current;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setProbe(null);
    setListing(null);
    setError(null);
    void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const applyRecent = (recent: SshRecent) => {
    setSelectedName(recent.hostName);
    setRemoteCwd(recent.remoteCwd);
    setProbe(null);
    setListing(null);
    setError(null);
    // If host only exists in recents, synthesize into list display by selection name;
    // connect still uses fields from hosts if present, else recent fields.
    if (!hosts.some((h) => h.name === recent.hostName)) {
      setHosts((current) => [
        {
          name: recent.hostName,
          host: recent.host,
          user: recent.user,
          port: recent.port,
          keyPath: recent.keyPath,
          description: "recent",
          source: "recent",
          scope: null,
        },
        ...current,
      ]);
    }
  };

  const onBrowse = async (path?: string) => {
    const target = buildTarget(path ?? remoteCwd);
    if (!target) {
      setError("Select a host first.");
      return;
    }
    setBrowsing(true);
    setError(null);
    try {
      const result = await api.listRemoteDir(target, path ?? target.remoteCwd);
      setListing(result);
      setRemoteCwd(result.path);
      setProbe({
        ok: true,
        message: `Browsing ${result.path}`,
        remoteCwd: result.path,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrowsing(false);
    }
  };

  const onTest = async () => {
    const target = buildTarget();
    if (!target) {
      setError("Select a host first.");
      return;
    }
    setProbing(true);
    setError(null);
    setProbe(null);
    try {
      const result = await api.testSshConnection(target);
      setProbe(result);
      if (result.ok && result.remoteCwd) {
        setRemoteCwd(result.remoteCwd);
        void onBrowse(result.remoteCwd);
      }
      if (!result.ok) setError(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProbing(false);
    }
  };

  const onConnect = async () => {
    const target = buildTarget();
    if (!target) {
      setError("Select a host first.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      if (probe?.ok && probe.remoteCwd) target.remoteCwd = probe.remoteCwd;
      else if (listing?.path) target.remoteCwd = listing.path;
      await openSshSession(target);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  const onAdd = async () => {
    if (!form.name.trim() || !form.host.trim()) {
      setError("Name and host are required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const port = form.port.trim() ? Number(form.port) : null;
      if (
        form.port.trim() &&
        (!Number.isInteger(port) || (port ?? 0) < 1 || (port ?? 0) > 65535)
      ) {
        throw new Error("Port must be an integer 1–65535.");
      }
      const created = await api.addSshHost({
        name: form.name.trim(),
        host: form.host.trim(),
        user: form.user.trim() || null,
        port,
        keyPath: form.keyPath.trim() || null,
        description: form.description.trim() || null,
      });
      setForm(emptyForm);
      setShowAdd(false);
      await refresh();
      setSelectedName(created.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="onboard ssh-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ssh-modal-title"
    >
      <button
        type="button"
        className="onboard__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="onboard__card ssh-modal__card">
        <header className="onboard__header">
          <div>
            <div className="onboard__eyebrow">Remote</div>
            <h1 id="ssh-modal-title">Connect via SSH</h1>
          </div>
          <button type="button" className="panel-button" onClick={onClose}>
            Close
          </button>
        </header>

        <p className="onboard__body">
          Hosts load from this machine automatically. Pick a host, browse to a
          remote folder, connect. Terminal opens on the remote host.
        </p>

        {recents.length > 0 ? (
          <section className="ssh-recents" aria-label="Recent remote folders">
            <h2>Recent</h2>
            <div className="ssh-recents__list">
              {recents.map((recent) => (
                <button
                  key={`${recent.hostName}:${recent.remoteCwd}:${recent.lastUsedMs}`}
                  type="button"
                  className="ssh-recent"
                  onClick={() => applyRecent(recent)}
                  title={recent.label}
                >
                  <strong>{recent.hostName}</strong>
                  <span>{recent.remoteCwd}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className="ssh-modal__grid">
          <section className="ssh-modal__hosts">
            <div className="ssh-modal__section-head">
              <h2>Hosts</h2>
              <div className="onboard-actions">
                <button
                  type="button"
                  className="panel-button"
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="panel-button"
                  onClick={() => setShowAdd((value) => !value)}
                >
                  {showAdd ? "Cancel add" : "Add host"}
                </button>
              </div>
            </div>

            <label className="onboard-field">
              <span>Filter</span>
              <input
                value={hostQuery}
                placeholder="Search hosts"
                onChange={(e) => setHostQuery(e.target.value)}
              />
            </label>

            {showAdd ? (
              <div className="ssh-modal__add">
                <label className="onboard-field">
                  <span>Name</span>
                  <input
                    value={form.name}
                    placeholder="prod-api"
                    spellCheck={false}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </label>
                <label className="onboard-field">
                  <span>Host</span>
                  <input
                    value={form.host}
                    placeholder="10.0.0.12"
                    spellCheck={false}
                    onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                  />
                </label>
                <div className="ssh-modal__row">
                  <label className="onboard-field">
                    <span>User</span>
                    <input
                      value={form.user}
                      placeholder="ubuntu"
                      spellCheck={false}
                      onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
                    />
                  </label>
                  <label className="onboard-field">
                    <span>Port</span>
                    <input
                      value={form.port}
                      placeholder="22"
                      spellCheck={false}
                      onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                    />
                  </label>
                </div>
                <label className="onboard-field">
                  <span>Identity file (optional)</span>
                  <input
                    value={form.keyPath}
                    placeholder="~/.ssh/id_ed25519"
                    spellCheck={false}
                    onChange={(e) => setForm((f) => ({ ...f, keyPath: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  className="panel-button panel-button--primary"
                  disabled={loading}
                  onClick={() => void onAdd()}
                >
                  Save host
                </button>
              </div>
            ) : null}

            <div className="ssh-host-list" role="listbox" aria-label="SSH hosts">
              {filteredHosts.length === 0 ? (
                <p className="onboard-muted">
                  No hosts found. Check ~/.ssh/config or add one.
                </p>
              ) : (
                filteredHosts.map((host) => {
                  const active = host.name === selectedName;
                  return (
                    <button
                      key={`${host.source}:${host.name}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`ssh-host${active ? " is-active" : ""}`}
                      onClick={() => {
                        setSelectedName(host.name);
                        setProbe(null);
                        setListing(null);
                        setError(null);
                      }}
                    >
                      <strong>{host.name}</strong>
                      <span>
                        {(host.user ? `${host.user}@` : "") + host.host}
                        {host.port ? `:${host.port}` : ""}
                      </span>
                      <em>
                        {host.source}
                        {host.scope ? ` · ${host.scope}` : ""}
                      </em>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="ssh-modal__details">
            <h2>Remote folder</h2>
            <label className="onboard-field">
              <span>Path</span>
              <div className="ssh-modal__path-row">
                <input
                  value={remoteCwd}
                  spellCheck={false}
                  placeholder="~ or /var/www/app"
                  onChange={(e) => {
                    setRemoteCwd(e.target.value);
                    setProbe(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void onBrowse(remoteCwd);
                    }
                  }}
                />
                <button
                  type="button"
                  className="panel-button"
                  disabled={!selected || browsing}
                  onClick={() => void onBrowse(remoteCwd)}
                >
                  {browsing ? "…" : "List"}
                </button>
              </div>
            </label>

            {listing ? (
              <div className="ssh-browser" aria-label="Remote directory">
                <div className="ssh-browser__bar">
                  <button
                    type="button"
                    className="panel-button"
                    disabled={!listing.parent || browsing}
                    onClick={() => listing.parent && void onBrowse(listing.parent)}
                  >
                    Up
                  </button>
                  <code title={listing.path}>{listing.path}</code>
                </div>
                <div className="ssh-browser__entries">
                  {listing.entries.length === 0 ? (
                    <p className="onboard-muted">Empty directory</p>
                  ) : (
                    listing.entries.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        className={`ssh-browser__entry${entry.isDir ? " is-dir" : ""}`}
                        disabled={!entry.isDir || browsing}
                        onClick={() => {
                          if (!entry.isDir) return;
                          void onBrowse(entry.path);
                        }}
                        title={entry.path}
                      >
                        <span aria-hidden>{entry.isDir ? "📁" : "📄"}</span>
                        <span>{entry.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <p className="onboard-muted">
                Choose a host, then List or Test to browse remote directories.
              </p>
            )}

            {selected ? (
              <div className="ssh-modal__summary">
                <div>
                  <span className="onboard-muted">Target</span>
                  <div>
                    {(selected.user ? `${selected.user}@` : "") + selected.host}
                    {selected.port ? `:${selected.port}` : ""}
                  </div>
                </div>
                <div>
                  <span className="onboard-muted">Folder</span>
                  <div>{remoteCwd || "~"}</div>
                </div>
              </div>
            ) : null}

            {probe ? (
              <p className={`ssh-probe ${probe.ok ? "is-ok" : "is-bad"}`}>
                {probe.message}
              </p>
            ) : null}

            {error ? <p className="onboard-error">{error}</p> : null}

            <div className="onboard-actions">
              <button
                type="button"
                className="panel-button"
                disabled={!selected || probing || connecting || browsing}
                onClick={() => void onTest()}
              >
                {probing ? "Testing…" : "Test connection"}
              </button>
              <button
                type="button"
                className="panel-button panel-button--primary"
                disabled={!selected || connecting || probing}
                onClick={() => void onConnect()}
              >
                {connecting ? "Connecting…" : "Connect"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
