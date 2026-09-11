// Docket — payment provider adapter. Core code imports this, never a vendor SDK.
export type Currency = 'NGN' | 'USD';

/**
 * How the client said they want to pay. Docket asks in its own screen so the
 * choice is made in the app, then opens the provider straight onto that
 * method — the money itself still never passes through Docket.
 */
export type PaymentChannel = 'card' | 'bank_transfer' | 'ussd';

export interface InitializePaymentArgs {
  invoiceNumber: string;          // becomes provider metadata; the webhook maps it back to the invoice
  amountMinor: number;            // kobo or cents — always the invoice total
  currency: Currency;
  email: string;
  description: string;
  callbackUrl: string;            // where the client lands after paying (display only — never marks paid)
  cancelUrl?: string;
  subaccount?: string | null;     // the firm's settlement subaccount (firms.paystack_subaccount); the firm bears the fees
  channel?: PaymentChannel | null; // open the provider on this method; omit to offer all of them
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
