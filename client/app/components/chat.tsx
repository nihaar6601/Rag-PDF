"use client";

import * as React from "react";
import { Check, Copy, RotateCcw, Send, Trash2 } from "lucide-react";

import { MarkdownMessage } from "@/app/components/markdown-message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askQuestion, type DocumentStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  error?: boolean;
};

const STARTER_PROMPTS = [
  "Summarize this document.",
  "What are the key takeaways?",
  "Explain the main topic in simple terms.",
];

type ChatProps = {
  documentStatus: DocumentStatus;
};

export default function ChatComponent({ documentStatus }: ChatProps) {
  const [draft, setDraft] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = React.useState<string | null>(
    null
  );

  const listRef = React.useRef<HTMLDivElement>(null);
  const stickToBottomRef = React.useRef(true);
  const idRef = React.useRef(0);

  const canChat = documentStatus === "ready" && !isSending;
  const showStarters = documentStatus === "ready" && messages.length === 0;

  const nextId = () => {
    idRef.current += 1;
    return String(idRef.current);
  };

  const scrollIfNeeded = React.useCallback(() => {
    const node = listRef.current;
    if (!node || !stickToBottomRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  React.useEffect(() => {
    scrollIfNeeded();
  }, [messages, isSending, scrollIfNeeded]);

  const sendMessage = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || !canChat) return;

    const userMessage: ChatMessage = {
      id: nextId(),
      role: "user",
      content: prompt,
    };
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setIsSending(true);
    setLastFailedPrompt(null);
    stickToBottomRef.current = true;

    try {
      const answer = await askQuestion(prompt);
      setMessages((current) => [
        ...current,
        { id: nextId(), role: "assistant", content: answer },
      ]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not answer that question. Please try again.";
      setLastFailedPrompt(prompt);
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          content: message,
          error: true,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const copyAnswer = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Conversation</h2>
          <p className="text-xs text-muted-foreground">
            Answers are based on uploaded PDFs.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={messages.length === 0 || isSending}
          onClick={() => {
            setMessages([]);
            setLastFailedPrompt(null);
          }}
        >
          <Trash2 data-icon="inline-start" />
          Clear
        </Button>
      </div>

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5"
        onScroll={(event) => {
          const node = event.currentTarget;
          const distanceFromBottom =
            node.scrollHeight - node.scrollTop - node.clientHeight;
          stickToBottomRef.current = distanceFromBottom < 80;
        }}
      >
        {documentStatus !== "ready" ? (
          <EmptyConversation status={documentStatus} />
        ) : messages.length === 0 && !isSending ? (
          <div className="mx-auto flex max-w-lg flex-col items-center px-2 py-10 text-center">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">
              Your document, explained.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Ask a question below, or start with one of these.
            </p>
          </div>
        ) : (
          <ol className="mx-auto flex max-w-2xl flex-col gap-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-card-foreground",
                    message.error && "border-destructive/40 text-destructive"
                  )}
                >
                  {message.role === "assistant" && !message.error ? (
                    <MarkdownMessage content={message.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                  {message.role === "assistant" && !message.error ? (
                    <div className="mt-2 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => copyAnswer(message)}
                        aria-label={
                          copiedId === message.id ? "Answer copied" : "Copy answer"
                        }
                      >
                        {copiedId === message.id ? (
                          <>
                            <Check data-icon="inline-start" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy data-icon="inline-start" />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                  ) : null}
                  {message.error && lastFailedPrompt ? (
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={isSending}
                        onClick={() => sendMessage(lastFailedPrompt)}
                      >
                        <RotateCcw data-icon="inline-start" />
                        Retry
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
            {isSending ? (
              <li className="flex justify-start">
                <p
                  className="rounded-2xl border border-border bg-card px-3.5 py-2.5 text-sm text-muted-foreground shadow-sm"
                  aria-live="polite"
                >
                  Writing an answer…
                </p>
              </li>
            ) : null}
          </ol>
        )}
      </div>

      <div className="border-t border-border bg-card px-4 py-3 sm:px-5">
        {showStarters ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {STARTER_PROMPTS.map((prompt) => (
              <Button
                key={prompt}
                type="button"
                variant="outline"
                size="sm"
                disabled={!canChat}
                onClick={() => sendMessage(prompt)}
              >
                {prompt}
              </Button>
            ))}
          </div>
        ) : null}

        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage(draft);
          }}
        >
          <label htmlFor="chat-message" className="sr-only">
            Ask a question about your PDF
          </label>
          <Textarea
            id="chat-message"
            rows={2}
            value={draft}
            disabled={documentStatus !== "ready" || isSending}
            placeholder={
              documentStatus === "ready"
                ? "Ask a question about your PDF"
                : "Upload a PDF to start asking questions"
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(draft);
              }
            }}
          />
          <Button
            type="submit"
            size="lg"
            disabled={!canChat || !draft.trim()}
            aria-label="Send question"
          >
            <Send />
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Press Enter to send, Shift+Enter for a new line.
        </p>
      </div>
    </section>
  );
}

function EmptyConversation({ status }: { status: DocumentStatus }) {
  if (status === "uploading" || status === "preparing") {
    return (
      <div className="mx-auto max-w-lg px-2 py-12 text-center">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          Preparing your document
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Questions will be available here once processing finishes. This is not
          instant after upload.
        </p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="mx-auto max-w-lg px-2 py-12 text-center">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">
          This document is not ready
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Processing failed. Retry from the document panel, then come back here
          to ask questions.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-2 py-12 text-center">
      <h3 className="text-lg font-semibold tracking-tight text-foreground">
        Your document, explained.
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Upload a PDF to ask questions and find the information you need.
      </p>
    </div>
  );
}
