// Resend — transactional email, branded per firm by the dispatcher's templates.
import type { EmailProvider } from './types';
export function resendEmail(apiKey = process.env.RESEND_API_KEY!, from = process.env.EMAIL_FROM!): EmailProvider {
  return {
    name: 'resend',
    async send({ to, subject, html, text, fromName }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromName ? `${fromName} <${from}>` : from, to, subject, html, text }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Resend send failed: ${j.message ?? res.status}`);
      return { providerRef: j.id };
    },
  };
}
