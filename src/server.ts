import express, { Request, Response } from 'express';
import client from './indexers/elasticsearch';
import logger from './logger';
import EmailDocument from './models/emailDocument';
import { suggestContextForEmail } from './ai/rag';
import { generateText } from './ai/generator';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Return configured accounts based on environment
app.get('/api/accounts', (req: Request, res: Response) => {
  const accounts: { id: string; user: string }[] = [];
  for (let i = 1; i <= 5; i++) {
    const user = process.env[`IMAP_USER_${i}`];
    if (user) accounts.push({ id: `acct-${i}`, user });
  }
  res.json(accounts);
});

// Paginated list of all emails (no search)
app.get('/api/emails', async (req: Request, res: Response) => {
  const page = Math.max(0, Number(req.query.page || 0));
  const size = Math.min(100, Number(req.query.size || 25));
  try {
    const r = await client.search({
      index: process.env.ELASTICSEARCH_INDEX || 'emails',
      from: page * size,
      size,
      body: { query: { match_all: {} }, sort: [{ date: { order: 'desc' } }] },
    } as any);
    const hits = r.hits.hits.map((h: any) => ({ id: h._id, ...h._source } as EmailDocument));
    res.json({ total: r.hits.total, hits });
  } catch (err) {
    logger.error({ err }, 'ES query failed');
    res.status(500).json({ error: 'search_failed' });
  }
});

// Suggest a reply using RAG: fetch contexts from Qdrant and call LLM
app.post('/api/emails/:id/suggest-reply', async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: 'missing id' });
  const providedText = (req.body && req.body.text) as string | undefined;

  try {
    // get email text: prefer provided text, otherwise fetch from ES
    let emailText: string | undefined = providedText;
    if (!emailText) {
  const r: any = await import('./indexers/elasticsearch').then(m => m.getDocumentById(id));
  emailText = (r._source as any)?.body ?? '';
    }

    if (!emailText) return res.status(400).json({ error: 'no_email_text' });

    // retrieve top-K contexts
    const contexts = await suggestContextForEmail(emailText as string, 3);

    const systemInstruction = 'You are a helpful assistant that drafts professional, concise email replies based ONLY on the provided context.';

    const assembled = [
      systemInstruction,
      '\n--- Retrieved Context ---\n',
      ...contexts.map((c: any, i: number) => `Context ${i + 1}: ${c.payload?.text || JSON.stringify(c.payload)}`),
      '\n--- Original Email ---\n',
      emailText,
      '\n--- Instruction ---\nBased ONLY on the context provided and the original email, draft a professional and helpful reply. Be concise.'
    ].join('\n');

    const reply = await generateText(assembled, 256);
    res.json({ reply });
  } catch (err) {
    logger.error({ err }, 'suggest-reply failed');
    res.status(500).json({ error: 'suggest_failed' });
  }
});

app.get('/api/emails/search', async (req: Request, res: Response) => {
  const q = (req.query.q as string) || '';
  const accountId = req.query.accountId as string | undefined;
  const folder = req.query.folder as string | undefined;
  const page = Math.max(0, Number(req.query.page || 0));
  const size = Math.min(100, Number(req.query.size || 25));

  const must: any[] = [];
  if (q) must.push({ multi_match: { query: q, fields: ['subject', 'body'] } });

  const filter: any[] = [];
  if (accountId) filter.push({ term: { accountId } });
  if (folder) filter.push({ term: { folder } });

  const esQuery: any = {
    index: process.env.ELASTICSEARCH_INDEX || 'emails',
    from: page * size,
    size,
    body: {
      query: {
        bool: {
          must: must.length ? must : [{ match_all: {} }],
          filter,
        },
      },
    },
  };

  try {
    const r = await client.search(esQuery as any);
    const hits = r.hits.hits.map((h: any) => ({ id: h._id, ...h._source } as EmailDocument));
    res.json({ total: r.hits.total, hits });
  } catch (err) {
    logger.error({ err }, 'ES query failed');
    res.status(500).json({ error: 'search_failed' });
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => logger.info(`Server listening on ${port}`));

export default app;
