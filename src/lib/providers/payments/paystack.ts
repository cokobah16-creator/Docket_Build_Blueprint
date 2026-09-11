// Paystack — the platform account routes; each firm's fees settle to its own subaccount. Server-side only (secret key).
import type { PaymentChannel, PaymentProvider, InitializePaymentArgs, InitializePaymentResult, VerifyPaymentResult } from './types';

const API = 'https://api.paystack.co';

/** Docket's channel names → Paystack's. */
const CHANNELS: Record<PaymentChannel, string> = {
  card: 'card',
  bank_transfer: 'bank_transfer',
  ussd: 'ussd',
};

export function paystackProvider(secretKey = process.env.PAYSTACK_SECRET_KEY!): PaymentProvider {
  const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
  return {
    name: 'paystack',
    async initialize(a: InitializePaymentArgs): Promise<InitializePaymentResult> {
      // reference must be unique per attempt; the invoice number travels in metadata
      const reference = `${a.invoiceNumber}-${Date.now().toString(36)}`.replace(/[^A-Za-z0-9.=-]/g, '-');
      const res = await fetch(`${API}/transaction/initialize`, {
        method: 'POST', headers,
        body: JSON.stringify({
          email: a.email, amount: a.amountMinor, currency: a.currency, reference,
          callback_url: a.callbackUrl,
          metadata: { invoice_number: a.invoiceNumber, description: a.description },
          // the client already chose how to pay in Docket, so open straight on it
          ...(a.channel ? { channels: [CHANNELS[a.channel]] } : {}),
          // money settles to the firm: route to its subaccount and let it bear the processing fee
          ...(a.subaccount ? { subaccount: a.subaccount, bearer: 'subaccount' } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.status) throw new Error(`Paystack initialize failed: ${j.message ?? res.status}`);
      return { checkoutUrl: j.data.authorization_url, providerRef: j.data.reference };
    },
    async verify(providerRef: string): Promise<VerifyPaymentResult> {
      const res = await fetch(`${API}/transaction/verify/${encodeURIComponent(providerRef)}`, { headers });
      const j = await res.json();
      if (!res.ok || !j.status) throw new Error(`Paystack verify failed: ${j.message ?? res.status}`);
      const d = j.data;
      return {
        providerRef: d.reference,
        status: d.status === 'success' ? 'succeeded' : d.status === 'failed' ? 'failed' : 'initiated',
        amountMinor: d.amount, currency: d.currency, raw: d,
      };
    },
  };
}
