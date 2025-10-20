import { Client } from '@elastic/elasticsearch';
import EmailDocument from '../models/emailDocument';

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX = process.env.ELASTICSEARCH_INDEX || 'emails';

const client = new Client({ node: ES_URL });

export async function ensureIndex() {
  const exists = await client.indices.exists({ index: INDEX });
  if (!exists) {
    await client.indices.create({
      index: INDEX,
      mappings: {
        properties: {
          subject: { type: 'text' },
          body: { type: 'text' },
          accountId: { type: 'keyword' },
          folder: { type: 'keyword' },
          date: { type: 'date' },
          aiCategory: { type: 'keyword' },
          indexedAt: { type: 'date' },
        },
      },
    });
  }
}

export async function indexEmail(doc: EmailDocument) {
  return client.index({ index: INDEX, id: doc.id, document: doc });
}

export async function updateEmailCategory(id: string, category: EmailDocument['aiCategory']) {
  return client.update({ index: INDEX, id, doc: { aiCategory: category } });
}

export async function getDocumentById(id: string): Promise<any> {
  return client.get({ index: INDEX, id });
}

export default client;
