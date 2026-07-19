import { useEffect, useMemo, useState } from "react";

import { api, isTauriRuntime } from "../lib/tauri.ts";
import type { RemoteTarget, SshHostInfo, SshProbeResult } from "../session/types.ts";
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
  const [selectedName, setSelectedName] = useState<string>("");
  const [remoteCwd, setRemoteCwd] = useState("~");
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<SshProbeResult | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const selected = useMemo(
    () => hosts.find((host) => host.name === selectedName) ?? null,
    [hosts, selectedName],
  );

  const refresh = async () => {
    if (!isTauriRuntime()) {
      setError("SSH connect requires the native OMP Desktop window.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await api.listSshHosts();
      setHosts(next);
      if (!selectedName && next[0]) setSelectedName(next[0].name);
      if (selectedName && !next.some((h) => h.name === selectedName)) {
        setSelectedName(next[0]?.name ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setProbe(null);
    setError(null);
    void refresh();
  }, [open]);

  if (!open) return null;

  const buildTarget = (): RemoteTarget | null => {
    if (!selected) return null;
    return {
      hostName: selected.name,
      host: selected.host,
      user: selected.user ?? null,
      port: selected.port ?? null,
      keyPath: selected.keyPath ?? null,
      remoteCwd: remoteCwd.trim() || "~",
    };
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
      // Prefer last successful probe cwd if host unchanged.
      if (probe?.ok && probe.remoteCwd) {
        target.remoteCwd = probe.remoteCwd;
      }
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
      if (form.port.trim() && (!Number.isInteger(port) || (port ?? 0) < 1 || (port ?? 0) > 65535)) {
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
    <div className="onboard ssh-modal" role="dialog" aria-modal="true" aria-labelledby="ssh-modal-title">
      <button type="button" className="onboard__backdrop" aria-label="Close" onClick={onClose} />
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
          Open an OMP session against a remote folder. Uses your SSH keys/agent and OMP host config
          (`~/.omp/agent/ssh.json` + `~/.ssh/config`).
        </p>

        <div className="ssh-modal__grid">
          <section className="ssh-modal__hosts">
            <div className="ssh-modal__section-head">
              <h2>Hosts</h2>
              <div className="onboard-actions">
                <button type="button" className="panel-button" disabled={loading} onClick={() => void refresh()}>
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
                    placeholder="10.0.0.12 or bastion.example.com"
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
                <button type="button" className="panel-button panel-button--primary" disabled={loading} onClick={() => void onAdd()}>
                  Save host
                </button>
              </div>
            ) : null}

            <div className="ssh-host-list" role="listbox" aria-label="SSH hosts">
              {hosts.length === 0 ? (
                <p className="onboard-muted">No hosts yet. Add one or ensure `~/.ssh/config` has Host entries.</p>
              ) : (
                hosts.map((host) => {
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
                        setError(null);
                      }}
                    >
                      <strong>{host.name}</strong>
                      <span>
                        {(host.user ? `${host.user}@` : "") + host.host}
                        {host.port ? `:${host.port}` : ""}
                      </span>
                      <em>{host.source}{host.scope ? ` · ${host.scope}` : ""}</em>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="ssh-modal__details">
            <h2>Remote folder</h2>
            <label className="onboard-field">
              <span>Path on remote</span>
              <input
                value={remoteCwd}
                spellCheck={false}
                placeholder="~ or /var/www/app"
                onChange={(e) => {
                  setRemoteCwd(e.target.value);
                  setProbe(null);
                }}
              />
            </label>

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
            ) : (
              <p className="onboard-muted">Select a host to continue.</p>
            )}

            {probe ? (
              <p className={`ssh-probe ${probe.ok ? "is-ok" : "is-bad"}`}>{probe.message}</p>
            ) : null}

            {error ? <p className="onboard-error">{error}</p> : null}

            <div className="onboard-actions">
              <button
                type="button"
                className="panel-button"
                disabled={!selected || probing || connecting}
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

            <p className="onboard-note">
              Connect probes with ssh (BatchMode, 8s timeout), then starts an OMP RPC session
              primed for ssh://host/... remote file work. Local terminal stays local in v1.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
