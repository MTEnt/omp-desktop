import { DiffView } from "./diff-view.tsx";
import type { TranscriptItem } from "./types.ts";

type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

export function ToolCard({ item }: { item: ToolItem }) {
  return (
    <section className={`tool-card tool-card--${item.status}`}>
      <header>
        <span className="tool-card__mark" aria-hidden="true">
          ›_
        </span>
        <strong>{item.name}</strong>
        <span className="tool-card__status">{item.status}</span>
      </header>
      <ToolCardBody item={item} />
    </section>
  );
}

function ToolCardBody({ item }: { item: ToolItem }) {
  const parsed = item.parsed;

  switch (parsed?.kind) {
    case "edit":
      return <DiffView parsed={parsed} />;
    case "bash":
      return (
        <div className="tool-bash">
          {parsed.output ? <pre>{parsed.output}</pre> : null}
          {parsed.exitCode !== undefined ? (
            <footer className="tool-foot">exit {parsed.exitCode}</footer>
          ) : null}
        </div>
      );
    case "read":
    case "search":
      return (
        <div className="tool-read">
          {parsed.raw ? <pre>{parsed.raw}</pre> : null}
          <footer className="tool-foot">
            {parsed.target ? <span>{parsed.target}</span> : null}
            {parsed.summary ? <span>{parsed.summary}</span> : null}
          </footer>
        </div>
      );
    case "eval":
      return (
        <div className="tool-eval">
          {parsed.cells.map((cell, index) => (
            <pre key={index}>
              {[
                cell.language ? `// ${cell.language}` : null,
                cell.code,
                cell.output,
              ]
                .filter(Boolean)
                .join("\n")}
            </pre>
          ))}
        </div>
      );
    default:
      return item.detail ? <pre>{item.detail}</pre> : null;
  }
}
