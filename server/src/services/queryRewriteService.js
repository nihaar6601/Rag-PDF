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

const PRONOUN_FOLLOWUP_PATTERN = /\b(it|this|that|these|those|they|them|he|she|their|its|what about|how about|and for|why|compare with|same|instead)\b/i;

export function isStandaloneQuery(query) {
  if (!query) return true;
  const trimmed = query.trim();
  // Short queries or queries with obvious follow-up pronouns need rewrite
  if (trimmed.split(/\s+/).length <= 4) {
    if (PRONOUN_FOLLOWUP_PATTERN.test(trimmed)) {
      return false;
    }
  }
  return !PRONOUN_FOLLOWUP_PATTERN.test(trimmed);
}

export async function rewriteQueryIfNeeded(query, history = []) {
  if (!config.ENABLE_QUERY_REWRITE || !history || history.length === 0) {
    return query;
  }

  // Filter valid recent history (last 4 messages)
  const recentHistory = history
    .filter((m) => m && m.content && (m.role === 'user' || m.role === 'assistant'))
    .slice(-4);

  if (recentHistory.length === 0) {
    return query;
  }

  // If query is already standalone and does not have follow-up phrasing, skip rewrite
  if (isStandaloneQuery(query) && query.trim().split(/\s+/).length >= 5) {
    return query;
  }

  const client = getGroqClient();
  if (!client) {
    return fallbackRewrite(query, recentHistory);
  }

  try {
    const historyText = recentHistory
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const prompt = `You are a search query optimizer. Given the recent conversation and a follow-up query, output a single standalone search query suitable for document retrieval.
If the follow-up query is already clear and standalone, output it exactly as is.
Do not answer the question. Do not add quotes or markdown. Output ONLY the standalone search query.

Conversation:
${historyText}

Follow-up query:
${query}

Standalone search query:`;

    const response = await client.chat.completions.create({
      model: config.GROQ.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 60,
    });

    const rewritten = response.choices[0]?.message?.content?.trim();
    if (rewritten && rewritten.length > 0 && !rewritten.includes('\n')) {
      logger.info(`Rewrote query: "${query}" -> "${rewritten}"`);
      return rewritten.replace(/^["']|["']$/g, '');
    }
  } catch (err) {
    logger.warn('Query rewrite using LLM failed, using fallback:', err.message);
  }

  return fallbackRewrite(query, recentHistory);
}

function fallbackRewrite(query, history) {
  // Simple heuristic: if query starts with "what about X" or "and X", combine with previous user query subject
  const lastUserMsg = [...history].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) return query;

  const match = query.match(/^(?:what about|how about|and|what of)\s+(.+)/i);
  if (match) {
    const focus = match[1].replace(/\?$/, '');
    // Extract base intent from last user question (e.g. "What was the revenue in 2025?" -> "revenue")
    const cleanPrev = lastUserMsg.content.replace(/\b(in \d{4}|\d{4})\b/gi, '').trim();
    return `${cleanPrev} ${focus}`.replace(/\s+/g, ' ').trim();
  }

  return query;
}
