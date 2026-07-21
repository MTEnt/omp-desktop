import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownBodyProps = {
  content: string;
  className?: string;
  streaming?: boolean;
  onImageClick?: (src: string, alt?: string) => void;
};

export const MarkdownBody = ({
  content,
  className,
  streaming,
  onImageClick,
}: MarkdownBodyProps) => {
  if (!content.trim()) return null;

  return (
    <div
      className={[
        "md-body",
        className,
        streaming ? "md-body--streaming" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            if (!src) return null;
            if (!onImageClick) {
              return <img src={src} alt={alt ?? ""} loading="lazy" />;
            }
            return (
              <button
                type="button"
                className="md-image-button"
                onClick={() => onImageClick(src, alt)}
                title="Open image preview"
              >
                <img src={src} alt={alt ?? ""} loading="lazy" />
              </button>
            );
          },
          pre: ({ children }) => <pre className="md-pre">{children}</pre>,
          code: ({ className: codeClassName, children, ...props }) => {
            const isBlock = Boolean(codeClassName?.includes("language-"));
            if (isBlock) {
              return (
                <code className={codeClassName} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="md-inline-code" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming ? <span className="stream-caret" aria-hidden="true" /> : null}
    </div>
  );
};
