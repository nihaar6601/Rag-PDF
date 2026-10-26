export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:8000';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_SIZE_LABEL = '10 MB';

export type DocumentStage =
  | 'uploading'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'indexing'
  | 'ready'
  | 'failed';

export type DocumentStatus = 'idle' | 'uploading' | 'preparing' | 'ready' | 'failed';

export type WorkspaceDocument = {
  id: string;
  name: string;
  filename: string;
  size: number;
  status: DocumentStatus;
  stage?: DocumentStage;
  progress?: number;
  error?: string | null;
  jobId?: string;
  pageCount?: number;
  chunkCount?: number;
  createdAt?: string;
};

export type JobStatusResponse = {
  jobId: string;
  documentId?: string | null;
  status: 'preparing' | 'ready' | 'failed';
  stage?: DocumentStage;
  progress?: number;
  filename: string | null;
  size: number | null;
  error: string | null;
};

export type UploadResponse = {
  jobId: string;
  documentId: string;
  filename: string;
  size: number;
};

export type SourceChunk = {
  documentId: string;
  documentName: string;
  pageNumber: number;
  chunkId: string;
  text: string;
  score?: number;
};

export type ChatAnswerResponse = {
  message: string;
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore?: number;
  confidenceReasons?: string[];
  sources: SourceChunk[];
  retrieval?: {
    queryUsed: string;
    vectorHits: number;
    keywordHits: number;
    mergedCandidates: number;
    topChunksRetrieved: number;
  };
};

function errorFromBody(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'error' in body) {
    const message = (body as { error?: unknown }).error;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export async function uploadPdf(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('pdf', file);

  const response = await fetch(`${API_URL}/upload/pdf`, {
    method: 'POST',
    body: formData,
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorFromBody(body, 'Upload failed. Please try again.'));
  }

  return body as UploadResponse;
}

export async function getDocuments(): Promise<WorkspaceDocument[]> {
  try {
    const response = await fetch(`${API_URL}/documents`);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return [];
    }
    return (body?.documents as WorkspaceDocument[]) || [];
  } catch {
    return [];
  }
}

export async function deleteDocument(documentId: string): Promise<boolean> {
  const response = await fetch(`${API_URL}/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
  return response.ok;
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const response = await fetch(`${API_URL}/jobs/${encodeURIComponent(jobId)}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorFromBody(body, 'Could not check document status.'));
  }
  return body as JobStatusResponse;
}

export async function askQuestion(
  message: string,
  options?: {
    documentIds?: string[];
    history?: { role: 'user' | 'assistant'; content: string }[];
  }
): Promise<ChatAnswerResponse> {
  const payload = {
    message,
    documentIds: options?.documentIds && options.documentIds.length > 0 ? options.documentIds : null,
    history: options?.history || [],
  };

  const response = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorFromBody(body, 'Could not answer that question. Please try again.'));
  }

  const answer = body?.answer || body?.message;
  if (typeof answer !== 'string' || !answer.trim()) {
    throw new Error('The answer came back empty. Please try again.');
  }

  return {
    message: answer,
    answer,
    confidence: body?.confidence || 'medium',
    confidenceScore: body?.confidenceScore,
    confidenceReasons: body?.confidenceReasons || [],
    sources: Array.isArray(body?.sources) ? body.sources : [],
    retrieval: body?.retrieval,
  };
}

export function isPdfFile(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatStageLabel(
  stage?: DocumentStage | DocumentStatus | string,
  status?: DocumentStatus
): string {
  if (status === 'preparing' && (!stage || stage === 'uploading')) {
    return 'Extracting text';
  }
  switch (stage) {
    case 'uploading':
      return 'Uploading';
    case 'extracting':
      return 'Extracting text';
    case 'chunking':
      return 'Creating chunks';
    case 'embedding':
      return 'Creating embeddings';
    case 'indexing':
      return 'Indexing';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Failed';
    default:
      return 'Processing';
  }
}
