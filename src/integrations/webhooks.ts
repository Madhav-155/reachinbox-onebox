import fetch from 'cross-fetch';
import EmailDocument from '../models/emailDocument';
import logger from '../logger';

export async function triggerWebhooks(email: EmailDocument) {
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  const webhookUrl = process.env.WEBHOOK_SITE_URL;

  // Send Slack message if configured
  if (slackUrl) {
    try {
      const payload = {
        text: `*New Interested Lead*\n*Subject:* ${email.subject}\n*From:* ${email.from}\n*Account:* ${email.accountId}`,
      };
      await fetch(slackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (err) {
      logger.warn({ err }, '[Webhook] Slack notify failed');
    }
  }

  // Send generic webhook for automation
  if (webhookUrl) {
    try {
      const payload = { event: 'InterestedLead', email };
      await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (err) {
      logger.warn({ err }, '[Webhook] generic webhook failed');
    }
  }
}

export default triggerWebhooks;
