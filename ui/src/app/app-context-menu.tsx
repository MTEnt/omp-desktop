import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { isTauriRuntime } from "../lib/tauri.ts";

type MenuPoint = { x: number; y: number };

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "radio",
  "submit",
  "reset",
  "file",
  "image",
  "range",
  "color",
  "hidden",
]);

/** Let the WebView native menu handle spellcheck / cut-copy-paste in fields. */
const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest("[contenteditable='true']")) return true;

  const input = target.closest("input");
  if (input instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(input.type.toLowerCase());
  }
  return Boolean(target.closest("textarea"));
};

export const AppContextMenu = () => {
  const [menu, setMenu] = useState<MenuPoint | null>(null);
  const [version, setVersion] = useState("…");
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setVersion("dev");
      return;
    }
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("unknown"));
  }, []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      // Keep native edit/spellcheck menus in inputs and textareas.
      if (isEditableTarget(event.target)) {
        setMenu(null);
        return;
      }
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY });
    };
    const dismiss = () => setMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("click", dismiss);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("click", dismiss);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, []);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    const x = Math.min(menu.x, window.innerWidth - rect.width - pad);
    const y = Math.min(menu.y, window.innerHeight - rect.height - pad);
    const next = { x: Math.max(pad, x), y: Math.max(pad, y) };
    if (next.x !== menu.x || next.y !== menu.y) setMenu(next);
  }, [menu]);

  if (!menu) return null;

  return (
    <div
      ref={menuRef}
      className="app-context-menu"
      role="menu"
      aria-label="Context menu"
      style={{ left: menu.x, top: menu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="app-context-menu__item" role="menuitem">
        OMP Desktop v{version}
      </div>
    </div>
  );
};
