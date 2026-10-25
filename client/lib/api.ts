export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_SIZE_LABEL = "10 MB";

export type DocumentStatus = "idle" | "uploading" | "preparing" | "ready" | "failed";

export type JobStatusResponse = {
  jobId: string;
  status: "preparing" | "ready" | "failed";
  filename: string | null;
  size: number | null;
  error: string | null;
};

export type UploadResponse = {
  jobId: string;
  filename: string;
  size: number;
};

function errorFromBody(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export async function uploadPdf(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("pdf", file);

  const response = await fetch(`${API_URL}/upload/pdf`, {
    method: "POST",
    body: formData,
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorFromBody(body, "Upload failed. Please try again."));
  }

  return body as UploadResponse;
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const response = await fetch(`${API_URL}/jobs/${encodeURIComponent(jobId)}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorFromBody(body, "Could not check document status."));
  }
  return body as JobStatusResponse;
}

export async function askQuestion(message: string): Promise<string> {
  const response = await fetch(
    `${API_URL}/chat?message=${encodeURIComponent(message)}`
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      errorFromBody(body, "Could not answer that question. Please try again.")
    );
  }

  const answer = body?.message;
  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error("The answer came back empty. Please try again.");
  }

  return answer;
}

export function isPdfFile(file: File) {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
