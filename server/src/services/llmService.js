import Groq from 'groq-sdk';
import { config } from '../config.js';
import { logger } from './logger.js';

let groqClient = null;

function getGroqClient() {
  if (!groqClient && config.GROQ.apiKey) {
    groqClient = new Groq({ apiKey: config.GROQ.apiKey });
  }
  return groqClient;
}

export function buildSystemPrompt(contextChunks, confidenceLevel) {
  const contextString = contextChunks
    .map(
      (c, i) =>
        `[Source ${i + 1}] Document: ${c.document_name} | Page: ${c.page_number} | Chunk ID: ${c.chunk_id}\n${c.text}`
    )
    .join('\n\n---\n\n');

  let lowConfidenceInstruction = '';
  if (confidenceLevel === 'low') {
    lowConfidenceInstruction = `
WARNING: Retrieval confidence for this query is LOW.
If the provided excerpts do NOT contain direct and sufficient evidence to answer the question accurately, you MUST explicitly respond with:
"I could not find enough information in the uploaded documents to answer this confidently."
Do NOT attempt to guess, extrapolate, or bring in outside knowledge.
`;
  }

  return `You are a precise, document-grounded AI assistant. Your answers must be based STRICTLY on the retrieved context excerpts provided below.

INSTRUCTIONS:
1. Grounding: Answer using ONLY information directly stated in the context excerpts. Do NOT hallucinate or assume facts not present in the text.
2. Attribution: When citing facts or comparing documents, mention the document name and page number where appropriate.
3. Document Comparison: When asked to compare documents, clearly outline the similarities, differences, and specific metrics under clear headings or a markdown table.
4. Formatting: Use structured GitHub-flavored Markdown (concise paragraphs, bold text for key terms, bullet points, numbered steps, or markdown tables for comparative metrics).
${lowConfidenceInstruction}
If the context is completely empty or irrelevant, state:
"I could not find enough information in the uploaded documents to answer this confidently."

CONTEXT EXCERPTS:
${contextString || 'No relevant excerpts found.'}
`;
}

export async function generateAnswer({
  userQuery,
  retrievedChunks = [],
  confidenceLevel = 'medium',
  history = [],
}) {
  const sources = retrievedChunks.map((chunk) => ({
    documentId: chunk.document_id,
    documentName: chunk.document_name,
    pageNumber: chunk.page_number,
    chunkId: chunk.chunk_id,
    text: chunk.text,
    score: chunk.score,
  }));

  // If no chunks retrieved at all
  if (!retrievedChunks.length) {
    return {
      answer: 'I could not find enough information in the uploaded documents to answer this confidently.',
      sources: [],
    };
  }

  const systemPrompt = buildSystemPrompt(retrievedChunks, confidenceLevel);
  const client = getGroqClient();

  if (!client) {
    // Offline or test mock response
    return {
      answer: `[Offline Mode] Context retrieved from ${retrievedChunks.length} chunk(s):\n\n${retrievedChunks
        .map((c) => `- **${c.document_name}** (p.${c.page_number}): ${c.text.slice(0, 150)}...`)
        .join('\n')}`,
      sources,
    };
  }

  try {
    const messages = [{ role: 'system', content: systemPrompt }];

    // Append up to 4 recent messages for conversation grounding
    if (history && history.length > 0) {
      const recent = history
        .filter((m) => m && m.content && (m.role === 'user' || m.role === 'assistant'))
        .slice(-4);
      for (const msg of recent) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add current query
    messages.push({ role: 'user', content: userQuery });

    const completion = await client.chat.completions.create({
      model: config.GROQ.model,
      messages,
      temperature: 0.2,
    });

    const answer = completion.choices[0]?.message?.content || '';
    return {
      answer,
      sources,
    };
  } catch (error) {
    logger.error('Error generating LLM answer:', error.message || error);
    // If network connection to Groq is unavailable (e.g. offline, sandbox, test mode), return grounded context fallback
    const isConnErr =
      error.name === 'APIConnectionError' ||
      error.code === 'ENOTFOUND' ||
      error.cause?.code === 'ENOTFOUND' ||
      (error.message && error.message.includes('Connection error')) ||
      process.env.NODE_ENV === 'test';

    if (isConnErr) {
      return {
        answer: `[Offline/Fallback Mode] Based on retrieved document context:\n\n${retrievedChunks
          .map((c) => `- **${c.document_name}** (p.${c.page_number}): ${c.text.slice(0, 150)}...`)
          .join('\n')}`,
        sources,
      };
    }
    throw error;
  }
}
