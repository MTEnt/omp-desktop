import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { Shell } from "./app/shell.tsx";
import { useSessionStore } from "./session/session-store.ts";

interface OmpEventEnvelope {
  sessionId: string;
  event: unknown;
}

function App() {
  const bootstrap = useSessionStore((state) => state.bootstrap);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    void bootstrap();
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const trackListener = (listener: Promise<() => void>) => {
      void listener
        .then((unlisten) => {
          if (disposed) {
            unlisten();
          } else {
            unlisteners.push(unlisten);
          }
        })
        .catch((error: unknown) => {
          console.error("Unable to register OMP event listener", error);
        });
    };

    trackListener(
      listen<OmpEventEnvelope>("omp-event", ({ payload }) => {
        useSessionStore
          .getState()
          .applyOmpEvent(payload.sessionId, payload.event);
      }),
    );
    trackListener(
      listen<string>("omp-session-exit", ({ payload }) => {
        useSessionStore.getState().markExited(payload);
      }),
    );

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [bootstrap]);

  return <Shell />;
}

export default App
