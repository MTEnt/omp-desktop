import { useCallback, useEffect, useState, type FormEvent } from "react";

import { api } from "../lib/tauri.ts";
import {
  normalizeLoginProviders,
  type LoginProvider,
} from "../session/providers.ts";
import { useSessionStore } from "../session/session-store.ts";
import type { AppSettings, ApprovalMode } from "../session/types.ts";

const defaultSettings: AppSettings = {
  approvalMode: "write",
  ompBinary: null,
  defaultModel: null,
  defaultThinking: null,
  defaultProfile: null,
  theme: "dark",
  onboardingCompleted: false,
};

const optionalValue = (value: string): string | null => value.trim() || null;

export const SettingsPanel = () => {
  const settings = useSessionStore((state) => state.settings);
  const loadSettings = useSessionStore((state) => state.loadSettings);
  const saveSettings = useSessionStore((state) => state.saveSettings);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const [form, setForm] = useState<AppSettings>(settings ?? defaultSettings);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [providers, setProviders] = useState<LoginProvider[]>([]);
  const [providersState, setProvidersState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [signingInId, setSigningInId] = useState<string | null>(null);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const loadProviders = useCallback(async (sessionId: string) => {
    setProvidersState("loading");
    setProvidersError(null);
    try {
      const raw = await api.getLoginProviders(sessionId);
      setProviders(normalizeLoginProviders(raw));
      setProvidersState("ready");
    } catch (error) {
      setProviders([]);
      setProvidersState("error");
      setProvidersError(
        error instanceof Error ? error.message : "Unable to load login providers",
      );
    }
  }, []);

  useEffect(() => {
    setLoginMessage(null);
    setSigningInId(null);
    if (!activeSessionId) {
      setProviders([]);
      setProvidersState("idle");
      setProvidersError(null);
      return;
    }
    void loadProviders(activeSessionId);
  }, [activeSessionId, loadProviders]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveState("saving");
    const didSave = await saveSettings({
      ...form,
      ompBinary: optionalValue(form.ompBinary ?? ""),
      defaultModel: optionalValue(form.defaultModel ?? ""),
      defaultThinking: optionalValue(form.defaultThinking ?? ""),
      defaultProfile: optionalValue(form.defaultProfile ?? ""),
      onboardingCompleted: form.onboardingCompleted ?? settings?.onboardingCompleted ?? true,
    });
    setSaveState(didSave ? "saved" : "error");
  };

  const signIn = async (providerId: string) => {
    if (!activeSessionId) return;
    setSigningInId(providerId);
    setLoginMessage(null);
    try {
      await api.loginProvider(activeSessionId, providerId);
      setLoginMessage("Sign-in started — complete auth in your browser if prompted.");
      await loadProviders(activeSessionId);
    } catch (error) {
      setLoginMessage(
        error instanceof Error ? error.message : "Sign-in failed",
      );
    } finally {
      setSigningInId(null);
    }
  };

  return (
    <form className="settings-form" onSubmit={(event) => void submit(event)}>
      <label className="panel-field">
        <span>Approval mode</span>
        <select
          value={form.approvalMode}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              approvalMode: event.target.value as ApprovalMode,
            }))
          }
        >
          <option value="write">Write — ask before commands (recommended)</option>
          <option value="alwaysAsk">Always ask — ask before writes and commands</option>
          <option value="yolo">Yolo — approve every tool</option>
        </select>
      </label>

      <label className="panel-field">
        <span>OMP binary</span>
        <input
          type="text"
          value={form.ompBinary ?? ""}
          placeholder="Use omp from PATH"
          spellCheck={false}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              ompBinary: event.target.value,
            }))
          }
        />
      </label>

      <label className="panel-field">
        <span>Default model</span>
        <input
          type="text"
          value={form.defaultModel ?? ""}
          placeholder="OMP default"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              defaultModel: event.target.value,
            }))
          }
        />
      </label>

      <label className="panel-field">
        <span>Default thinking</span>
        <input
          type="text"
          value={form.defaultThinking ?? ""}
          placeholder="OMP default"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              defaultThinking: event.target.value,
            }))
          }
        />
      </label>

      <label className="panel-field">
        <span>Default profile</span>
        <input
          type="text"
          value={form.defaultProfile ?? ""}
          placeholder="OMP default"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              defaultProfile: event.target.value,
            }))
          }
        />
      </label>

      <label className="panel-field">
        <span>Theme</span>
        <select
          value={form.theme}
          onChange={(event) =>
            setForm((current) => ({ ...current, theme: event.target.value }))
          }
        >
          <option value="dark">Dark</option>
          <option value="system">System</option>
          <option value="light">Light</option>
        </select>
      </label>

      <section className="settings-providers" aria-label="Provider login">
        <div className="settings-providers__header">
          <div>
            <h3>Provider login</h3>
            <p>Authenticate model providers through the active OMP session.</p>
          </div>
          <button
            type="button"
            className="panel-button"
            disabled={!activeSessionId || providersState === "loading"}
            onClick={() => {
              if (activeSessionId) void loadProviders(activeSessionId);
            }}
          >
            {providersState === "loading" ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {!activeSessionId ? (
          <p className="panel-feedback">Open a session to manage provider login</p>
        ) : providersState === "error" ? (
          <p className="panel-feedback panel-feedback--error">
            {providersError ?? "Unable to load login providers"}
          </p>
        ) : providersState === "loading" && providers.length === 0 ? (
          <p className="panel-feedback">Loading providers…</p>
        ) : providers.length === 0 ? (
          <p className="panel-feedback">No login providers reported by this session.</p>
        ) : (
          <ul className="settings-providers__list">
            {providers.map((provider) => {
              const authenticated = provider.authenticated === true;
              return (
                <li key={provider.id} className="settings-providers__row">
                  <div className="settings-providers__meta">
                    <strong>{provider.name}</strong>
                    <span
                      className={
                        authenticated
                          ? "settings-providers__badge settings-providers__badge--ok"
                          : "settings-providers__badge"
                      }
                    >
                      {authenticated ? "Signed in" : "Not signed in"}
                    </span>
                    {provider.detail ? (
                      <span className="settings-providers__detail">{provider.detail}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="panel-button"
                    disabled={signingInId !== null}
                    onClick={() => void signIn(provider.id)}
                  >
                    {signingInId === provider.id
                      ? "Starting…"
                      : authenticated
                        ? "Re-auth"
                        : "Sign in"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {loginMessage ? (
          <p
            className={
              loginMessage.toLowerCase().includes("fail")
                ? "panel-feedback panel-feedback--error"
                : "panel-feedback"
            }
          >
            {loginMessage}
          </p>
        ) : null}
      </section>

      <div className="settings-form__actions">
        <button
          type="button"
          className="panel-button"
          onClick={() =>
            void saveSettings({
              ...form,
              onboardingCompleted: false,
            }).then((ok) => {
              if (ok) window.location.reload();
            })
          }
        >
          Replay first-launch walkthrough
        </button>
      </div>

      <div className="settings-form__footer">
        <button
          type="submit"
          className="panel-button panel-button--primary"
          disabled={saveState === "saving"}
        >
          {saveState === "saving" ? "Saving…" : "Save settings"}
        </button>
        {saveState === "saved" && <span>Saved for the next session</span>}
      </div>
      {saveState === "error" && (
        <p className="panel-feedback panel-feedback--error">
          Settings could not be saved.
        </p>
      )}
    </form>
  );
};
