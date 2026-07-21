import { open as openShell } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api, isTauriRuntime } from "../lib/tauri.ts";
import type { AppSettings, ApprovalMode, SetupStatus } from "../session/types.ts";
import { useSessionStore } from "../session/session-store.ts";
import { PixelPieLogo } from "./pixel-pie-logo.tsx";

type StepId =
  | "welcome"
  | "omp"
  | "impeccable"
  | "preferences"
  | "ready";

const STEPS: StepId[] = [
  "welcome",
  "omp",
  "impeccable",
  "preferences",
  "ready",
];

const stepMeta: Record<
  StepId,
  { eyebrow: string; title: string; body: string }
> = {
  welcome: {
    eyebrow: "Welcome",
    title: "OMP Desktop cockpit",
    body: "A short setup so agents, tools, and design defaults are ready before your first session.",
  },
  omp: {
    eyebrow: "Runtime",
    title: "Find the OMP CLI",
    body: "Desktop hosts real omp --mode rpc sessions. The omp binary must be on PATH or set explicitly.",
  },
  impeccable: {
    eyebrow: "Design standard",
    title: "Turn on Impeccable",
    body: "Impeccable is the default UI craft system for agents (https://impeccable.style/docs/). Install once into your harness so every session follows it.",
  },
  preferences: {
    eyebrow: "Preferences",
    title: "Session defaults",
    body: "Pick how aggressive tool approval should be. You can change this later in Settings.",
  },
  ready: {
    eyebrow: "Ready",
    title: "Open a folder and go",
    body: "Start a session with Open folder (or ⌘O from the palette). Agents will load OMP tools plus Impeccable for UI work.",
  },
};

const emptyStatus = (): SetupStatus => ({
  ompFound: false,
  ompPath: null,
  ompVersion: null,
  impeccableSkillPresent: false,
  impeccableSkillPath: null,
  impeccableRulesPresent: false,
  onboardingCompleted: false,
  homeDir: null,
});

export const OnboardingWalkthrough = () => {
  const settings = useSessionStore((state) => state.settings);
  const saveSettings = useSessionStore((state) => state.saveSettings);
  const openFolder = useSessionStore((state) => state.openFolder);

  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(
    settings?.approvalMode ?? "write",
  );
  const [ompBinary, setOmpBinary] = useState(settings?.ompBinary ?? "");

  const stepId = STEPS[stepIndex] ?? "welcome";
  const meta = stepMeta[stepId];

  const refreshStatus = useCallback(async () => {
    if (!isTauriRuntime()) {
      setStatus(emptyStatus());
      return;
    }
    try {
      const next = await api.getSetupStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!settings) return;
    setApprovalMode(settings.approvalMode);
    setOmpBinary(settings.ompBinary ?? "");
    // Fresh installs default onboardingCompleted=false.
    // Legacy settings missing the field are loaded as true on the Rust side.
    if (settings.onboardingCompleted === false) {
      setOpen(true);
      void refreshStatus();
    } else {
      setOpen(false);
    }
  }, [settings, refreshStatus]);

  const progressLabel = useMemo(
    () => `${stepIndex + 1} / ${STEPS.length}`,
    [stepIndex],
  );

  if (!open) return null;

  const persistPartial = async (patch: Partial<AppSettings>) => {
    const base: AppSettings = {
      approvalMode,
      ompBinary: ompBinary.trim() || null,
      defaultModel: settings?.defaultModel ?? null,
      defaultThinking: settings?.defaultThinking ?? null,
      defaultProfile: settings?.defaultProfile ?? null,
      theme: settings?.theme ?? "dark",
      onboardingCompleted: settings?.onboardingCompleted ?? false,
      ...patch,
    };
    const ok = await saveSettings(base);
    if (!ok) throw new Error("Could not save settings");
  };

  const finish = async (andOpenFolder: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await persistPartial({
        approvalMode,
        ompBinary: ompBinary.trim() || null,
        onboardingCompleted: true,
      });
      setOpen(false);
      if (andOpenFolder) {
        await openFolder();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const installImpeccable = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.installImpeccable();
      setStatus(next);
      if (!next.impeccableSkillPresent) {
        throw new Error("Install finished but skill was not detected");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  };

  const openDocs = async () => {
    try {
      if (isTauriRuntime()) {
        await openShell("https://impeccable.style/docs/");
      } else {
        window.open("https://impeccable.style/docs/", "_blank", "noopener");
      }
    } catch {
      window.open("https://impeccable.style/docs/", "_blank", "noopener");
    }
  };

  const next = async () => {
    setError(null);
    if (stepId === "omp") {
      setBusy(true);
      try {
        await persistPartial({
          ompBinary: ompBinary.trim() || null,
          approvalMode,
        });
        await refreshStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
        return;
      } finally {
        setBusy(false);
      }
    }
    if (stepId === "preferences") {
      setBusy(true);
      try {
        await persistPartial({ approvalMode, ompBinary: ompBinary.trim() || null });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
        return;
      } finally {
        setBusy(false);
      }
    }
    if (stepIndex >= STEPS.length - 1) {
      await finish(false);
      return;
    }
    setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
  };

  const back = () => {
    setError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const statusChip = (ok: boolean, label: string) => (
    <span className={`onboard-chip ${ok ? "onboard-chip--ok" : "onboard-chip--warn"}`}>
      <span className="onboard-chip__dot" aria-hidden />
      {label}
    </span>
  );

  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="onboard__backdrop" />
      <div className="onboard__card">
        <header className="onboard__header">
          <div className="onboard__brand">
            <PixelPieLogo size={28} />
            <div>
              <div className="onboard__eyebrow">{meta.eyebrow}</div>
              <h1 id="onboard-title">{meta.title}</h1>
            </div>
          </div>
          <div className="onboard__progress" aria-label="Walkthrough progress">
            {STEPS.map((id, index) => (
              <span
                key={id}
                className={`onboard__pip${index === stepIndex ? " is-active" : ""}${index < stepIndex ? " is-done" : ""}`}
              />
            ))}
            <span className="onboard__count">{progressLabel}</span>
          </div>
        </header>

        <p className="onboard__body">{meta.body}</p>

        <div className="onboard__content">
          {stepId === "welcome" && (
            <ul className="onboard-list">
              <li>Connect the OMP runtime used for real agent sessions</li>
              <li>Install Impeccable so UI work follows a strong default craft bar</li>
              <li>Set approval defaults, then open your first project folder</li>
            </ul>
          )}

          {stepId === "omp" && (
            <div className="onboard-panel">
              <div className="onboard-status-row">
                {statusChip(
                  !!status?.ompFound,
                  status?.ompFound
                    ? `OMP ready${status.ompVersion ? ` · ${status.ompVersion}` : ""}`
                    : "OMP not found on PATH",
                )}
              </div>
              {status?.ompPath ? (
                <p className="onboard-muted">Detected: {status.ompPath}</p>
              ) : (
                <p className="onboard-muted">
                  Install OMP globally (`npm/bun install -g @oh-my-pi/pi-coding-agent` or your usual path), then refresh.
                </p>
              )}
              <label className="onboard-field">
                <span>OMP binary path (optional override)</span>
                <input
                  value={ompBinary}
                  spellCheck={false}
                  placeholder="/path/to/omp"
                  onChange={(event) => setOmpBinary(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="panel-button"
                disabled={busy}
                onClick={() => void refreshStatus()}
              >
                Recheck
              </button>
            </div>
          )}

          {stepId === "impeccable" && (
            <div className="onboard-panel">
              <div className="onboard-status-row">
                {statusChip(
                  !!status?.impeccableSkillPresent,
                  status?.impeccableSkillPresent
                    ? "Impeccable skill installed"
                    : "Impeccable skill missing",
                )}
                {statusChip(
                  !!status?.impeccableRulesPresent,
                  status?.impeccableRulesPresent
                    ? "Harness rules enabled"
                    : "Harness rules not set",
                )}
              </div>
              {status?.impeccableSkillPath ? (
                <p className="onboard-muted">Skill: {status.impeccableSkillPath}</p>
              ) : (
                <p className="onboard-muted">
                  One click installs the skill into `~/.agents/skills`, links it into
                  `~/.omp/agent/skills`, and writes sticky Impeccable rules.
                </p>
              )}
              <div className="onboard-actions">
                <button
                  type="button"
                  className="panel-button panel-button--primary"
                  disabled={busy || !!status?.impeccableSkillPresent}
                  onClick={() => void installImpeccable()}
                >
                  {busy
                    ? "Installing…"
                    : status?.impeccableSkillPresent
                      ? "Installed"
                      : "Install Impeccable"}
                </button>
                <button
                  type="button"
                  className="panel-button"
                  disabled={busy}
                  onClick={() => void refreshStatus()}
                >
                  Recheck
                </button>
                <button type="button" className="panel-button" onClick={() => void openDocs()}>
                  Open docs
                </button>
              </div>
              <p className="onboard-note">
                Requires Node.js/npm once for `npx impeccable install`. You can skip and install later
                from Settings → replay walkthrough.
              </p>
            </div>
          )}

          {stepId === "preferences" && (
            <div className="onboard-panel">
              <label className="onboard-field">
                <span>Approval mode</span>
                <select
                  value={approvalMode}
                  onChange={(event) =>
                    setApprovalMode(event.target.value as ApprovalMode)
                  }
                >
                  <option value="write">Write — ask before commands (recommended)</option>
                  <option value="alwaysAsk">Always ask — ask before writes and commands</option>
                  <option value="yolo">Yolo — approve every tool</option>
                </select>
              </label>
              <p className="onboard-muted">
                Write is the safe default: OMP reads and edits normally, then asks before it runs
                commands. Choose Always ask to gate edits too.
              </p>
            </div>
          )}

          {stepId === "ready" && (
            <div className="onboard-panel">
              <ul className="onboard-checklist">
                <li className={status?.ompFound ? "is-ok" : "is-warn"}>
                  OMP runtime {status?.ompFound ? "ready" : "missing — set path in Settings"}
                </li>
                <li className={status?.impeccableSkillPresent ? "is-ok" : "is-warn"}>
                  Impeccable {status?.impeccableSkillPresent ? "enabled" : "not installed (optional)"}
                </li>
                <li className="is-ok">Approval mode: {approvalMode}</li>
              </ul>
            </div>
          )}
        </div>

        {error ? <p className="onboard-error">{error}</p> : null}

        <footer className="onboard__footer">
          <button
            type="button"
            className="panel-button"
            disabled={busy || stepIndex === 0}
            onClick={back}
          >
            Back
          </button>
          <div className="onboard__footer-right">
            {stepId !== "ready" ? (
              <button
                type="button"
                className="panel-button"
                disabled={busy}
                onClick={() => void finish(false)}
              >
                Skip setup
              </button>
            ) : null}
            {stepId === "ready" ? (
              <>
                <button
                  type="button"
                  className="panel-button"
                  disabled={busy}
                  onClick={() => void finish(false)}
                >
                  Enter app
                </button>
                <button
                  type="button"
                  className="panel-button panel-button--primary"
                  disabled={busy}
                  onClick={() => void finish(true)}
                >
                  Open folder
                </button>
              </>
            ) : (
              <button
                type="button"
                className="panel-button panel-button--primary"
                disabled={busy}
                onClick={() => void next()}
              >
                Continue
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};
