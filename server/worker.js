import { Worker } from 'bullmq';
import { QdrantVectorStore } from '@langchain/qdrant';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { pipeline } from '@huggingface/transformers';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

const extractor = await pipeline(
  'feature-extraction',
  'Xenova/all-MiniLM-L6-v2'
);

function parseJobPayload(data) {
  if (typeof data === 'string') {
    return JSON.parse(data);
  }
  return data;
}

const worker = new Worker(
  'file-upload-queue',
  async (job) => {
    const data = parseJobPayload(job.data);

    if (!data?.path) {
      throw new Error('The uploaded file path is missing.');
    }

    const loader = new PDFLoader(data.path);
    const docs = await loader.load();

    if (!docs.length) {
      throw new Error('This PDF has no readable text.');
    }

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const splitDocs = await splitter.splitDocuments(docs);

    const embeddings = {
      embedDocuments: async (texts) => {
        const output = await extractor(texts, {
          pooling: 'mean',
          normalize: true,
        });
        return output.tolist();
      },
      embedQuery: async (text) => {
        const output = await extractor(text, {
          pooling: 'mean',
          normalize: true,
        });
        return output.tolist()[0];
      },
    };

    const storeOptions = {
      url: 'http://localhost:6333',
      collectionName: 'langchainjs-testing',
    };

    try {
      const vectorStore = await QdrantVectorStore.fromExistingCollection(
        embeddings,
        storeOptions
      );
      await vectorStore.addDocuments(splitDocs);
    } catch {
      await QdrantVectorStore.fromDocuments(splitDocs, embeddings, storeOptions);
    }
  },
  {
    concurrency: 1,
    connection: {
      host: 'localhost',
      port: 6379,
    },
  }
);

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});
