const embedText = require('../src/ai/embeddings').default;
const qdrant = require('../src/ai/qdrantClient').default;

async function ingestItems(items) {
  await qdrant.ensureCollection();
  for (const it of items) {
    const vec = await embedText(it.text);
    await qdrant.upsertPoint(it.id, vec, Object.assign({ text: it.text }, it.meta || {}));
  }
}

module.exports = { ingestItems };
