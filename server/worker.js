import { Worker } from 'bullmq';
import { config } from './src/config.js';
import { processPdfDocument } from './src/services/documentService.js';
import { logger } from './src/services/logger.js';

function parseJobPayload(data) {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return data || {};
}

const worker = new Worker(
  'file-upload-queue',
  async (job) => {
    const data = parseJobPayload(job.data);

    if (!data?.path) {
      throw new Error('The uploaded file path is missing.');
    }

    const documentId = data.documentId || `doc_${job.id}`;
    const filename = data.filename || 'Uploaded Document';

    logger.info(`Worker processing job ${job.id} for document ${filename} (${documentId})`);

    const result = await processPdfDocument({
      documentId,
      filePath: data.path,
      filename,
      onProgress: async (progressData) => {
        await job.updateProgress(progressData);
      },
    });

    return result;
  },
  {
    concurrency: 1,
    connection: config.REDIS,
  }
);

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err);
});

worker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed successfully`);
});

export default worker;
