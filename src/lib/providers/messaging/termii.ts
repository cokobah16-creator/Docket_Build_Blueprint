// Termii — Nigerian SMS on DND-compliant routes (so OTPs and updates reach lines on Do-Not-Disturb).
import type { SmsProvider } from './types';
export function termiiSms(apiKey = process.env.TERMII_API_KEY!, senderId = process.env.TERMII_SENDER_ID ?? 'Docket'): SmsProvider {
  return {
    name: 'termii',
    async send({ to, body }) {
      const res = await fetch('https://api.ng.termii.com/api/sms/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, to, from: senderId, sms: body, type: 'plain', channel: 'dnd' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Termii send failed: ${j.message ?? res.status}`);
      return { providerRef: j.message_id };
    },
  };
}
