import embedText from './embeddings';
import qdrant from './qdrantClient';

export async function suggestContextForEmail(emailText: string, limit = 5) {
  const v = await embedText(emailText);
  const resp = await qdrant.searchVector(v, limit);
  // qdrant returns result items with payload containing text
  return (resp ?? []).map((r: any) => ({ id: r.id, score: r.score, payload: r.payload }));
}

export default suggestContextForEmail;
