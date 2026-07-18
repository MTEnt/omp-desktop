import { useEffect, useMemo, useRef, useState } from "react";

import {
  selectActiveStreaming,
  selectActiveTodos,
  useSessionStore,
} from "../session/session-store.ts";
import {
  deriveTaskProgress,
  loadGoalOverrides,
  saveGoalOverrides,
  stepDisplayProgress,
  type TaskProgressModel,
} from "./task-progress.ts";

export interface TaskProgressView extends TaskProgressModel {
  display: number;
  setOverride: (value: string | null) => void;
}

export const useTaskProgress = (): TaskProgressView | null => {
  const sessionId = useSessionStore((state) => state.activeSessionId);
  const phases = useSessionStore(selectActiveTodos);
  const streaming = useSessionStore(selectActiveStreaming);
  const [overrides, setOverrides] = useState<Record<string, string>>(() =>
    loadGoalOverrides(),
  );
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);

  const model = useMemo(() => {
    if (!sessionId) return null;
    return deriveTaskProgress({
      phases,
      override: overrides[sessionId] ?? null,
      streaming,
    });
  }, [sessionId, phases, overrides, streaming]);

  useEffect(() => {
    if (!model) {
      displayRef.current = 0;
      setDisplay(0);
      return;
    }

    let frame = 0;
    let last = performance.now();
    // Seed toward current base immediately on model identity changes.
    const seed = model.base;
    if (Math.abs(displayRef.current - seed) > 0.5) {
      displayRef.current = seed;
      setDisplay(seed);
    }

    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const target = model.crawling ? model.ceiling : model.base;
      const next = stepDisplayProgress(
        displayRef.current,
        target,
        dt,
        model.crawling,
      );
      displayRef.current = next;
      setDisplay(next);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [model]);

  if (!sessionId || !model) return null;

  return {
    ...model,
    display,
    setOverride: (value: string | null) => {
      setOverrides((current) => {
        const next = { ...current };
        const trimmed = value?.trim() ?? "";
        if (!trimmed) delete next[sessionId];
        else next[sessionId] = trimmed;
        saveGoalOverrides(next);
        return next;
      });
    },
  };
};
