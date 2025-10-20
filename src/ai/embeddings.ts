import fetch from 'cross-fetch';
import logger from '../logger';

const MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'embedding-001';
const API_KEY = process.env.GEMINI_API_KEY;
const API_URL_BASE = process.env.GENERATIVE_API_URL || 'https://generativelanguage.googleapis.com/v1beta2/models';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Convert text to an embedding vector using the configured embedding model.
 * Note: The exact provider API shape may vary; this function attempts to parse common output formats.
 */
export async function embedText(text: string): Promise<number[]> {
  const url = `${API_URL_BASE}/${MODEL}:embed${API_KEY ? `?key=${API_KEY}` : ''}`;
  const body = { input: text };

  let attempt = 0;
  const maxAttempts = 4;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const headers: any = { 'Content-Type': 'application/json' };
      if (!API_KEY && process.env.GENERATIVE_AUTH_BEARER) headers['Authorization'] = `Bearer ${process.env.GENERATIVE_AUTH_BEARER}`;
      const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`embed resp ${resp.status}: ${t}`);
      }
      const txt = await resp.text();
      // try to parse JSON and extract embedding array
      let data: any;
      try {
        data = JSON.parse(txt);
      } catch (e) {
        throw new Error('failed to parse embed JSON: ' + e);
      }

      // Common shapes: data.output[0].embedding OR outputs[0].embedding OR embedding
      const emb = data?.output?.[0]?.embedding ?? data?.outputs?.[0]?.embedding ?? data?.embedding ?? data?.data?.[0]?.embedding;
      if (!emb || !Array.isArray(emb)) throw new Error('no embedding found in response');
      return emb as number[];
    } catch (err: any) {
      if (attempt >= maxAttempts) throw err;
      const backoff = 500 * Math.pow(2, attempt - 1);
      logger.warn({ err, attempt, backoff }, `[embeddings] attempt ${attempt} failed, retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }

  throw new Error('failed to embed');
}

export default embedText;
