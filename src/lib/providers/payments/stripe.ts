// Stripe — USD on the US entity (Stripe does not onboard Nigerian merchants). Server-side only.
import Stripe from 'stripe';
import type { PaymentProvider, InitializePaymentArgs, InitializePaymentResult, VerifyPaymentResult } from './types';

export function stripeProvider(secretKey = process.env.STRIPE_SECRET_KEY!): PaymentProvider {
  const stripe = new Stripe(secretKey);
  return {
    name: 'stripe',
    async initialize(a: InitializePaymentArgs): Promise<InitializePaymentResult> {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ quantity: 1, price_data: { currency: a.currency.toLowerCase(), unit_amount: a.amountMinor, product_data: { name: a.description } } }],
        customer_email: a.email,
        client_reference_id: a.invoiceNumber,
        metadata: { invoice_number: a.invoiceNumber },
        success_url: a.callbackUrl, cancel_url: a.cancelUrl ?? a.callbackUrl,
      });
      if (!session.url) throw new Error('Stripe session has no URL');
      return { checkoutUrl: session.url, providerRef: session.id };
    },
    async verify(providerRef: string): Promise<VerifyPaymentResult> {
      const s = await stripe.checkout.sessions.retrieve(providerRef);
      return {
        providerRef: typeof s.payment_intent === 'string' ? s.payment_intent : s.id,
        status: s.payment_status === 'paid' ? 'succeeded' : s.status === 'expired' ? 'failed' : 'initiated',
        amountMinor: s.amount_total ?? 0, currency: (s.currency ?? 'usd').toUpperCase() as 'USD', raw: s,
      };
    },
  };
}
