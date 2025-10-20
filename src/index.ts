import 'dotenv/config';
import ImapClient from './imap/imapClient';
import logger from './logger';
import { simpleParser } from 'mailparser';
import { htmlToText } from 'html-to-text';
import { ensureIndex, indexEmail, updateEmailCategory } from './indexers/elasticsearch';
import { classifyEmail } from './ai/classifier';
import EmailDocument from './models/emailDocument';

const host = process.env.IMAP_HOST || 'imap.example.com';
const port = process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : 993;
const tls = process.env.IMAP_TLS ? process.env.IMAP_TLS.toLowerCase() === 'true' : true;

function makeConfig(idSuffix: number) {
  const user = process.env[`IMAP_USER_${idSuffix}`];
  const pass = process.env[`IMAP_PASS_${idSuffix}`];
  if (!user || !pass) return null;
  const folders = (process.env.IMAP_FOLDERS || 'INBOX').split(',').map((s) => s.trim());
  return {
    id: `acct-${idSuffix}`,
    user,
    password: pass,
    host,
    port,
    tls,
    folders,
  } as const;
}

const configs = [makeConfig(1), makeConfig(2)].filter(Boolean) as any;

if (configs.length === 0) {
  logger.error('No IMAP accounts configured. Copy .env.example to .env and set IMAP_USER_1 / IMAP_PASS_1 etc.');
  process.exit(1);
}

const clients = configs.map((c: any) => {
  const client = new ImapClient(c);
  client.on('connected', (v) => logger.info('[IMAP] connected', v));
  client.on('boxOpened', (v) => logger.info('[IMAP] box opened', v));
  client.on('initialSyncComplete', (v) => logger.info('[IMAP] initial sync complete', v));
  client.on('mail', (v) => logger.info('[IMAP] mail event', v));
  client.on('expunge', (v) => logger.info('[IMAP] expunge', v));
  client.on('error', (e) => logger.error({ err: e }, '[IMAP] error'));
  client.on('idleWatchdog', (e) => logger.warn('[IMAP] idle watchdog', e));

  // When a parsed envelope is emitted, fetch the full message and index
  client.on('message', async (v: any) => {
  logger.debug({ envelope: v.envelope }, '[IMAP] message envelope');
    try {
      const uid = v.envelope?.uid;
  if (!uid) return logger.warn('[IMAP] message has no uid, skipping');
      const raw = await client.fetchFullMessageByUid(uid);
      const parsed = await simpleParser(raw);
      const text = parsed.text ?? (parsed.html ? htmlToText(parsed.html) : '');

      const toAddrs: string[] = (() => {
        const t = parsed.to as any;
        if (!t) return [];
        if (Array.isArray(t)) {
          return t.flatMap((a: any) => (a?.value ?? []).map((p: any) => p.address));
        }
        return (t?.value ?? []).map((p: any) => p.address);
      })();

      const doc: EmailDocument = {
        id: parsed.messageId ?? `${c.id}-${uid}`,
        accountId: c.id,
        folder: v.envelope?.mailbox ?? 'INBOX',
        subject: parsed.subject ?? v.envelope?.subject ?? '(no subject)',
        body: text,
        from: parsed.from?.text ?? v.envelope?.from ?? '',
        to: toAddrs,
        date: parsed.date ?? new Date(),
        aiCategory: 'Uncategorized',
        indexedAt: new Date(),
      };

  await indexEmail(doc);
  logger.info({ id: doc.id }, '[ES] indexed');

      // run AI classification (fire-and-forget but with error handling)
      (async () => {
        try {
          const cat = await classifyEmail(doc);
          await updateEmailCategory(doc.id, cat);
          logger.info({ id: doc.id, category: cat }, '[AI] classified');

          if (cat === 'Interested') {
            // trigger Slack and generic webhooks
            try {
              const { triggerWebhooks } = await import('./integrations/webhooks');
              await triggerWebhooks(doc);
            } catch (err) {
              logger.error({ err }, '[Webhook] trigger failed');
            }
          }
        } catch (err) {
          logger.error({ err }, '[AI] classify/update failed');
        }
      })();
    } catch (err) {
      logger.error({ err }, '[IMAP->ES] failed to index message');
    }
  });

  return client;
});

for (const c of clients) c.connect();

// Ensure index exists before messages arrive
ensureIndex().catch((err) => logger.error({ err }, '[ES] ensureIndex error'));

process.on('SIGINT', () => {
  logger.info('Shutting down IMAP clients...');
  for (const c of clients) c.close();
  process.exit(0);
});
