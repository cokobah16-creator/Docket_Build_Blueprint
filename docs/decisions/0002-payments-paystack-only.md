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

- `firms.stripe_account` was dropped in migration 9 (`platform_firms`), which
  was the next migration to touch `firms`. No data ever used it. The column
  survives only in the generated `src/lib/db/database.types.ts`, which has not
  been regenerated since.
- The `PaymentProvider.name` union no longer includes `'stripe'`.
- Adding a second provider later is still a one-line change in
  `src/lib/providers/payments/index.ts`.
