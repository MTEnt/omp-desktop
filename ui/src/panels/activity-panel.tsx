import {
  selectActiveActivity,
  useSessionStore,
} from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";

export const ActivityPanel = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const activity = useSessionStore(selectActiveActivity);

  if (!activeSessionId) {
    return <EmptyState>Select a session to inspect its activity.</EmptyState>;
  }

  if (activity.length === 0) {
    return <EmptyState>Tool execution will form a quiet timeline here.</EmptyState>;
  }

  return (
    <ol className="activity-list" aria-label="Session activity">
      {activity.map((item) => {
        const occurredAt = new Date(item.at);
        return (
          <li key={item.id}>
            <time dateTime={occurredAt.toISOString()}>
              {occurredAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            <span>{item.text}</span>
          </li>
        );
      })}
    </ol>
  );
};
