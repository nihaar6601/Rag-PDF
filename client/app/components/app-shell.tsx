"use client";

import * as React from "react";
import { PanelLeft } from "lucide-react";

import ChatComponent from "@/app/components/chat";
import FileUploadComponent, {
  validateSelectedFile,
} from "@/app/components/file-upload";
import { Button } from "@/components/ui/button";
import {
  DocumentStatus,
  getJobStatus,
  uploadPdf,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type DocumentState = {
  file: File | null;
  filename?: string;
  fileSize?: number;
  jobId?: string;
  status: DocumentStatus;
  error?: string | null;
};

export default function AppShell() {
  const [documentState, setDocumentState] = React.useState<DocumentState>({
    status: "idle",
    file: null,
  });
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const startUpload = React.useCallback(async (file: File) => {
    const validationError = validateSelectedFile(file);
    if (validationError) {
      setDocumentState({
        file,
        filename: file.name,
        fileSize: file.size,
        status: "failed",
        error: validationError,
      });
      return;
    }

    setDocumentState({
      file,
      filename: file.name,
      fileSize: file.size,
      status: "uploading",
      error: null,
    });

    try {
      const uploaded = await uploadPdf(file);
      setDocumentState({
        file,
        filename: uploaded.filename,
        fileSize: uploaded.size,
        jobId: uploaded.jobId,
        status: "preparing",
        error: null,
      });
    } catch (error) {
      setDocumentState({
        file,
        filename: file.name,
        fileSize: file.size,
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Upload failed. Please try again.",
      });
    }
  }, []);

  React.useEffect(() => {
    if (documentState.status !== "preparing" || !documentState.jobId) {
      return;
    }

    let cancelled = false;
    let consecutiveErrors = 0;

    const poll = async () => {
      try {
        const job = await getJobStatus(documentState.jobId!);
        if (cancelled) return;
        consecutiveErrors = 0;

        if (job.status === "ready") {
          setDocumentState((current) => ({
            ...current,
            status: "ready",
            error: null,
          }));
          return;
        }

        if (job.status === "failed") {
          setDocumentState((current) => ({
            ...current,
            status: "failed",
            error: job.error || "Processing failed.",
          }));
        }
      } catch (error) {
        if (cancelled) return;
        consecutiveErrors += 1;
        if (consecutiveErrors < 3) return;
        setDocumentState((current) => ({
          ...current,
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Could not check document status.",
        }));
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [documentState.jobId, documentState.status]);

  const retry = () => {
    if (documentState.file) {
      void startUpload(documentState.file);
    }
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col md:flex-row">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2 md:hidden">
        <p className="text-sm font-medium text-foreground">Document</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={sidebarOpen}
          aria-controls="document-panel"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <PanelLeft data-icon="inline-start" />
          {sidebarOpen ? "Hide" : "Show"}
        </Button>
      </div>

      <aside
        id="document-panel"
        className={cn(
          "w-full shrink-0 border-border bg-transparent md:block md:w-[300px] md:border-r",
          sidebarOpen ? "block" : "hidden"
        )}
      >
        <div className="flex h-full flex-col gap-5 p-4 md:h-[calc(100dvh-3.75rem)] md:overflow-y-auto">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Upload</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Add a PDF, wait until it is ready, then ask questions in the
              conversation.
            </p>
          </div>

          <FileUploadComponent
            filename={documentState.filename}
            fileSize={documentState.fileSize}
            status={documentState.status}
            error={documentState.error}
            hasJob={Boolean(documentState.jobId)}
            onFileChosen={(file) => {
              void startUpload(file);
            }}
            onRetry={retry}
          />

          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <p className="text-xs font-medium text-foreground">How it works</p>
            <ol className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
              <li>1. Choose a PDF from your computer.</li>
              <li>2. Wait until the document is ready to chat.</li>
              <li>3. Ask a question in the conversation panel.</li>
            </ol>
          </div>
        </div>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 bg-transparent">
        <div className="h-[calc(100dvh-7.25rem)] overflow-hidden rounded-none border-0 bg-card md:h-[calc(100dvh-3.75rem)] md:rounded-none">
          <ChatComponent documentStatus={documentState.status} />
        </div>
      </div>
    </div>
  );
}
