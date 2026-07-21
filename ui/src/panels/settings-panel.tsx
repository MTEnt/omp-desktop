import { useEffect, useMemo, useState, type FormEvent } from "react";

import { api } from "../lib/tauri.ts";
import { useSessionStore } from "../session/session-store.ts";
import type {
  AppSettings,
  ApprovalMode,
  LoginProvider,
  ProviderKeyStatus,
} from "../session/types.ts";

const defaultSettings: AppSettings = {
  approvalMode: "write",
  ompBinary: null,
  defaultModel: null,
  defaultThinking: null,
  defaultProfile: null,
  theme: "dark",
  onboardingCompleted: false,
  modelRolePresets: [],
};

const optionalValue = (value: string): string | null => value.trim() || null;

export const SettingsPanel = () => {
  const settings = useSessionStore((state) => state.settings);
  const loadSettings = useSessionStore((state) => state.loadSettings);
  const saveSettings = useSessionStore((state) => state.saveSettings);
  const loadAvailableModels = useSessionStore((state) => state.loadAvailableModels);
  const [form, setForm] = useState<AppSettings>(settings ?? defaultSettings);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [providerKeys, setProviderKeys] = useState<ProviderKeyStatus[]>([]);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [keysToClear, setKeysToClear] = useState<Set<string>>(new Set());
  const [keysSaveState, setKeysSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [keysError, setKeysError] = useState<string | null>(null);
  const [loginProviders, setLoginProviders] = useState<LoginProvider[]>([]);
  const [loginQuery, setLoginQuery] = useState("");
  const [loginBusyId, setLoginBusyId] = useState<string | null>(null);
  const [loginStatus, setLoginStatus] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void api
      .getProviderKeys()
      .then((keys) => {
        if (!cancelled) setProviderKeys(keys);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setKeysError(error instanceof Error ? error.message : String(error));
        }
      });
    void api
      .listLoginProviders()
      .then((providers) => {
        if (!cancelled) setLoginProviders(providers);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoginError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredLoginProviders = useMemo(() => {
    const query = loginQuery.trim().toLowerCase();
    if (!query) return loginProviders;
    return loginProviders.filter((provider) => {
      const hay = `${provider.name} ${provider.id}`.toLowerCase();
      return hay.includes(query);
    });
  }, [loginProviders, loginQuery]);

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

  const saveProviderKeys = async () => {
    setKeysSaveState("saving");
    setKeysError(null);
    const updates = providerKeys.flatMap((key) => {
      if (keysToClear.has(key.name)) {
        return [{ name: key.name, clear: true }];
      }
      const draft = (keyDrafts[key.name] ?? "").trim();
      if (!draft) return [];
      return [{ name: key.name, value: draft, clear: false }];
    });

    try {
      const next = await api.saveProviderKeys(updates);
      setProviderKeys(next);
      setKeyDrafts({});
      setKeysToClear(new Set());
      setKeysSaveState("saved");
      void loadAvailableModels();
    } catch (error) {
      setKeysSaveState("error");
      setKeysError(error instanceof Error ? error.message : String(error));
    }
  };

  const signInProvider = async (providerId: string) => {
    setLoginBusyId(providerId);
    setLoginError(null);
    setLoginStatus(`Opening browser for ${providerId}…`);
    try {
      await api.loginProvider(providerId);
      setLoginStatus(`Signed in · ${providerId}`);
      void loadAvailableModels();
    } catch (error) {
      setLoginStatus(null);
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoginBusyId(null);
    }
  };

  const signOutProvider = async (providerId: string) => {
    setLoginBusyId(providerId);
    setLoginError(null);
    setLoginStatus(`Signing out · ${providerId}`);
    try {
      await api.logoutProvider(providerId);
      setLoginStatus(`Signed out · ${providerId}`);
      void loadAvailableModels();
    } catch (error) {
      setLoginStatus(null);
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoginBusyId(null);
    }
  };

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <header className="settings-section__head">
          <p className="eyebrow">Preferences</p>
          <p className="settings-section__blurb">
            Defaults for new sessions. Changes apply after save.
          </p>
        </header>

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
              <option value="write">Write — ask before commands</option>
              <option value="alwaysAsk">Always ask — writes and commands</option>
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
              Replay walkthrough
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
            {saveState === "saved" && <span>Saved</span>}
          </div>
          {saveState === "error" && (
            <p className="panel-feedback panel-feedback--error">
              Settings could not be saved.
            </p>
          )}
        </form>
      </section>

      <section className="settings-section" aria-label="Subscription sign in">
        <header className="settings-section__head">
          <p className="eyebrow">Sign in</p>
          <p className="settings-section__blurb">
            Subscription / OAuth providers — same list as omp <code>/login</code>.
          </p>
        </header>

        <label className="panel-field">
          <span>Filter</span>
          <input
            type="search"
            value={loginQuery}
            placeholder="anthropic, cursor, chatgpt…"
            spellCheck={false}
            onChange={(event) => setLoginQuery(event.target.value)}
          />
        </label>

        <div className="settings-list" role="list">
          {filteredLoginProviders.length === 0 ? (
            <p className="settings-list__empty">
              {loginProviders.length === 0
                ? "Loading providers…"
                : "No providers matched."}
            </p>
          ) : (
            filteredLoginProviders.map((provider) => {
              const busy = loginBusyId === provider.id;
              return (
                <div className="settings-list__row" role="listitem" key={provider.id}>
                  <div className="settings-list__copy">
                    <span className="settings-list__title">{provider.name}</span>
                    <span className="settings-list__id">{provider.id}</span>
                  </div>
                  <div className="settings-list__actions">
                    <button
                      type="button"
                      className="panel-button panel-button--primary"
                      disabled={loginBusyId !== null}
                      onClick={() => void signInProvider(provider.id)}
                    >
                      {busy ? "…" : "Sign in"}
                    </button>
                    <button
                      type="button"
                      className="panel-button"
                      disabled={loginBusyId !== null}
                      onClick={() => void signOutProvider(provider.id)}
                    >
                      Log out
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {loginStatus && <p className="settings-section__note">{loginStatus}</p>}
        {loginError && (
          <p className="panel-feedback panel-feedback--error settings-section__error">
            {loginError}
          </p>
        )}
      </section>

      <section className="settings-section" aria-label="Provider API keys">
        <header className="settings-section__head">
          <p className="eyebrow">API keys</p>
          <p className="settings-section__blurb">
            Written to <code>~/.omp/agent/.env</code>. Blank keeps the current key.
          </p>
        </header>

        <div className="settings-list settings-list--keys">
          {providerKeys.map((key) => {
            const clearing = keysToClear.has(key.name);
            const draft = keyDrafts[key.name] ?? "";
            const canClear = key.configured || draft.trim().length > 0 || clearing;
            const status = clearing
              ? "clearing"
              : key.configured
                ? key.masked ?? "set"
                : "not set";
            return (
              <div className="settings-list__row settings-list__row--stack" key={key.name}>
                <div className="settings-list__copy">
                  <span className="settings-list__title">{key.label}</span>
                  <span className="settings-list__id">{key.name}</span>
                  <span
                    className={`settings-list__status${key.configured && !clearing ? " is-set" : ""}`}
                  >
                    {status}
                  </span>
                </div>
                <div className="settings-keys__input-row">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft}
                    placeholder={clearing ? "Clears on save" : "Paste key"}
                    disabled={clearing}
                    onChange={(event) => {
                      const value = event.target.value;
                      setKeyDrafts((current) => ({ ...current, [key.name]: value }));
                      setKeysToClear((current) => {
                        if (!current.has(key.name)) return current;
                        const next = new Set(current);
                        next.delete(key.name);
                        return next;
                      });
                      setKeysSaveState("idle");
                    }}
                  />
                  <button
                    type="button"
                    className="panel-button"
                    disabled={!canClear}
                    onClick={() => {
                      setKeyDrafts((current) => ({ ...current, [key.name]: "" }));
                      setKeysToClear((current) => new Set(current).add(key.name));
                      setKeysSaveState("idle");
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="settings-form__footer">
          <button
            type="button"
            className="panel-button panel-button--primary"
            disabled={keysSaveState === "saving"}
            onClick={() => void saveProviderKeys()}
          >
            {keysSaveState === "saving" ? "Saving…" : "Save keys"}
          </button>
          {keysSaveState === "saved" && <span>Saved</span>}
        </div>
        {keysError && (
          <p className="panel-feedback panel-feedback--error settings-section__error">
            {keysError}
          </p>
        )}
      </section>
    </div>
  );
};
