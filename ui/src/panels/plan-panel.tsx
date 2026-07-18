import { useSessionStore } from "../session/session-store.ts";
import { EmptyState } from "./empty-state.tsx";

export const PlanPanel = () => {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const todos = useSessionStore((state) =>
    state.activeSessionId ? (state.todos[state.activeSessionId] ?? []) : [],
  );

  if (!activeSessionId) {
    return <EmptyState>Select a session to inspect its execution plan.</EmptyState>;
  }

  if (todos.length === 0) {
    return <EmptyState>OMP task phases will collect here during a run.</EmptyState>;
  }

  return (
    <div className="plan-list">
      {todos.map((phase) => (
        <section key={phase.id}>
          <div className="plan-phase__heading">
            <h3>{phase.name}</h3>
            <span>
              {phase.tasks.filter((task) =>
                ["done", "completed"].includes(task.status),
              ).length}
              /{phase.tasks.length}
            </span>
          </div>
          <ul>
            {phase.tasks.map((task) => (
              <li key={task.id}>
                <span className={`task-state task-state--${task.status}`} />
                <span>{task.content}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};
