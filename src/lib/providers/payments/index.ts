import type { Currency, PaymentProvider } from './types';
import { paystackProvider } from './paystack';
import { stripeProvider } from './stripe';

// NGN → Paystack (Nigerian entity); USD → Stripe (US entity). Swap here, nowhere else.
export function paymentProviderFor(currency: Currency): PaymentProvider {
  return currency === 'USD' ? stripeProvider() : paystackProvider();
}
export type { PaymentProvider, Currency } from './types';
