import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownBodyProps = {
  content: string;
  className?: string;
};

export const MarkdownBody = ({ content, className }: MarkdownBodyProps) => {
  if (!content.trim()) return null;

  return (
    <div className={className ? `md-body ${className}` : "md-body"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <pre className="md-pre">{children}</pre>,
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className?.includes("language-"));
            if (isBlock) {
              return (
                <code className={className} {...props}>
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
    </div>
  );
};
