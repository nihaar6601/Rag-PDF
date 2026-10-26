"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  WorkspaceDocument,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  formatFileSize,
  formatStageLabel,
  isPdfFile,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type FileUploadProps = {
  documents: WorkspaceDocument[];
  selectedDocumentIds: string[];
  filterMode: "all" | "selected";
  onFilterModeChange: (mode: "all" | "selected") => void;
  onToggleSelectDocument: (documentId: string) => void;
  onSelectAllDocuments: () => void;
  onFilesChosen: (files: File[]) => void;
  onRemoveDocument: (documentId: string) => void;
  onRetryDocument?: (document: WorkspaceDocument) => void;
  disabled?: boolean;
};

export function validateSelectedFile(file: File): string | null {
  if (!isPdfFile(file)) {
    return "Please choose a PDF file.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `That PDF is too large. The limit is ${MAX_FILE_SIZE_LABEL}.`;
  }
  return null;
}

export default function FileUploadComponent({
  documents = [],
  selectedDocumentIds = [],
  filterMode = "all",
  onFilterModeChange,
  onToggleSelectDocument,
  onSelectAllDocuments,
  onFilesChosen,
  onRemoveDocument,
  onRetryDocument,
  disabled,
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const readyDocs = documents.filter((d) => d.status === "ready");
  const inProgressDocs = documents.filter(
    (d) => d.status === "uploading" || d.status === "preparing"
  );

  const acceptFiles = (fileList: FileList | null) => {
    if (!fileList || !fileList.length || disabled) return;
    const files = Array.from(fileList);
    onFilesChosen(files);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!disabled) {
      acceptFiles(event.dataTransfer.files);
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload Drop Zone / Button */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload PDF files by dropping here or choosing"
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !disabled) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-xl border border-dashed bg-card p-3.5 text-center shadow-sm outline-none transition-colors",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          isDragging ? "border-primary bg-primary/5" : "border-border",
          disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:border-primary/40"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            acceptFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Upload className="mx-auto size-4 text-primary" aria-hidden="true" />
        <p className="mt-1 text-xs font-medium text-foreground">
          Drop PDFs here or choose files
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Up to {MAX_FILE_SIZE_LABEL} per file
        </p>
        <Button
          type="button"
          size="xs"
          variant="secondary"
          className="mt-2"
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            inputRef.current?.click();
          }}
        >
          <Plus data-icon="inline-start" className="size-3" />
          Add PDFs
        </Button>
      </div>

      {/* Workspace Header & Filter Mode */}
      {documents.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground">
              Workspace ({documents.length})
            </span>
            <span className="text-muted-foreground">
              {readyDocs.length} ready
              {inProgressDocs.length > 0 ? `, ${inProgressDocs.length} processing` : ""}
            </span>
          </div>

          {/* Ask Across Mode Selection */}
          <div className="rounded-lg border border-border bg-muted/40 p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-foreground">Ask across:</p>
              {filterMode === "selected" && onSelectAllDocuments ? (
                <button
                  type="button"
                  onClick={onSelectAllDocuments}
                  className="text-[11px] text-primary hover:underline"
                >
                  Select all
                </button>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
                <input
                  type="radio"
                  name="filterMode"
                  value="all"
                  checked={filterMode === "all"}
                  onChange={() => onFilterModeChange("all")}
                  className="accent-primary"
                />
                <span>All documents ({readyDocs.length})</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
                <input
                  type="radio"
                  name="filterMode"
                  value="selected"
                  checked={filterMode === "selected"}
                  onChange={() => onFilterModeChange("selected")}
                  className="accent-primary"
                />
                <span>Selected documents ({selectedDocumentIds.length})</span>
              </label>
            </div>
          </div>

          {/* Document List */}
          <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
            {documents.map((doc) => {
              const isSelected = selectedDocumentIds.includes(doc.id);
              const isReady = doc.status === "ready";
              const isFailed = doc.status === "failed";
              const isBusy = doc.status === "uploading" || doc.status === "preparing";

              return (
                <div
                  key={doc.id}
                  className={cn(
                    "group relative rounded-lg border p-2.5 shadow-xs transition-colors",
                    isSelected && filterMode === "selected"
                      ? "border-primary/50 bg-primary/5"
                      : "border-border bg-card hover:border-border/80"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    {/* Checkbox for selection */}
                    <div className="mt-0.5">
                      <input
                        type="checkbox"
                        checked={filterMode === "all" ? isReady : isSelected}
                        disabled={!isReady || filterMode === "all"}
                        onChange={() => onToggleSelectDocument(doc.id)}
                        className={cn(
                          "size-3.5 rounded border-border accent-primary",
                          filterMode === "all" ? "opacity-60 cursor-default" : "cursor-pointer"
                        )}
                        title={
                          filterMode === "all"
                            ? "All ready documents are included in queries"
                            : isSelected
                            ? "Deselect document"
                            : "Select document"
                        }
                      />
                    </div>

                    {/* Doc details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p
                          className="truncate text-xs font-medium text-foreground"
                          title={doc.name}
                        >
                          {doc.name}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="size-6 p-0 text-muted-foreground hover:text-destructive opacity-80 group-hover:opacity-100"
                          onClick={() => onRemoveDocument(doc.id)}
                          title="Remove document from workspace"
                          aria-label={`Remove ${doc.name}`}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>

                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{formatFileSize(doc.size)}</span>
                        {doc.chunkCount ? (
                          <>
                            <span>•</span>
                            <span>{doc.chunkCount} chunks</span>
                          </>
                        ) : null}
                      </div>

                      {/* Status / Stage Badge */}
                      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                        {isBusy ? (
                          <>
                            <LoaderCircle className="size-3 animate-spin text-primary shrink-0" />
                            <span className="text-primary font-medium">
                              {formatStageLabel(doc.stage, doc.status)}
                            </span>
                          </>
                        ) : isReady ? (
                          <>
                            <CheckCircle2 className="size-3 text-emerald-600 shrink-0" />
                            <span className="text-muted-foreground">Ready</span>
                          </>
                        ) : isFailed ? (
                          <>
                            <AlertCircle className="size-3 text-destructive shrink-0" />
                            <span className="text-destructive font-medium">
                              {doc.error || "Failed"}
                            </span>
                            {onRetryDocument ? (
                              <button
                                type="button"
                                onClick={() => onRetryDocument(doc)}
                                className="ml-1 underline text-destructive hover:text-foreground"
                              >
                                Retry
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
