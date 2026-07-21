import { useEffect, useId, useRef, useState } from "react";

import { useTaskProgress } from "./use-task-progress.ts";

export const TaskProgressStrip = () => {
  const progress = useTaskProgress();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  if (!progress) return null;

  const percent = Math.round(progress.display * 100);
  const className = [
    "task-progress",
    expanded ? "task-progress--expanded" : "task-progress--collapsed",
    progress.crawling ? "task-progress--crawling" : "",
    progress.allDone ? "task-progress--done" : "",
    progress.empty ? "task-progress--empty" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const beginEdit = () => {
    setExpanded(true);
    setDraft(progress.goalIsPlaceholder ? "" : progress.goal);
    setEditing(true);
  };

  const commit = () => {
    progress.setOverride(draft);
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className={className}
        aria-labelledby={labelId}
        aria-expanded={false}
        title="Expand goal"
        onClick={() => setExpanded(true)}
      >
        <span className="task-progress__eyebrow" id={labelId}>
          Goal
          {!progress.empty ? (
            <span className="task-progress__count">
              {progress.doneCount}/{progress.totalCount}
            </span>
          ) : null}
        </span>
        <span
          className={`task-progress__goal${progress.goalIsPlaceholder ? " task-progress__goal--placeholder" : ""}`}
        >
          {progress.goal}
        </span>
        <span className="task-progress__percent" aria-hidden={progress.empty}>
          {progress.empty ? "—" : `${percent}%`}
        </span>
        <span
          className="task-progress__mini-track"
          aria-hidden="true"
        >
          <span
            className="task-progress__fill"
            style={{ width: `${progress.empty ? 0 : percent}%` }}
          />
        </span>
      </button>
    );
  }

  return (
    <section
      className={className}
      aria-labelledby={labelId}
      aria-live="polite"
      aria-expanded={true}
    >
      <div className="task-progress__row">
        <div className="task-progress__meta">
          <button
            type="button"
            className="task-progress__eyebrow task-progress__toggle"
            id={labelId}
            title="Collapse goal"
            aria-label="Collapse goal"
            onClick={() => {
              setEditing(false);
              setExpanded(false);
            }}
          >
            Goal
            {!progress.empty ? (
              <span className="task-progress__count">
                {progress.doneCount}/{progress.totalCount}
              </span>
            ) : null}
            <span className="task-progress__chevron" aria-hidden>
              ▾
            </span>
          </button>

          {editing ? (
            <input
              ref={inputRef}
              className="task-progress__input"
              value={draft}
              placeholder="Session goal"
              aria-label="Session goal"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                }
              }}
            />
          ) : (
            <button
              type="button"
              className={`task-progress__goal${progress.goalIsPlaceholder ? " task-progress__goal--placeholder" : ""}`}
              onClick={beginEdit}
              title={progress.goal}
            >
              {progress.goal}
            </button>
          )}
        </div>

        <div className="task-progress__aside">
          {progress.goalIsOverride ? (
            <button
              type="button"
              className="task-progress__clear"
              title="Clear goal override"
              aria-label="Clear goal override"
              onClick={() => progress.setOverride(null)}
            >
              ↺
            </button>
          ) : null}
          <span className="task-progress__percent" aria-hidden={progress.empty}>
            {progress.empty ? "—" : `${percent}%`}
          </span>
        </div>
      </div>

      <div
        className="task-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.empty ? 0 : percent}
        aria-label="Task completion"
      >
        <div
          className="task-progress__fill"
          style={{ width: `${progress.empty ? 0 : percent}%` }}
        />
      </div>

      {!progress.empty && progress.chips.length > 0 ? (
        <ul className="task-progress__chips">
          {progress.chips.map((chip) => (
            <li
              key={chip.id}
              className={`task-progress__chip task-progress__chip--${chip.status}`}
              title={chip.label}
            >
              <span className="task-progress__dot" aria-hidden />
              <span className="task-progress__chip-label">{chip.label}</span>
            </li>
          ))}
          {progress.overflowCount > 0 ? (
            <li className="task-progress__chip task-progress__chip--more">
              +{progress.overflowCount}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
};
