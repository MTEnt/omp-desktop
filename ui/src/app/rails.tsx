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
  { id: "attention", label: "Attention", shortcut: "⌘0" },
  { id: "subagents", label: "Subagents", shortcut: "⌘6" },
  { id: "jobs", label: "Job board", shortcut: "⌘7" },
  { id: "memory", label: "Role memory", shortcut: "⌘8" },
  { id: "scratchpad", label: "Scratchpad", shortcut: "⌘9" },
  { id: "launch", label: "Launch", shortcut: "⌘L" },
  { id: "browser", label: "Browser", shortcut: "⌘B" },
  { id: "companion", label: "Companion", shortcut: "⌘U" },
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
    case "attention":
      shape = (
        <>
          <path d="M12 4.5 13.8 9h4.7l-3.8 2.9 1.4 4.6L12 13.8 7.9 16.5l1.4-4.6L5.5 9h4.7z" />
          <circle cx="18.5" cy="6.5" r="2.2" />
        </>
      );
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
      break;
    case "jobs":
      shape = (
        <>
          <path d="M5 7h14v12H5z" />
          <path d="M9 7V5.5h6V7M8 11h8M8 15h5" />
        </>
      );
      break;
    case "memory":
      shape = (
        <>
          <path d="M8 4.5h8v15H8z" />
          <path d="M10 8h4M10 12h4M10 16h3" />
        </>
      );
      break;
    case "launch":
      shape = (
        <>
          <path d="M12 3.5v10" />
          <path d="m8.5 10 3.5 3.5L15.5 10" />
          <path d="M6 18.5h12" />
        </>
      );
      break;
    case "browser":
      shape = (
        <>
          <path d="M4 6.5h16v12H4z" />
          <path d="M4 9.5h16" />
          <circle cx="7" cy="8" r="0.8" />
          <circle cx="9.5" cy="8" r="0.8" />
        </>
      );
      break;
    case "companion":
      shape = (
        <>
          <path d="M5 7h14v9H5z" />
          <path d="M9 19h6" />
          <path d="M12 16v3" />
        </>
      );
      break;
    case "scratchpad":
      shape = (
        <>
          <path d="M6 4.5h9l3 3V19.5H6z" />
          <path d="M15 4.5V8h3M9 12h6M9 15h4" />
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
          data-label={item.label}
          data-shortcut={item.shortcut}
          title={`${item.label} · ${item.shortcut}`}
          aria-label={`${item.label} (${item.shortcut})`}
          aria-pressed={active.includes(item.id)}
          onClick={() => onSelect(item.id)}
        >
          <Icon target={item.id} />
          <span className="rail-button__tip" aria-hidden="true">
            <span className="rail-button__tip-label">{item.label}</span>
            <kbd className="rail-button__tip-shortcut">{item.shortcut}</kbd>
          </span>
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
