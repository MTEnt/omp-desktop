import type { ReactNode } from "react";

import type { PanelId } from "./layout-store.ts";

export type RailTarget = "chat" | PanelId;

interface RailItem {
  id: RailTarget;
  label: string;
  shortcut: string;
}

interface RailProps {
  side: "left" | "right";
  items: RailItem[];
  active: RailTarget[];
  onSelect: (target: RailTarget) => void;
}

const leftItems: RailItem[] = [
  { id: "chat", label: "Chat", shortcut: "⌘1" },
  { id: "sessions", label: "Sessions", shortcut: "⌘2" },
  { id: "project", label: "Project", shortcut: "⌘3" },
  { id: "settings", label: "Settings", shortcut: "⌘," },
  { id: "terminal", label: "Terminal", shortcut: "⌘J" },
];

const rightItems: RailItem[] = [
  { id: "plan", label: "Plan", shortcut: "⌘4" },
  { id: "activity", label: "Activity", shortcut: "⌘5" },
  { id: "subagents", label: "Subagents", shortcut: "⌘6" },
];

const Icon = ({ target }: { target: RailTarget }) => {
  let shape: ReactNode;

  switch (target) {
    case "chat":
      shape = <path d="M5 5.5h14v10H9l-4 3v-13Z" />;
      break;
    case "sessions":
      shape = (
        <>
          <path d="M7 6.5h12v11H7z" />
          <path d="M4 9.5v10h12" />
        </>
      );
      break;
    case "project":
      shape = <path d="M3.5 7h6l2-2h9v13.5h-17z" />;
      break;
    case "settings":
      shape = (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18" />
        </>
      );
      break;
    case "terminal":
      shape = (
        <>
          <path d="M4 5.5h16v13H4z" />
          <path d="m7 9 3 3-3 3M12.5 15H17" />
        </>
      );
      break;
    case "plan":
      shape = (
        <>
          <path d="M8 5h12M8 12h12M8 19h12" />
          <path d="m3.5 5 1 1 2-2M3.5 12l1 1 2-2M3.5 19l1 1 2-2" />
        </>
      );
      break;
    case "activity":
      shape = <path d="M3 12h4l2.2-6 4 12 2.2-6H21" />;
      break;
    case "subagents":
      shape = (
        <>
          <circle cx="12" cy="8" r="3" />
          <circle cx="5.5" cy="11" r="2" />
          <circle cx="18.5" cy="11" r="2" />
          <path d="M6.5 19c.4-3 2.2-4.5 5.5-4.5s5.1 1.5 5.5 4.5M2.5 18c.2-2 1.2-3 3-3M21.5 18c-.2-2-1.2-3-3-3" />
        </>
      );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {shape}
    </svg>
  );
};

const Rail = ({ side, items, active, onSelect }: RailProps) => (
  <nav className={`icon-rail icon-rail--${side}`} aria-label={`${side} panels`}>
    <div className="icon-rail__items">
      {items.map((item) => (
        <button
          className={`rail-button${active.includes(item.id) ? " is-active" : ""}`}
          type="button"
          key={item.id}
          title={`${item.label} · ${item.shortcut}`}
          aria-label={`${item.label} (${item.shortcut})`}
          aria-pressed={active.includes(item.id)}
          onClick={() => onSelect(item.id)}
        >
          <Icon target={item.id} />
        </button>
      ))}
    </div>
    <span className="icon-rail__mark" aria-hidden="true">
      {side === "left" ? "01" : "OMP"}
    </span>
  </nav>
);

interface RailsProps {
  active: RailTarget[];
  onSelect: (target: RailTarget) => void;
}

export const LeftRail = (props: RailsProps) => (
  <Rail side="left" items={leftItems} {...props} />
);

export const RightRail = (props: RailsProps) => (
  <Rail side="right" items={rightItems} {...props} />
);
