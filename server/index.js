import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Queue } from 'bullmq';
import Groq from 'groq-sdk';
import { pipeline } from '@huggingface/transformers';
import { QdrantVectorStore } from '@langchain/qdrant';
import dotenv from "dotenv";

dotenv.config();

//const upload = multer({ dest: 'uploads/' })


const queue = new Queue('file-upload-queue', {
    connection: {
      host: 'localhost',
      port: '6379',
    },
  });

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${uniqueSuffix}-${file.originalname}`);
    },
  });
  
const upload = multer({ storage: storage });

const app = express();
app.use(cors());

app.post('/upload/pdf', upload.single('pdf'), async (req, res) => {
    await queue.add(
      'file-ready',
      JSON.stringify({
        filename: req.file.originalname,
        destination: req.file.destination,
        path: req.file.path,
      })
    );
    return res.json({ message: 'uploaded' });
});

const extractor = await pipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2'
);

const client = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

  app.get('/chat', async (req, res) => {
    const userQuery = req.query.message;
  
    // const embeddings = new OpenAIEmbeddings({
    //   model: 'text-embedding-3-small',
    //   apiKey: '',
    // });

    const embeddings = {
        embedDocuments: async (texts) => {  // For embedding documents
            const output = await extractor(texts, {
                pooling: 'mean',
                normalize: true,
            });
            return output.tolist();
        },
    
        embedQuery: async (text) => {   // For embedding user query
            const output = await extractor(text, {
                pooling: 'mean',
                normalize: true,
            });
            return output.tolist()[0];
        },
    };

    const vectorStore = await QdrantVectorStore.fromExistingCollection(
      embeddings,
      {
        url: 'http://localhost:6333',
        collectionName: 'langchainjs-testing',
      }
    );
    const ret = vectorStore.asRetriever({
      k: 2,
    });
    const result = await ret.invoke(userQuery); // result is the retrieved chunks from Qdrant
  
    // Feeding the model system prompt and the retireved chunks from Qdrant
    const SYSTEM_PROMPT = `
    You are helful AI Assistant who answers the user query based on the available context from PDF File.
    Context:
    ${JSON.stringify(result)}
    `;
  
    const chatResult = await client.chat.completions.create({
      model: 'qwen/qwen3-32b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userQuery },
      ],
    });
  
    return res.json({
      message: chatResult.choices[0].message.content,
      //docs: result,
    });
  });
  
  

app.get('/', (req, res) => {
  return res.json({ status: 'All Good!' });
});

app.listen(8000, () => console.log(`Server started on PORT:${8000}`));