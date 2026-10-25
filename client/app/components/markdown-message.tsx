"use client";

import ReactMarkdown from "react-markdown";

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
