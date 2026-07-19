import { useEffect, useState, type FormEvent } from "react";

import { useSessionStore } from "../session/session-store.ts";
import type { AppSettings, ApprovalMode } from "../session/types.ts";

const defaultSettings: AppSettings = {
  approvalMode: "yolo",
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
  const [form, setForm] = useState<AppSettings>(settings ?? defaultSettings);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

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
          <option value="yolo">Yolo — auto approve</option>
          <option value="write">Write — approve writes</option>
          <option value="alwaysAsk">Always ask</option>
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
