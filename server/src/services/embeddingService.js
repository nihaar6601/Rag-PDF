import { pipeline } from '@huggingface/transformers';
import { config } from '../config.js';

let extractorInstance = null;

export async function getExtractor() {
  if (!extractorInstance) {
    extractorInstance = await pipeline('feature-extraction', config.EMBEDDING_MODEL);
  }
  return extractorInstance;
}

export const embeddings = {
  embedDocuments: async (texts) => {
    const extractor = await getExtractor();
    const output = await extractor(texts, {
      pooling: 'mean',
      normalize: true,
    });
    return output.tolist();
  },
  embedQuery: async (text) => {
    const extractor = await getExtractor();
    const output = await extractor(text, {
      pooling: 'mean',
      normalize: true,
    });
    return output.tolist()[0];
  },
};
