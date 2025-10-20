import fetch from 'cross-fetch';
import EmailDocument, { AICategory } from '../models/emailDocument';
import logger from '../logger';

const MODEL = process.env.GEMINI_MODEL || 'gemini-1.1';
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL_BASE = process.env.GENERATIVE_API_URL || 'https://generativelanguage.googleapis.com/v1beta2/models';

const systemInstruction =
  'You are an expert email classifier. Your task is to analyze the provided email text and categorize it into one of the following labels: Interested, Meeting Booked, Not Interested, Spam, or Out of Office. Return ONLY valid JSON with a single field `category` whose value is one of those labels.';

const allowed: AICategory[] = ['Interested', 'Meeting Booked', 'Not Interested', 'Spam', 'Out of Office'];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function classifyEmail(doc: EmailDocument): Promise<AICategory> {
  const prompt = `${systemInstruction}\n\nEMAIL SUBJECT:\n${doc.subject}\n\nEMAIL BODY:\n${doc.body}\n\nRespond with JSON like: {"category":"Interested"}`;

  const url = `${API_URL_BASE}/${MODEL}:generate${API_KEY ? `?key=${API_KEY}` : ''}`;

  const body = {
    prompt: {
      text: prompt,
    },
    temperature: 0.0,
    maxOutputTokens: 100,
  };

  let attempt = 0;
  const maxAttempts = 5;
  let wait = 1000;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const headers: any = { 'Content-Type': 'application/json' };
      if (!API_KEY && process.env.GENERATIVE_AUTH_BEARER) {
        headers['Authorization'] = `Bearer ${process.env.GENERATIVE_AUTH_BEARER}`;
      }

      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`LLM response ${resp.status}: ${text}`);
      }

      const text = await resp.text();
      // try to extract JSON substring
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error('No JSON found in model response');
      }
      const jsonStr = text.slice(jsonStart, jsonEnd + 1);
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        throw new Error('Failed to parse JSON from model: ' + e);
      }

      const cat = parsed.category;
      if (typeof cat !== 'string' || !allowed.includes(cat as AICategory)) {
        throw new Error('Model returned invalid category: ' + String(cat));
      }

      return cat as AICategory;
    } catch (err: any) {
      if (attempt >= maxAttempts) {
        logger.error({ err }, '[AI] classification failed after retries');
        return 'Uncategorized';
      }
      const backoff = wait * Math.pow(2, attempt - 1);
      logger.warn({ err, attempt, backoff }, `[AI] classification attempt ${attempt} failed, retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }

  return 'Uncategorized';
}

export default classifyEmail;
