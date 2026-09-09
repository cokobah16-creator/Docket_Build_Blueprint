// Payment provider adapters. Server-side only (server actions / route
// handlers) — secret keys never reach the browser, and NOTHING here writes
// to the database: the webhooks + record_payment() are the only path that
// settles money (blueprint §5.9).
//
// Money settles to the firm's own accounts: Paystack on the Nigerian
// entity (NGN), Stripe on the US entity (USD). Docket never holds funds.

export type Currency = "NGN" | "USD";

export interface InitializeParams {
  /** The Docket invoice this checkout pays. Travels in provider metadata. */
  invoiceNumber: string;
  /** Major units (naira / dollars). Adapters convert to kobo/cents. */
  amount: number;
  currency: Currency;
  customerEmail: string;
  /** Absolute URL the provider redirects back to after checkout. */
  callbackUrl: string;
  /** Shown on the provider's checkout page. */
  description?: string;
}

export interface InitializeResult {
  /** Where to redirect the client to pay. */
  checkoutUrl: string;
  /** The provider's reference for reconciliation. */
  providerRef: string;
}

export interface PaymentProvider {
  readonly name: "paystack" | "stripe";
  readonly currency: Currency;
  initialize(params: InitializeParams): Promise<InitializeResult>;
}

class PaymentProviderError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider}: ${detail}`);
    this.name = "PaymentProviderError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

// --- Paystack (NGN) ---------------------------------------------------------

interface PaystackInitResponse {
  status: boolean;
  message: string;
  data?: { authorization_url: string; reference: string };
}

export function paystackProvider(): PaymentProvider {
  return {
    name: "paystack",
    currency: "NGN",
    async initialize(params) {
      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireEnv("PAYSTACK_SECRET_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: params.customerEmail,
          amount: Math.round(params.amount * 100), // naira → kobo
          currency: params.currency,
          callback_url: params.callbackUrl,
          metadata: { invoice_number: params.invoiceNumber },
        }),
      });
      const body = (await res.json()) as PaystackInitResponse;
      if (!res.ok || !body.status || !body.data) {
        throw new PaymentProviderError("paystack", body.message ?? `HTTP ${res.status}`);
      }
      return {
        checkoutUrl: body.data.authorization_url,
        providerRef: body.data.reference,
      };
    },
  };
}

// --- Stripe (USD) -----------------------------------------------------------

interface StripeSessionResponse {
  id?: string;
  url?: string;
  error?: { message?: string };
}

export function stripeProvider(): PaymentProvider {
  return {
    name: "stripe",
    currency: "USD",
    async initialize(params) {
      const form = new URLSearchParams({
        mode: "payment",
        customer_email: params.customerEmail,
        success_url: params.callbackUrl,
        cancel_url: params.callbackUrl,
        "metadata[invoice_number]": params.invoiceNumber,
        "payment_intent_data[metadata][invoice_number]": params.invoiceNumber,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": params.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(Math.round(params.amount * 100)),
        "line_items[0][price_data][product_data][name]":
          params.description ?? `Invoice ${params.invoiceNumber}`,
      });
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireEnv("STRIPE_SECRET_KEY")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      });
      const body = (await res.json()) as StripeSessionResponse;
      if (!res.ok || !body.url || !body.id) {
        throw new PaymentProviderError("stripe", body.error?.message ?? `HTTP ${res.status}`);
      }
      return { checkoutUrl: body.url, providerRef: body.id };
    },
  };
}

// --- routing ----------------------------------------------------------------

/** NGN → Paystack, USD → Stripe. The invoice's currency decides. */
export function paymentProviderFor(currency: Currency): PaymentProvider {
  switch (currency) {
    case "NGN":
      return paystackProvider();
    case "USD":
      return stripeProvider();
    default: {
      const exhaustive: never = currency;
      throw new Error(`no payment provider for currency ${exhaustive}`);
    }
  }
}
