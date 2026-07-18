interface EmptyStateProps {
  children: string;
}

export const EmptyState = ({ children }: EmptyStateProps) => (
  <div className="panel-empty">
    <span className="panel-empty__rule" />
    <p>{children}</p>
  </div>
);
