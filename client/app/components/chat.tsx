"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";

import { MarkdownMessage } from "@/app/components/markdown-message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  askQuestion,
  SourceChunk,
  WorkspaceDocument,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  confidence?: "high" | "medium" | "low";
  confidenceScore?: number;
  sources?: SourceChunk[];
  error?: boolean;
};

type ChatProps = {
  documents: WorkspaceDocument[];
  selectedDocumentIds: string[];
  filterMode: "all" | "selected";
  onToggleSelectDocument: (id: string) => void;
};

export default function ChatComponent({
  documents = [],
  selectedDocumentIds = [],
  filterMode = "all",
  onToggleSelectDocument,
}: ChatProps) {
  const [draft, setDraft] = React.useState("");
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [expandedEvidenceId, setExpandedEvidenceId] = React.useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = React.useState<string | null>(null);

  const listRef = React.useRef<HTMLDivElement>(null);
  const stickToBottomRef = React.useRef(true);
  const idRef = React.useRef(0);

  const readyDocs = documents.filter((d) => d.status === "ready");
  const selectedDocs =
    filterMode === "all"
      ? readyDocs
      : readyDocs.filter((d) => selectedDocumentIds.includes(d.id));

  const hasReadyDocs = readyDocs.length > 0;
  const canChat = hasReadyDocs && selectedDocs.length > 0 && !isSending;
  const showStarters = hasReadyDocs && messages.length === 0;

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

    // Convert existing messages to role history for contextual query rewriting
    const history = messages
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));

    const activeDocIds =
      filterMode === "all" ? [] : selectedDocs.map((d) => d.id);

    try {
      const response = await askQuestion(prompt, {
        documentIds: activeDocIds,
        history,
      });

      const assistantMessage: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: response.answer || response.message,
        confidence: response.confidence,
        confidenceScore: response.confidenceScore,
        sources: response.sources,
      };

      setMessages((current) => [...current, assistantMessage]);
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

  const toggleEvidence = (messageId: string) => {
    setExpandedEvidenceId((current) => (current === messageId ? null : messageId));
  };

  // Generate contextual starter actions based on documents selected
  const starterActions = React.useMemo(() => {
    const actions: { label: string; prompt: string }[] = [];
    if (selectedDocs.length >= 2) {
      actions.push({
        label: "Compare selected documents",
        prompt: `Compare the key topics, metrics, and differences between these documents: ${selectedDocs
          .map((d) => d.name)
          .join(", ")}.`,
      });
    }
    if (selectedDocs.length === 1) {
      actions.push({
        label: "Summarize this document",
        prompt: `Provide a detailed summary of ${selectedDocs[0].name}, highlighting the core themes, findings, and takeaways.`,
      });
    } else {
      actions.push({
        label: "Summarize all documents",
        prompt: "Summarize the primary topics and key information found across all uploaded documents.",
      });
    }
    actions.push({
      label: "What are the key takeaways?",
      prompt: "What are the most important key takeaways from the documents?",
    });
    actions.push({
      label: "Explain in simple terms",
      prompt: "Explain the main subject matter in simple, clear terms for a general audience.",
    });
    return actions;
  }, [selectedDocs]);

  return (
    <section className="flex h-full min-h-0 flex-col">
      {/* Top Conversation Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border px-4 py-2.5 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Conversation</h2>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
            <span>Searching:</span>
            {filterMode === "all" ? (
              <span className="inline-flex items-center rounded-md bg-secondary px-2 py-0.5 font-medium text-secondary-foreground text-[11px]">
                All Documents ({readyDocs.length})
              </span>
            ) : selectedDocs.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {selectedDocs.map((doc) => (
                  <span
                    key={doc.id}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-primary text-[11px] font-medium"
                  >
                    <FileText className="size-2.5" />
                    <span className="max-w-[120px] truncate">{doc.name}</span>
                    <button
                      type="button"
                      onClick={() => onToggleSelectDocument(doc.id)}
                      className="hover:opacity-75"
                      title="Deselect document"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-destructive font-medium text-[11px]">
                No documents selected
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
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
      </div>

      {/* Messages Scroll Area */}
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
        {!hasReadyDocs ? (
          <EmptyWorkspace />
        ) : messages.length === 0 && !isSending ? (
          <div className="mx-auto flex max-w-lg flex-col items-center px-2 py-8 text-center">
            <div className="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
              <Sparkles className="size-5" />
            </div>
            <h3 className="text-base font-semibold tracking-tight text-foreground">
              Multi-Document Intelligent Search
            </h3>
            <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-muted-foreground">
              Ask questions across {readyDocs.length} ready document
              {readyDocs.length === 1 ? "" : "s"} using hybrid retrieval and grounded evidence.
            </p>
          </div>
        ) : (
          <ol className="mx-auto flex max-w-2xl flex-col gap-5">
            {messages.map((message) => {
              const isAssistant = message.role === "assistant";
              const isEvidenceExpanded = expandedEvidenceId === message.id;

              return (
                <li
                  key={message.id}
                  className={cn(
                    "flex flex-col",
                    message.role === "user" ? "items-end" : "items-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-card text-card-foreground",
                      message.error && "border-destructive/40 text-destructive"
                    )}
                  >
                    {isAssistant && !message.error ? (
                      <MarkdownMessage content={message.content} />
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}

                    {/* Assistant Metadata & Controls: Confidence, Sources, Evidence */}
                    {isAssistant && !message.error ? (
                      <div className="mt-3.5 pt-2.5 border-t border-border/60 space-y-2">
                        {/* Confidence Badge */}
                        {message.confidence ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase",
                                message.confidence === "high" &&
                                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20",
                                message.confidence === "medium" &&
                                  "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20",
                                message.confidence === "low" &&
                                  "bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20"
                              )}
                            >
                              Confidence: {message.confidence}
                            </span>

                            {message.confidence === "low" ? (
                              <span className="text-[11px] text-muted-foreground italic">
                                The uploaded documents contain limited supporting information for this answer.
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Sources Overview & Expand Evidence Button */}
                        {message.sources && message.sources.length > 0 ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="font-medium text-foreground text-[11px]">
                                Sources:
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                className="h-6 gap-1 text-[11px] text-primary hover:text-primary/80 px-1.5"
                                onClick={() => toggleEvidence(message.id)}
                              >
                                {isEvidenceExpanded ? (
                                  <>
                                    <ChevronUp className="size-3" />
                                    Hide retrieved evidence
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="size-3" />
                                    View retrieved evidence ({message.sources.length})
                                  </>
                                )}
                              </Button>
                            </div>

                            {/* Compact Sources Chips */}
                            <div className="flex flex-wrap gap-1.5">
                              {Array.from(
                                new Set(
                                  message.sources.map(
                                    (s) => `${s.documentName} — Page ${s.pageNumber}`
                                  )
                                )
                              ).map((cite, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground font-mono"
                                >
                                  <FileText className="size-2.5 shrink-0" />
                                  {cite}
                                </span>
                              ))}
                            </div>

                            {/* Collapsible Retrieved Context / Evidence Drawer */}
                            {isEvidenceExpanded ? (
                              <div className="mt-2.5 rounded-lg border border-border bg-muted/30 p-2.5 space-y-2 text-xs">
                                <p className="text-[11px] font-semibold text-foreground">
                                  Retrieved Context Chunks:
                                </p>
                                <div className="space-y-2">
                                  {message.sources.map((chunk, cIdx) => (
                                    <div
                                      key={cIdx}
                                      className="rounded border border-border/80 bg-card p-2 text-xs text-foreground/90 shadow-2xs space-y-1"
                                    >
                                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                        <span className="font-medium text-primary">
                                          {chunk.documentName} • Page {chunk.pageNumber}
                                        </span>
                                        {typeof chunk.score === "number" ? (
                                          <span className="rounded bg-secondary px-1.5 py-0.2 font-mono text-[10px]">
                                            Score: {chunk.score.toFixed(3)}
                                          </span>
                                        ) : null}
                                      </div>
                                      <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                                        {chunk.text}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Copy Action Button */}
                        <div className="flex justify-end pt-1">
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
                      </div>
                    ) : null}

                    {/* Retry button on error */}
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
              );
            })}

            {isSending ? (
              <li className="flex justify-start">
                <div
                  className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-xs sm:text-sm text-muted-foreground shadow-xs"
                  aria-live="polite"
                >
                  <Sparkles className="size-4 animate-spin text-primary" />
                  <span>Searching documents and formulating grounded answer…</span>
                </div>
              </li>
            ) : null}
          </ol>
        )}
      </div>

      {/* Input / Form Area */}
      <div className="border-t border-border bg-card px-4 py-3 sm:px-5">
        {/* Dynamic Contextual Starter Prompts */}
        {showStarters ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {starterActions.map((action) => (
              <Button
                key={action.label}
                type="button"
                variant="outline"
                size="xs"
                disabled={!canChat}
                onClick={() => sendMessage(action.prompt)}
              >
                {action.label}
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
            Ask a question across your PDFs
          </label>
          <Textarea
            id="chat-message"
            rows={2}
            value={draft}
            disabled={!hasReadyDocs || isSending}
            placeholder={
              !hasReadyDocs
                ? "Upload a PDF to start asking questions"
                : selectedDocs.length === 0
                ? "Select at least one document to ask questions"
                : selectedDocs.length === 1
                ? `Ask a question about ${selectedDocs[0].name}`
                : `Ask a question across ${selectedDocs.length} selected documents`
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
          Press Enter to send, Shift+Enter for a new line. Answers are strictly grounded in retrieved evidence.
        </p>
      </div>
    </section>
  );
}

function EmptyWorkspace() {
  return (
    <div className="mx-auto max-w-lg px-2 py-12 text-center">
      <div className="size-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3 text-muted-foreground">
        <FileText className="size-6" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-foreground">
        No documents ready in workspace
      </h3>
      <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-muted-foreground">
        Upload one or more PDFs from the panel on the left to begin asking questions and comparing documents.
      </p>
    </div>
  );
}
