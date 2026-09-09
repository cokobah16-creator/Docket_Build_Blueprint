# Docket — slice 0 (database, security, adapters)

*Implements sections 5–8 of `Docket_Build_Blueprint_v0.2.md`. Attorneys Klinique is tenant #1.*

This is the foundation every later slice builds on: the multi-tenant Postgres schema, row-level security, the server-side business flows (booking, payment cascade, court updates, consultation notes, invites, jobs), the provider adapters, the payment webhooks, the notification dispatcher, the Klinique seed, and a test suite that proves tenant isolation.

**Validated:** all four migrations, the seed and the 52-check test suite run clean on PostgreSQL 16. The TypeScript adapters type-check.

## What's in the box

```
supabase/
  migrations/
    20260909000001_schema.sql        types, 36 tables, indexes, grants, firm_public view
    20260909000002_rls.sql           helpers + policies for every table (staff writes need MFA)
    20260909000003_functions.sql     booking engine, payments, court updates, notes, invites, jobs, triggers
    20260909000004_supabase_storage_cron.sql   storage buckets/policies + pg_cron (no-op on plain Postgres)
  seed.sql                           Attorneys Klinique: brand, policies, 15 matter statuses, 14 services, intake form
  functions/
    paystack-webhook/                HMAC-verified, re-verified with Paystack, then record_payment()
    stripe-webhook/                  signature-verified, then record_payment()
    dispatch-notifications/          drains the outbox to email (Resend), SMS (Termii / Twilio), push (VAPID)
  tests/
    00_local_auth_stub.sql           local-only stand-in for Supabase Auth
    10_rls_isolation.sql             two firms, six users, 52 checks, rolls back
src/lib/providers/
  payments/   PaymentProvider — Paystack (NGN), Stripe (USD)
  video/      VideoProvider   — Daily (private rooms, knocking, per-user tokens, no recording)
  messaging/  SmsProvider (Termii, Twilio), EmailProvider (Resend)
scripts/db-test-local.sh
.env.example
```

## Apply to Supabase

1. Create the project (region: London or Frankfurt). Enable **Phone** and **Email** auth and **MFA (TOTP)**.
2. `supabase link --project-ref <ref>` then `supabase db push` — migrations apply in order.
3. `psql "$DATABASE_URL" -f supabase/seed.sql` — creates Attorneys Klinique. Edit `brand`, `policies`, `vat_rate` and service prices before launch (see "Decisions").
4. `supabase functions deploy paystack-webhook stripe-webhook dispatch-notifications` and set the secrets from `.env.example` with `supabase secrets set`.
5. Point Paystack's webhook at `/functions/v1/paystack-webhook` and Stripe's at `/functions/v1/stripe-webhook`.
6. Dashboard → Integrations → Cron: HTTP request to `/functions/v1/dispatch-notifications` every minute (the SQL jobs are already scheduled by migration 4).
7. Auth → Hooks → **Send SMS**: point at a small Edge Function that forwards OTPs to Termii (`channel: 'dnd'`). Until then Supabase's built-in Twilio provider works for testing.
8. `supabase gen types typescript --linked > src/lib/db/types.ts` whenever the schema changes.

## Run the tests locally

Requires PostgreSQL 16+ (superuser). Never run the stub against Supabase.

```bash
DATABASE_URL=postgres://postgres@localhost:5432/postgres bash scripts/db-test-local.sh
```

Expected tail: `NOTICE:  ALL CHECKS PASSED` after 52 `PASS` lines. The suite covers: client isolation (matters, updates, documents, invoices), staff isolation across firms, MFA gating of staff writes, the anonymous surface, slot computation with breaks, booking and double-booking, the 15-minute hold, the payment cascade and duplicate-webhook idempotency, the court-update form, consultation notes (internal notes invisible to clients), audit-log access and immutability, and the hold-release job.

## Rules the code enforces (don't undo them in later slices)

- **Staff writes need an MFA-verified session** (`aal2`). Build the TOTP enrolment gate in slice 1 before any staff screen; without it staff can read but not write.
- **Clients never insert appointments or payments.** They call `book_appointment()` and `cancel_appointment()`; webhooks call `record_payment()` with the service role. The frontend callback page displays state; it never sets it.
- **Internal notes never reach clients.** `updates.visibility = 'internal'` and `consultation_internal_notes` have no client policy.
- **Money settles to the firm.** Paystack on the Nigerian entity, Stripe on the US entity. Docket never holds funds.
- **`audit_log` is append-only** for every role except the security-definer `audit()` function.
- **Timestamps are UTC**; render in the viewer's zone (`profiles.timezone`, default `Africa/Lagos`).
- **Storage paths carry the tenant**: `documents/{firm_id}/{document_id}/{version_id}.{ext}`, `intake-uploads/{firm_id}/{client_id}/…`, `firm-assets/{firm_id}/…` — the storage policies parse them.

## Server functions (RPC)

| Function | Who | What |
|---|---|---|
| `available_slots(firm, lawyer, service, date)` | anon, authenticated | slots in the lawyer's zone minus rules, breaks, exceptions, live appointments, daily cap; 2-hour lead time |
| `book_appointment(firm, service, lawyer, starts_at, mode, client_tz, intake, intake_form)` | client | validates slot, creates held appointment + issued invoice (VAT from `firms.vat_rate`), stores intake, returns what the payment step needs |
| `cancel_appointment(appointment, reason)` | client (own, future) or staff | cancels and voids the unpaid invoice |
| `record_payment(provider, ref, invoice_number, amount, currency, status, raw)` | service role | idempotent on `provider_ref`; paid → confirms appointment → notifications |
| `post_court_update(matter, outcome, occurred_at, court, adjourned_by, next_date, next_purpose, note_to_client, internal_note)` | staff (MFA) | the 30-second form: composes the title, posts client + internal entries, closes today's court event, opens the next, updates the matter |
| `save_consultation_notes(appointment, summary, advice, follow_up, internal, mark_completed)` | staff (MFA) | client-visible + internal notes, timeline echo, marks completed |
| `accept_invite(token)` | client | joins the matter the invite points at |
| `release_expired_holds()`, `enqueue_appointment_reminders()`, `enqueue_court_reminders()`, `mark_overdue_invoices()`, `digest_sittings_without_update()` | pg_cron | jobs |

## Decisions still open before launch (blueprint §14)

Firm domain · platform entity · which entities hold Paystack and Stripe · VAT treatment (`firms.vat_rate` is 0 until Precious confirms) · service prices (only Legal Consultation is active; the rest are seeded inactive at a placeholder ₦50,000) · first friendly firm for week 11.

## Next slices

See `BUILD_PROMPTS.md` — six self-contained prompts for Claude Code that build the Next.js app on top of this foundation, in the order of the 90-day plan.
