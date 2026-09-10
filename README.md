# Docket — the client-experience platform for Nigerian law firms

*One app, every matter, any firm. Docket is the platform; every law firm on it — Attorneys Klinique first — is a tenant with its own site, portal and console. See `docs/DOCKET_PLATFORM_MODEL.md` and decision 0003.*

This repository is the platform: the multi-tenant Postgres schema and row-level security, the server-side business flows (firm creation, booking, payment cascade, court updates, consultation notes, service of process, invites, jobs), the Nigerian reference data (states, courts, holidays), the provider adapters, the payment webhooks, the notification dispatcher, the Next.js app (tenant public sites, client PWA, staff console, platform admin), Klinique's seed data, and test suites that prove isolation between firms and between clients.

**Validated:** all eleven migrations, the seed and four SQL suites (143 checks) run clean on PostgreSQL 16.

## Any firm, the same way

A firm registers at **`/firm/start`** (account → firm → two-factor), which calls `create_firm()`: the caller becomes owner and `seed_firm_defaults()` installs the matter statuses, an unpriced consultation service and an intake form. A platform admin can open a firm for an existing owner from **`/admin`**. `supabase/seed.sql` is only Klinique's data run through the same function — no firm needs SQL to join.

## What's in the box

```
supabase/
  migrations/
    20260909000001_schema.sql        types, 36 tables, indexes, grants, firm_public view
    20260909000002_rls.sql           helpers + policies for every table (staff writes need MFA)
    20260909000003_functions.sql     booking engine, payments, court updates, notes, invites, jobs, triggers
    20260909000004_supabase_storage_cron.sql   storage buckets/policies + pg_cron (no-op on plain Postgres)
    20260909000005_partner_attribution.sql     originating/handling partner on matters, partner_attribution view
    20260909000006–08                          firm_public/lawyer_public projections, hardening, realtime
    20260910000009_platform_firms.sql          create_firm(), seed_firm_defaults(), platform_admins, firms.plan/status
    20260910000010_nigeria_reference.sql       ng_states, courts (hierarchy + suit-number hints), holidays, vacations, SCN/year of call, matters.court_id
    20260910000011_counsel_and_service.sql     matter_counsel, process_service, serve_process(), acknowledge_service(), service_inbox
  seed.sql                           Attorneys Klinique: brand, policies, 14 services, intake form — then seed_firm_defaults()
  functions/
    paystack-webhook/                HMAC-verified, re-verified with Paystack, then record_payment()
    dispatch-notifications/          drains the outbox to email (Resend), SMS (Termii / Twilio), push (VAPID)
  tests/
    00_local_auth_stub.sql           local-only stand-in for Supabase Auth
    10_rls_isolation.sql             two firms, six users, 52 checks, rolls back
    20_platform.sql                  self-serve firm creation, slug rules, caps, platform admin sees lifecycle only
    30_nigeria.sql                   states, court directory (platform vs firm-private), holidays, practitioner fields
    40_counsel_service.sql           service of process: served firm sees the record + document and nothing else
src/lib/providers/
  payments/   PaymentProvider — Paystack (all currencies; decision 0002)
  video/      VideoProvider   — Daily (private rooms, knocking, per-user tokens, no recording)
  messaging/  SmsProvider (Termii, Twilio), EmailProvider (Resend)
src/lib/nigeria.ts   states, +234 normalisation, suit-number shape, court outcomes
app/
  page.tsx                 Docket landing (firms · clients · courts)
  (public)/[firm]/…        tenant public site + booking wizard
  app/…                    client PWA
  firm/(auth)/start        self-serve firm registration → create_firm()
  firm/(auth)/security/mfa TOTP enrolment; firm/(console) staff console
  admin/                   platform admin (platform_admins gate; lifecycle only)
scripts/db-test-local.sh
.env.example
```

## Apply to Supabase

1. Create the project (region: London or Frankfurt). Enable **Phone** and **Email** auth and **MFA (TOTP)**.
2. `supabase link --project-ref <ref>` then `supabase db push` — migrations apply in order.
3. `psql "$DATABASE_URL" -f supabase/seed.sql` — creates Attorneys Klinique. Edit `brand`, `policies`, `vat_rate` and service prices before launch (see "Decisions").
4. `supabase functions deploy paystack-webhook dispatch-notifications` and set the secrets from `.env.example` with `supabase secrets set`.
5. Point Paystack's webhook at `/functions/v1/paystack-webhook` (Paystack dashboard → Settings → API Keys & Webhooks; there is no API for it).
   `scripts/configure-providers.sh` sets the Auth Site URL and redirect allow-list and can enable phone OTP via Twilio. It needs a
   Supabase personal access token (`SUPABASE_ACCESS_TOKEN`), `SUPABASE_PROJECT_REF` and `APP_URL`; see the script header for the Twilio variables.
6. Dashboard → Integrations → Cron: HTTP request to `/functions/v1/dispatch-notifications` every minute (the SQL jobs are already scheduled by migration 4).
7. Auth → Hooks → **Send SMS**: point at a small Edge Function that forwards OTPs to Termii (`channel: 'dnd'`). Until then Supabase's built-in Twilio provider works for testing.
8. `supabase gen types typescript --linked > src/lib/db/types.ts` whenever the schema changes.

## Run the tests locally

Requires PostgreSQL 16+ (superuser). Never run the stub against Supabase.

```bash
DATABASE_URL=postgres://postgres@localhost:5432/postgres bash scripts/db-test-local.sh
```

Each suite ends with `NOTICE:  ALL CHECKS PASSED` (143 `PASS` lines in total). Coverage: client isolation (matters, updates, documents, invoices), staff isolation across firms, MFA gating of staff writes, the anonymous surface, slot computation with breaks, booking and double-booking, the 15-minute hold, the payment cascade and duplicate-webhook idempotency, the court-update form, consultation notes (internal notes invisible to clients), audit-log access and immutability, the hold-release job; self-serve firm creation and its defaults, slug validation, the three-firm cap, platform admins seeing lifecycle rows and no content; the court directory (platform-wide vs firm-private), holidays and vacations, practitioner fields; service of process across firms (record + served document visible to the served firm, nothing else; acknowledgement once; clients see progress).

## Rules the code enforces (don't undo them in later slices)

- **Staff writes need an MFA-verified session** (`aal2`). Build the TOTP enrolment gate in slice 1 before any staff screen; without it staff can read but not write.
- **Clients never insert appointments or payments.** They call `book_appointment()` and `cancel_appointment()`; webhooks call `record_payment()` with the service role. The frontend callback page displays state; it never sets it.
- **Internal notes never reach clients.** `updates.visibility = 'internal'` and `consultation_internal_notes` have no client policy.
- **Money settles to the firm.** Paystack, on the firm's own account (decision 0002). Docket never holds funds.
- **`audit_log` is append-only** for every role except the security-definer `audit()` function.
- **Timestamps are UTC**; render in the viewer's zone (`profiles.timezone`, default `Africa/Lagos`).
- **Storage paths carry the tenant**: `documents/{firm_id}/{document_id}/{version_id}.{ext}`, `intake-uploads/{firm_id}/{client_id}/…`, `firm-assets/{firm_id}/…` — the storage policies parse them.
- **No firm is named in code.** Brand, copy, services, policies, courts and statuses are rows; `seed.sql` is data. Platform-wide reference rows (`courts` with `firm_id is null`, `ng_states`, `public_holidays`, `court_vacations`, `platform_admins`) are written with the service role only.
- **Platform admins never see matter content.** There is no platform policy on matters, documents, messages, updates or invoices — do not add one.
- **A served firm sees only what was served.** `process_service` + the served document (via `can_access_document`), never the matter, roster or timeline.

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
| `create_firm(name, slug, legal_name, rc_number, timezone, currency, prefix, state_code, brand, owner_email)` | authenticated (owner_email: platform admins) | opens a firm, makes the owner, seeds defaults, audits; validates and reserves slugs; three firms per account |
| `seed_firm_defaults(firm)` | internal | matter statuses, an unpriced inactive consultation, a consultation intake form — idempotent |
| `is_platform_admin()`, `is_valid_firm_slug(slug)` | authenticated / anon | gates for `/admin` and the registration form |
| `is_public_holiday(date)`, `is_non_sitting_day(date, level, state)` | anon, authenticated | weekends, Public Holidays Act dates, published court vacations |
| `serve_process(matter, counsel, document, title, method, served_at, note)` | staff (MFA) | records service on counsel (platform/email/personal/courier/bailiff/substituted), snapshots suit number and case title, posts a client-visible timeline entry, notifies counsel on Docket |
| `acknowledge_service(service, note)` | served firm's staff (MFA) | proof of service: timestamps, notifies the serving lawyer, internal timeline note, audits both firms |
| `release_expired_holds()`, `enqueue_appointment_reminders()`, `enqueue_court_reminders()`, `mark_overdue_invoices()`, `digest_sittings_without_update()` | pg_cron | jobs |

## Decisions still open before launch (blueprint §14)

Firm domain · platform entity · which entity holds the Paystack account · VAT treatment (`firms.vat_rate` is 0 until Precious confirms) · service prices (only Legal Consultation is active; the rest are seeded inactive at a placeholder ₦50,000) · first friendly firm for week 11 — which now onboards itself at `/firm/start`.

## Platform data the operator maintains

`courts` (platform rows), `court_vacations` (from each court's practice direction), `public_holidays` (movable Eid dates when declared), `platform_admins`. All are written with the service role or SQL; see `docs/DOCKET_PLATFORM_MODEL.md` §2.

## Next slices

See `BUILD_PROMPTS.md` — six self-contained prompts for Claude Code that build the Next.js app on top of this foundation, in the order of the 90-day plan.

## Source requirements

Platform model: `docs/DOCKET_PLATFORM_MODEL.md` and `docs/decisions/0003-platform-first.md`. The original Klinique requirements document lives at `docs/Attorneys_Klinique_Partner_Platform_Prompt.md`; `docs/MASTER_PROMPT_RECONCILIATION.md` maps it section by section onto this architecture — what's covered, what the blueprint deliberately changed (Daily vs Google Meet, Supabase Storage vs Google Drive), and the partnership-pooling additions (originating/handling partner attribution, migration 5; Firm Overview scheduled into slice 4).
