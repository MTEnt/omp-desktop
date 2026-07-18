import { useEffect } from "react";

import { Shell } from "./app/shell.tsx";
import { isTauriRuntime, listenTauriEvent } from "./lib/tauri.ts";
import { useSessionStore } from "./session/session-store.ts";

interface OmpEventEnvelope {
  sessionId: string;
  event: unknown;
}

function App() {
  const bootstrap = useSessionStore((state) => state.bootstrap);

  useEffect(() => {
    if (!isTauriRuntime()) {
      console.info(
        "OMP Desktop UI is running outside Tauri. Native features stay idle until launched via the app.",
      );
      return;
    }

    void bootstrap();
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const track = (promise: Promise<() => void>) => {
      void promise
        .then((unlisten) => {
          if (disposed) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch((error: unknown) => {
          console.error("Unable to register OMP event listener", error);
        });
    };

    track(
      listenTauriEvent<OmpEventEnvelope>("omp-event", (payload) => {
        useSessionStore.getState().applyOmpEvent(payload.sessionId, payload.event);
      }),
    );
    track(
      listenTauriEvent<string>("omp-session-exit", (payload) => {
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

export default App;
