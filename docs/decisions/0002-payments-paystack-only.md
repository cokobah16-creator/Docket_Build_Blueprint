# Decision 0002 — Payments: Paystack only, no Stripe

**Status:** Decided · **Date:** 2026-09-10 · **Gates:** slice 1 checkout, slice 4 invoicing
**Supersedes:** blueprint §8 (Stripe for USD)

## Decision

Paystack is the only card-payment provider. The Stripe adapter, the
`stripe-webhook` Edge Function, the `stripe` npm dependency and the Stripe
env vars are removed. `paymentProviderFor()` returns Paystack for every
currency; USD invoices go through Paystack's multi-currency support when the
firm's Paystack account has it enabled, and are otherwise not offered.

## Why

The firm has no US entity and no plan to open one. Two providers meant two
settlement accounts, two webhook secrets and two reconciliation paths for
a currency that is not in use.

## Consequences

- `firms.stripe_account` stays as a nullable column; no data ever used it
  and dropping it is not worth a migration. Remove it in the next schema
  migration that touches `firms`.
- The `PaymentProvider.name` union no longer includes `'stripe'`.
- Adding a second provider later is still a one-line change in
  `src/lib/providers/payments/index.ts`.
