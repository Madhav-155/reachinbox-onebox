import Imap from 'node-imap';
import { EventEmitter } from 'events';
import { inspect } from 'util';

export type ImapAccountConfig = {
  id: string;
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
  folders?: string[];
};

export type MailEnvelope = {
  uid: number;
  flags: string[];
  date?: Date;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachments?: boolean;
};

/**
 * ImapClient wraps node-imap to provide:
 * - initial sync (SINCE 30 days)
 * - IDLE listening for new mail and expunge
 * - watchdog to reissue IDLE and reconnect
 */
export class ImapClient extends EventEmitter {
  private imap: Imap;
  private cfg: ImapAccountConfig;
  private idleTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(cfg: ImapAccountConfig) {
    super();
    this.cfg = cfg;
    this.imap = new Imap({
      user: cfg.user,
      password: cfg.password,
      host: cfg.host,
      port: cfg.port,
      tls: cfg.tls,
      authTimeout: 10000,
      keepalive: {
        interval: 10000,
        idleInterval: 300000,
      },
    });

    this.handleEvents();
  }

  private handleEvents() {
    this.imap.once('ready', () => void this.onReady());
  this.imap.on('error', (err: Error) => this.onError(err));
  this.imap.on('end', () => this.onEnd());
  // node-imap emits 'mail' when new messages are detected and 'expunge' for deletions
  this.imap.on('mail', (numNewMsgs: number) => this.onMail(numNewMsgs));
  this.imap.on('expunge', (seqno: number) => this.onExpunge(seqno));
  }

  connect() {
    this.closed = false;
    this.imap.connect();
  }

  private async onReady() {
    this.emit('connected', { accountId: this.cfg.id });
    // Perform initial sync of folders
    const folders = this.cfg.folders ?? ['INBOX'];
    for (const folder of folders) {
      await this.openBox(folder);
      await this.initialSync(folder);
      // After initial sync, start IDLE on the box
      this.startIdle();
    }
  }

  private onError(err: Error) {
    this.emit('error', { accountId: this.cfg.id, error: err });
    // schedule reconnect
    this.scheduleReconnect();
  }

  private onEnd() {
    this.emit('disconnected', { accountId: this.cfg.id });
    if (!this.closed) this.scheduleReconnect();
  }

  private onMail(numNewMsgs: number) {
    this.emit('mail', { accountId: this.cfg.id, count: numNewMsgs });
    // fetch the newly-arrived messages metadata only
    this.fetchRecent(1).catch((err) => this.emit('error', { accountId: this.cfg.id, error: err }));
  }

  private onExpunge(seqno: number) {
    this.emit('expunge', { accountId: this.cfg.id, seqno });
  }

  private openBox(mailbox: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.openBox(mailbox, true, (err: Error | null, box: any) => {
        if (err) return reject(err);
        this.emit('boxOpened', { accountId: this.cfg.id, mailbox, exists: box?.messages?.total });
        resolve();
      });
    });
  }

  private initialSync(mailbox: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Search for messages since 30 days ago
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const criteria = [['SINCE', d.toISOString().slice(0, 10)]];

      this.imap.search(criteria as any, (err: Error | null, results?: number[]) => {
        if (err) return reject(err);
        if (!results || results.length === 0) {
          this.emit('initialSyncComplete', { accountId: this.cfg.id, mailbox, count: 0 });
          return resolve();
        }

        const fetcher = this.imap.fetch(results, { bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)', struct: true });
        const envelopes: MailEnvelope[] = [];

        fetcher.on('message', (msg: any, seqno: number) => {
          const envelope: Partial<MailEnvelope> = { uid: 0, flags: [] };

          msg.on('attributes', (attrs: any) => {
            envelope.uid = attrs.uid;
            envelope.flags = attrs.flags ?? [];
            if (attrs.struct) {
              envelope.hasAttachments = this.structHasAttachment(attrs.struct);
            }
          });

          msg.on('body', (stream: NodeJS.ReadableStream, info: any) => {
            let buffer = '';
            stream.on('data', (chunk: Buffer | string) => (buffer += chunk.toString('utf8')));
            stream.once('end', () => {
              // parse header fields simply
              const lines = buffer.split(/\r?\n/).map((l) => l.trim());
              for (const line of lines) {
                if (line.toLowerCase().startsWith('subject:')) envelope.subject = line.slice(8).trim();
                if (line.toLowerCase().startsWith('date:')) envelope.date = new Date(line.slice(5).trim());
                if (line.toLowerCase().startsWith('from:')) envelope.from = line.slice(5).trim();
                if (line.toLowerCase().startsWith('to:')) envelope.to = line.slice(3).trim();
              }
            });
          });

          msg.once('end', () => {
            envelopes.push(envelope as MailEnvelope);
          });
        });

        fetcher.once('error', (err: Error) => reject(err));
        fetcher.once('end', () => {
          this.emit('initialSyncComplete', { accountId: this.cfg.id, mailbox, count: envelopes.length, envelopes });
          resolve();
        });
      });
    });
  }

  private structHasAttachment(struct: any): boolean {
    // struct can be nested arrays; search for part with disposition 'ATTACHMENT' or a filename param
    const search = (node: any): boolean => {
      if (!node) return false;
      if (Array.isArray(node)) return node.some(search);
      if (node.disposition && typeof node.disposition === 'object') {
        const type = node.disposition.type || '';
        if (type.toLowerCase() === 'attachment') return true;
      }
      if (node.params && node.params.name) return true;
      if (node.childNodes) return node.childNodes.some(search);
      return false;
    };

    return search(struct);
  }

  private fetchRecent(limit = 10): Promise<void> {
    return new Promise((resolve, reject) => {
      // fetch the most recent 'limit' messages by UID
      // Use sequence range: LAST: fetch by UID isn't directly supported here, so fetch by sequence
      // Use '1:*' and then only parse the last N uids — for efficiency in real world you'd use UIDs
      this.imap.search(['ALL'], (err: Error | null, results?: number[]) => {
        if (err) return reject(err);
        if (!results || results.length === 0) return resolve();
        const uids = results.slice(-limit);
        const fetcher = this.imap.fetch(uids, { bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)', struct: true });

          fetcher.on('message', (msg: any, seqno: number) => {
            const envelope: Partial<MailEnvelope> = { uid: 0, flags: [] };
            msg.on('attributes', (attrs: any) => {
              envelope.uid = attrs.uid;
              envelope.flags = attrs.flags ?? [];
              if (attrs.struct) envelope.hasAttachments = this.structHasAttachment(attrs.struct);
            });
            msg.on('body', (stream: NodeJS.ReadableStream) => {
              let buffer = '';
              stream.on('data', (chunk: Buffer | string) => (buffer += chunk.toString('utf8')));
              stream.once('end', () => {
                const lines = buffer.split(/\r?\n/).map((l) => l.trim());
                for (const line of lines) {
                  if (line.toLowerCase().startsWith('subject:')) envelope.subject = line.slice(8).trim();
                  if (line.toLowerCase().startsWith('date:')) envelope.date = new Date(line.slice(5).trim());
                  if (line.toLowerCase().startsWith('from:')) envelope.from = line.slice(5).trim();
                  if (line.toLowerCase().startsWith('to:')) envelope.to = line.slice(3).trim();
                }
              });
            });
            msg.once('end', () => {
              this.emit('message', { accountId: this.cfg.id, envelope });
            });
          });

        fetcher.once('error', (err: Error) => reject(err));
        fetcher.once('end', () => resolve());
      });
    });
  }

  /**
   * Fetch the full raw message for a given UID.
   * Returns the RFC822 source as a string.
   */
  fetchFullMessageByUid(uid: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const fetcher = this.imap.fetch(uid, { bodies: '', struct: true });
      let raw = '';
      fetcher.on('message', (msg: any) => {
        msg.on('body', (stream: NodeJS.ReadableStream) => {
          stream.on('data', (chunk: Buffer | string) => (raw += chunk.toString('utf8')));
        });
      });
      fetcher.once('error', (err: Error) => reject(err));
      fetcher.once('end', () => resolve(raw));
    });
  }

  private startIdle() {
    try {
      // node-imap provides a built-in idle mechanism triggered by server
      (this.imap as any).idle();
      // Set up a watchdog to re-issue IDLE every 29 minutes (1740s) to avoid server timeouts
      this.clearIdleTimer();
      this.idleTimer = setTimeout(() => {
        this.emit('idleWatchdog', { accountId: this.cfg.id });
        try {
          // re-issue NOOP to keepalive, then re-idle
          (this.imap as any).seq?.noop?.();
        } catch (e) {
          // ignore
        }
        // Re-issue IDLE by closing and reopening the box, or by invoking idle again
        try {
          // node-imap doesn't expose a direct re-idle; calling idle again can help
          (this.imap as any).idle();
        } catch (err: any) {
          this.emit('error', { accountId: this.cfg.id, error: err });
          this.scheduleReconnect();
        }
      }, 29 * 60 * 1000);
    } catch (err) {
      this.emit('error', { accountId: this.cfg.id, error: err });
      this.scheduleReconnect();
    }
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      try {
        this.imap.end();
      } catch (e) {
        // ignore
      }
      this.connect();
    }, 5000) as unknown as NodeJS.Timeout;
  }
  close() {
    this.closed = true;
    this.clearIdleTimer();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.imap.end();
    } catch (e) {
      // ignore
    }
  }
}

export default ImapClient;
