// Docket — payment provider adapter. Core code imports this, never a vendor SDK.
export type Currency = 'NGN' | 'USD';

export interface InitializePaymentArgs {
  invoiceNumber: string;          // becomes provider metadata; the webhook maps it back to the invoice
  amountMinor: number;            // kobo or cents — always the invoice total
  currency: Currency;
  email: string;
  description: string;
  callbackUrl: string;            // where the client lands after paying (display only — never marks paid)
  cancelUrl?: string;
}

export interface InitializePaymentResult {
  checkoutUrl: string;
  providerRef: string;            // unique per attempt; stored as payments.provider_ref by the webhook
}

export interface VerifyPaymentResult {
  providerRef: string;
  status: 'succeeded' | 'failed' | 'initiated';
  amountMinor: number;
  currency: Currency;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: 'paystack' | 'flutterwave';
  initialize(args: InitializePaymentArgs): Promise<InitializePaymentResult>;
  verify(providerRef: string): Promise<VerifyPaymentResult>;
}
