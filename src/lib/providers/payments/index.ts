import type { Currency, PaymentProvider } from './types';
import { paystackProvider } from './paystack';

// Paystack for every currency (decision 0002). Swap here, nowhere else.
export function paymentProviderFor(_currency: Currency): PaymentProvider {
  return paystackProvider();
}
export type { PaymentProvider, Currency, PaymentChannel } from './types';
