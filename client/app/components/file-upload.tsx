"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, FileText, LoaderCircle, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DocumentStatus,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  formatFileSize,
  isPdfFile,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type FileUploadProps = {
  filename?: string;
  fileSize?: number;
  status: DocumentStatus;
  error?: string | null;
  hasJob?: boolean;
  onFileChosen: (file: File) => void;
  onRetry: () => void;
  disabled?: boolean;
};

const statusCopy: Record<
  Exclude<DocumentStatus, "idle">,
  { label: string; detail: string }
> = {
  uploading: {
    label: "Uploading",
    detail: "Sending your PDF to the server.",
  },
  preparing: {
    label: "Preparing your document",
    detail: "This can take a moment after the upload finishes.",
  },
  ready: {
    label: "Ready to chat",
    detail: "You can ask questions about your uploaded PDFs.",
  },
  failed: {
    label: "Could not add this file",
    detail: "You can try again with a PDF under the size limit.",
  },
};

export default function FileUploadComponent({
  filename,
  fileSize,
  status,
  error,
  hasJob,
  onFileChosen,
  onRetry,
  disabled,
}: FileUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const busy = status === "uploading" || status === "preparing";

  const acceptFile = (file: File | undefined) => {
    if (!file || busy || disabled) return;
    onFileChosen(file);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files.item(0) || undefined);
  };

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a PDF by dropping it here or choosing a file"
        aria-disabled={busy || disabled}
        onClick={() => {
          if (!busy && !disabled) inputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !busy && !disabled) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy && !disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-xl border border-dashed bg-card p-4 text-center shadow-sm outline-none transition-colors",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          isDragging ? "border-primary bg-primary/5" : "border-border",
          busy || disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer hover:border-primary/40"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={busy || disabled}
          onChange={(event) => {
            acceptFile(event.target.files?.item(0) || undefined);
            event.target.value = "";
          }}
        />
        <Upload className="mx-auto size-5 text-primary" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-foreground">Drop a PDF here</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          PDF files up to {MAX_FILE_SIZE_LABEL}. Larger files are rejected before
          processing.
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-3"
          disabled={busy || disabled}
          onClick={(event) => {
            event.stopPropagation();
            inputRef.current?.click();
          }}
        >
          Choose PDF
        </Button>
      </div>

      {filename ? (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 items-center justify-center rounded-md bg-muted text-foreground">
              <FileText className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{filename}</p>
              {typeof fileSize === "number" ? (
                <p className="text-xs text-muted-foreground">{formatFileSize(fileSize)}</p>
              ) : null}
              {status !== "idle" ? (
                <StatusLine status={status} error={error} hasJob={hasJob} />
              ) : null}
            </div>
          </div>
          {status === "failed" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={onRetry}
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {status === "failed" && !filename ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

function StatusLine({
  status,
  error,
  hasJob,
}: {
  status: Exclude<DocumentStatus, "idle">;
  error?: string | null;
  hasJob?: boolean;
}) {
  const copy =
    status === "failed" && hasJob
      ? {
          label: "Processing failed",
          detail: "You can try uploading the same file again.",
        }
      : statusCopy[status];
  const Icon =
    status === "ready"
      ? CheckCircle2
      : status === "failed"
        ? AlertCircle
        : LoaderCircle;

  return (
    <div className="mt-2 space-y-1" aria-live="polite">
      <p
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          status === "failed" ? "text-destructive" : "text-foreground"
        )}
      >
        <Icon
          className={cn(
            "size-3.5",
            (status === "uploading" || status === "preparing") &&
              "motion-safe:animate-spin"
          )}
          aria-hidden="true"
        />
        {copy.label}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {status === "failed" && error ? error : copy.detail}
      </p>
    </div>
  );
}

export function validateSelectedFile(file: File): string | null {
  if (!isPdfFile(file)) {
    return "Please choose a PDF file.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `That PDF is too large. The limit is ${MAX_FILE_SIZE_LABEL}.`;
  }
  return null;
}
