import type { ReactNode } from "react";

interface EmptyStateProps {
  children: ReactNode;
}

export const EmptyState = ({ children }: EmptyStateProps) => (
  <div className="panel-empty">
    <span className="panel-empty__rule" />
    <p>{children}</p>
  </div>
);
