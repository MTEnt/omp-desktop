import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";

import { api, isTauriRuntime, listenTauriEvent } from "../lib/tauri.ts";
import { selectActiveSession, useSessionStore } from "../session/session-store.ts";
import type { SessionInfo } from "../session/types.ts";
import { EmptyState } from "./empty-state.tsx";

interface PtyOutput {
  sessionId: string;
  data: string;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const SessionTerminal = ({ session }: { session: SessionInfo }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame: number | undefined;
    let lastSize = "";

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", Menlo, Monaco, monospace',
      fontSize: 11,
      lineHeight: 1.25,
      scrollback: 5_000,
      theme: {
        background: "#0c0e11",
        foreground: "#cbd1d9",
        cursor: "#a8d17c",
        cursorAccent: "#0c0e11",
        selectionBackground: "#344126",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    const inputSubscription = terminal.onData((data) => {
      void api.writePty(session.id, data).catch((error: unknown) => {
        console.error(`Unable to write to PTY ${session.id}`, error);
      });
    });

    const fit = () => {
      resizeFrame = undefined;
      if (disposed || container.clientWidth === 0 || container.clientHeight === 0) {
        return;
      }

      fitAddon.fit();
      const size = `${terminal.cols}x${terminal.rows}`;
      if (size === lastSize) return;
      lastSize = size;
      void api
        .resizePty(session.id, terminal.cols, terminal.rows)
        .catch((error: unknown) => {
          console.error(`Unable to resize PTY ${session.id}`, error);
        });
    };

    const scheduleFit = () => {
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fit);
    };

    const connect = async () => {
      if (!isTauriRuntime()) {
        terminal.writeln("Terminal requires the native OMP Desktop window.");
        return;
      }
      const stopListening = await listenTauriEvent<PtyOutput>("pty-output", (payload) => {
        if (payload.sessionId === session.id) {
          terminal.write(payload.data);
        }
      });
      if (disposed) {
        stopListening();
        return;
      }
      unlisten = stopListening;

      try {
        await api.openPty(session.id, session.cwd);
      } catch (error) {
        terminal.writeln(
          `\r\n\x1b[31mUnable to open terminal: ${errorMessage(error)}\x1b[0m`,
        );
        return;
      }
      if (disposed) return;

      resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(container);
      scheduleFit();
    };

    void connect().catch((error: unknown) => {
      if (!disposed) {
        terminal.writeln(
          `\r\n\x1b[31mUnable to connect terminal: ${errorMessage(error)}\x1b[0m`,
        );
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
      resizeObserver?.disconnect();
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
      inputSubscription.dispose();
      terminal.dispose();
    };
  }, [session.cwd, session.id]);

  return (
    <div
      className="terminal-panel"
      ref={containerRef}
      aria-label={`Terminal for ${session.title}`}
    />
  );
};

export const TerminalPanel = () => {
  const session = useSessionStore(selectActiveSession);

  if (!session) return <EmptyState>Open a session to start a terminal.</EmptyState>;
  return <SessionTerminal key={session.id} session={session} />;
};
