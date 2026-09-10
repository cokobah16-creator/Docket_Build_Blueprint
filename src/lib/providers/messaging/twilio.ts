// Twilio — SMS for US numbers (diaspora clients). Termii handles Nigerian lines.
import type { SmsProvider } from './types';
export function twilioSms(sid = process.env.TWILIO_ACCOUNT_SID!, token = process.env.TWILIO_AUTH_TOKEN!, from = process.env.TWILIO_FROM!): SmsProvider {
  return {
    name: 'twilio',
    async send({ to, body }) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Twilio send failed: ${j.message ?? res.status}`);
      return { providerRef: j.sid };
    },
  };
}
