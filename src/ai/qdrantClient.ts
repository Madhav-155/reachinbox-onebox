import fetch from 'cross-fetch';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = process.env.QDRANT_COLLECTION || 'product_data';

export async function ensureCollection() {
  const url = `${QDRANT_URL}/collections/${COLLECTION}`;
  const r = await fetch(url);
  if (r.status === 200) return;
  // create with simple vector size placeholder
  await fetch(`${QDRANT_URL}/collections/${COLLECTION}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vectors: { size: 1536, distance: 'Cosine' } }),
  });
}

export async function upsertPoint(id: string, vector: number[], payload: any) {
  const url = `${QDRANT_URL}/collections/${COLLECTION}/points?wait=true`;
  const body = { points: [{ id, vector, payload }] };
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('qdrant upsert failed: ' + await r.text());
}

export async function searchVector(vector: number[], limit = 5) {
  const url = `${QDRANT_URL}/collections/${COLLECTION}/points/search`;
  const body = { vector, limit };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('qdrant search failed: ' + await r.text());
  const data = await r.json();
  return data.result ?? data;
}

export default { ensureCollection, upsertPoint, searchVector };
