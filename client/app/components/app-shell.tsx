"use client";

import * as React from "react";
import { PanelLeft } from "lucide-react";

import ChatComponent from "@/app/components/chat";
import FileUploadComponent, {
  validateSelectedFile,
} from "@/app/components/file-upload";
import { Button } from "@/components/ui/button";
import {
  deleteDocument,
  getDocuments,
  getJobStatus,
  uploadPdf,
  WorkspaceDocument,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function AppShell() {
  const [documents, setDocuments] = React.useState<WorkspaceDocument[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = React.useState<string[]>([]);
  const [filterMode, setFilterMode] = React.useState<"all" | "selected">("all");
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  // Initial load of documents from backend
  React.useEffect(() => {
    let mounted = true;
    const fetchDocs = async () => {
      const docs = await getDocuments();
      if (!mounted) return;
      if (docs && docs.length > 0) {
        setDocuments(docs);
        // By default, select all ready documents
        const readyIds = docs.filter((d) => d.status === "ready").map((d) => d.id);
        setSelectedDocumentIds(readyIds);
      }
    };
    void fetchDocs();
    return () => {
      mounted = false;
    };
  }, []);

  // Polling for any in-progress documents
  React.useEffect(() => {
    const pendingDocs = documents.filter(
      (d) => (d.status === "uploading" || d.status === "preparing") && d.jobId
    );

    if (pendingDocs.length === 0) return;

    let cancelled = false;

    const pollPending = async () => {
      try {
        const updates = await Promise.all(
          pendingDocs.map(async (doc) => {
            try {
              const job = await getJobStatus(doc.jobId!);
              return {
                id: doc.id,
                status: job.status,
                stage: job.stage,
                progress: job.progress,
                error: job.error,
              };
            } catch {
              return null;
            }
          })
        );

        if (cancelled) return;

        setDocuments((currentDocs) => {
          let hasChanges = false;
          const nextDocs = currentDocs.map((doc) => {
            const update = updates.find((u) => u && u.id === doc.id);
            if (!update) return doc;

            if (
              doc.status !== update.status ||
              doc.stage !== update.stage ||
              doc.progress !== update.progress ||
              doc.error !== update.error
            ) {
              hasChanges = true;
              return {
                ...doc,
                status: update.status,
                stage: update.stage || (update.status === "ready" ? "ready" : doc.stage),
                progress: update.progress,
                error: update.error,
              };
            }
            return doc;
          });

          // If any document just became ready, include it in selectedDocumentIds
          if (hasChanges) {
            const newlyReady = nextDocs
              .filter((d) => d.status === "ready")
              .map((d) => d.id);
            setSelectedDocumentIds((prev) => Array.from(new Set([...prev, ...newlyReady])));
          }

          return hasChanges ? nextDocs : currentDocs;
        });
      } catch (err) {
        console.warn("Error polling document statuses:", err);
      }
    };

    const interval = window.setInterval(() => {
      void pollPending();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [documents]);

  // Handle uploading multiple files
  const handleFilesChosen = React.useCallback(async (files: File[]) => {
    for (const file of files) {
      const validationError = validateSelectedFile(file);
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      if (validationError) {
        setDocuments((prev) => [
          ...prev,
          {
            id: tempId,
            name: file.name,
            filename: file.name,
            size: file.size,
            status: "failed",
            stage: "failed",
            error: validationError,
          },
        ]);
        continue;
      }

      // Add optimistic document entry
      setDocuments((prev) => [
        ...prev,
        {
          id: tempId,
          name: file.name,
          filename: file.name,
          size: file.size,
          status: "uploading",
          stage: "uploading",
          progress: 10,
        },
      ]);

      try {
        const uploaded = await uploadPdf(file);
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === tempId
              ? {
                  ...d,
                  id: uploaded.documentId || uploaded.jobId,
                  jobId: uploaded.jobId,
                  status: "preparing",
                  stage: "extracting",
                  progress: 25,
                }
              : d
          )
        );
      } catch (error) {
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === tempId
              ? {
                  ...d,
                  status: "failed",
                  stage: "failed",
                  error:
                    error instanceof Error
                      ? error.message
                      : "Upload failed. Please try again.",
                }
              : d
          )
        );
      }
    }
  }, []);

  // Handle removing a document
  const handleRemoveDocument = React.useCallback(async (documentId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== documentId));
    setSelectedDocumentIds((prev) => prev.filter((id) => id !== documentId));
    try {
      await deleteDocument(documentId);
    } catch (e) {
      console.warn("Could not delete document on server:", e);
    }
  }, []);

  // Handle selection toggling
  const handleToggleSelectDocument = React.useCallback((documentId: string) => {
    setSelectedDocumentIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId]
    );
  }, []);

  const handleSelectAllDocuments = React.useCallback(() => {
    const readyIds = documents.filter((d) => d.status === "ready").map((d) => d.id);
    setSelectedDocumentIds(readyIds);
  }, [documents]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col md:flex-row">
      {/* Mobile Drawer Trigger Bar */}
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2 md:hidden">
        <p className="text-sm font-medium text-foreground">
          Workspace Documents ({documents.length})
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={sidebarOpen}
          aria-controls="document-panel"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <PanelLeft data-icon="inline-start" />
          {sidebarOpen ? "Hide Documents" : "Show Documents"}
        </Button>
      </div>

      {/* Left Sidebar: Document Workspace */}
      <aside
        id="document-panel"
        className={cn(
          "w-full shrink-0 border-border bg-transparent md:block md:w-[320px] md:border-r",
          sidebarOpen ? "block" : "hidden"
        )}
      >
        <div className="flex h-full flex-col gap-4 p-4 md:h-[calc(100dvh-3.75rem)] md:overflow-y-auto">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Multi-Document Workspace
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Add multiple PDFs, inspect processing status, and select documents to analyze.
            </p>
          </div>

          <FileUploadComponent
            documents={documents}
            selectedDocumentIds={selectedDocumentIds}
            filterMode={filterMode}
            onFilterModeChange={setFilterMode}
            onToggleSelectDocument={handleToggleSelectDocument}
            onSelectAllDocuments={handleSelectAllDocuments}
            onFilesChosen={handleFilesChosen}
            onRemoveDocument={handleRemoveDocument}
          />

          <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
            <p className="text-xs font-semibold text-foreground">
              Multi-Doc Capabilities
            </p>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <li>• <strong>Hybrid Retrieval:</strong> Combines Vector similarity and BM25 keyword search.</li>
              <li>• <strong>Reranking:</strong> Re-orders combined chunks to select top evidence.</li>
              <li>• <strong>Document Comparison:</strong> Balanced retrieval across selected files.</li>
              <li>• <strong>Confidence:</strong> Verified evidence quality (High, Medium, Low).</li>
            </ul>
          </div>
        </div>
      </aside>

      {/* Right Main Area: Chat Component */}
      <div className="min-h-0 min-w-0 flex-1 bg-transparent">
        <div className="h-[calc(100dvh-7.25rem)] overflow-hidden rounded-none border-0 bg-card md:h-[calc(100dvh-3.75rem)] md:rounded-none">
          <ChatComponent
            documents={documents}
            selectedDocumentIds={selectedDocumentIds}
            filterMode={filterMode}
            onToggleSelectDocument={handleToggleSelectDocument}
          />
        </div>
      </div>
    </div>
  );
}
