import { Worker } from 'bullmq';
import { QdrantVectorStore } from '@langchain/qdrant';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { pipeline } from '@huggingface/transformers';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

const extractor = await pipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2'
);

const worker = new Worker(
    'file-upload-queue',
    async (job) => {
        console.log(`Job:`, job.data);
        const data = JSON.parse(job.data);
        console.log(`Data:`, data);
        /*
        Path: data.path
        read the pdf from path,
        chunk the pdf,
        call the openai embedding model for every chunk,
        store the chunk in qdrant db
        */

        // Load the PDF
        console.log(`Im here now:`);
        const loader = new PDFLoader(data.path);    // Loading the PDF file
        console.log(`Im here now 2:`);
        const docs = await loader.load();           // Creating docs from the PDF file
        console.log("Docs Length ", docs.length)
        console.log(`Im here now 3:`);

        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });
        
        const splitDocs = await splitter.splitDocuments(docs);  // Chunking the documents
        console.log(`Chunks created:`, splitDocs.length);

        
        
        const embeddings = {                                // Passing the chunks to local HuggingFace embedding model
            embedDocuments: async (texts) => {
                const output = await extractor(texts, {     // embeddings object has the vectors
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

        console.log(`Im here now 4:`);

        const vectorStore = await QdrantVectorStore.fromExistingCollection(     // Connecting to the Qdrant vectorStore
            embeddings,
        {
            url: 'http://localhost:6333',
            collectionName: 'langchainjs-testing',
        }
        );
        console.log(`Im here now 5:`);
        await vectorStore.addDocuments(splitDocs);      // Loading the vecotors in the Qdrant vector DB
        console.log(`Completed`);
    }, 
    {
        concurrency: 100,
        connection: {
          host: 'localhost',
          port: '6379',
        },
      });