export type AICategory =
  | 'Interested'
  | 'Meeting Booked'
  | 'Not Interested'
  | 'Spam'
  | 'Out of Office'
  | 'Uncategorized';

export interface EmailDocument {
  id: string; // Unique message ID (e.g., MESSAGE-ID or UID+account)
  accountId: string;
  folder: string; // INBOX, Sent, etc.
  subject: string;
  body: string; // Plain text content
  from: string;
  to: string[];
  date: Date;
  aiCategory: AICategory;
  // Elasticsearch metadata
  indexedAt: Date;
}

export default EmailDocument;
