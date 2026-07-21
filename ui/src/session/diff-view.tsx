import type { ParsedEditDiff } from "./tool-render.ts";

export function DiffView({ parsed }: { parsed: ParsedEditDiff }) {
  return (
    <div className="diff-wrap">
      <header className="diff-wrap__header">
        <span className="diff-wrap__target">{parsed.target ?? "diff"}</span>
        <span className="diff-wrap__stats">
          <span className="diff-wrap__adds">+{parsed.adds}</span>
          <span className="diff-wrap__rems">-{parsed.rems}</span>
        </span>
      </header>
      <pre className="diff-wrap__body" aria-label="diff">
        {parsed.lines.map((line, index) => (
          <span
            key={`${index}-${line.kind}-${line.text.slice(0, 24)}`}
            className={`diff-line diff-line--${line.kind}`}
          >
            {line.text || " "}
            {"\n"}
          </span>
        ))}
      </pre>
    </div>
  );
}
