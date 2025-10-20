import fetch from 'cross-fetch';
import logger from '../logger';

const MODEL = process.env.GEMINI_MODEL || 'gemini-1.1';
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL_BASE = process.env.GENERATIVE_API_URL || 'https://generativelanguage.googleapis.com/v1beta2/models';

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export async function generateText(prompt: string, maxTokens = 256): Promise<string> {
  const url = `${API_URL_BASE}/${MODEL}:generate${API_KEY ? `?key=${API_KEY}` : ''}`;
  const body = {
    prompt: { text: prompt },
    temperature: 0.0,
    maxOutputTokens: maxTokens,
  };

  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const headers: any = { 'Content-Type': 'application/json' };
      if (!API_KEY && process.env.GENERATIVE_AUTH_BEARER) headers['Authorization'] = `Bearer ${process.env.GENERATIVE_AUTH_BEARER}`;
      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`LLM gen error ${resp.status}: ${t}`);
      }
      const text = await resp.text();
      // parse JSON if possible, otherwise return raw
      try {
        const jsonStart = text.indexOf('{');
        if (jsonStart !== -1) {
          const parsed = JSON.parse(text.slice(jsonStart));
          // try common shapes: output[0].content or output[0].text or candidates
          const out = parsed?.output?.[0]?.content?.[0]?.text ?? parsed?.output?.[0]?.text ?? parsed?.candidates?.[0]?.content ?? parsed?.candidates?.[0]?.message ?? null;
          if (typeof out === 'string') return out;
        }
      } catch (e) {
        // fallthrough to returning raw
      }
      return text;
    } catch (err: any) {
      if (attempt >= maxAttempts) throw err;
      const backoff = 500 * Math.pow(2, attempt - 1);
      logger.warn({ err, attempt, backoff }, `[generator] attempt ${attempt} failed, retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw new Error('generateText failed');
}

export default generateText;
