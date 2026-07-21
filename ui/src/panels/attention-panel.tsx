import {
  selectAttentionInbox,
  useSessionStore,
} from "../session/session-store.ts";
import type { AttentionItem, AttentionKind } from "../session/attention.ts";
import { EmptyState } from "./empty-state.tsx";

const KIND_LABEL: Record<AttentionKind, string> = {
  approval: "Approval",
  confirmation: "Confirm",
  question: "Question",
  input: "Input",
  plan: "Plan",
  failed: "Failed",
};

export const AttentionPanel = () => {
  const items = useSessionStore(selectAttentionInbox);

  if (items.length === 0) {
    return (
      <EmptyState>
        No cross-session prompts need attention right now.
      </EmptyState>
    );
  }

  const openItem = (item: AttentionItem) => {
    useSessionStore.getState().setActive(item.sessionId);
  };

  return (
    <div className="attention-panel">
      <header className="attention-panel__header">
        <span>{items.length} waiting</span>
      </header>
      <ul className="attention-list" aria-label="Attention inbox">
        {items.map((item) => (
          <li key={item.key} className="attention-row">
            <button
              type="button"
              className="attention-row__body"
              onClick={() => openItem(item)}
            >
              <span
                className={`attention-row__badge attention-row__badge--${item.kind}`}
              >
                {KIND_LABEL[item.kind]}
              </span>
              <span className="attention-row__session">{item.sessionTitle}</span>
              <strong className="attention-row__title">{item.title}</strong>
              {item.detail ? (
                <span className="attention-row__detail">{item.detail}</span>
              ) : null}
            </button>
            <button
              type="button"
              className="attention-row__open"
              onClick={() => openItem(item)}
            >
              Open
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
