import { useEffect } from "react";

import { Shell } from "./app/shell.tsx";
import { useSessionStore } from "./session/session-store.ts";

function App() {
  const bootstrap = useSessionStore((state) => state.bootstrap);

  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) void bootstrap();
  }, [bootstrap]);

  return <Shell />;
}

export default App
