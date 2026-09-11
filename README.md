# Docket — the client-experience platform for Nigerian law firms

*One app, every matter, any firm. Docket is the platform; every law firm on it — Attorneys Klinique first — is a tenant with its own site, portal and console. See `docs/DOCKET_PLATFORM_MODEL.md` and decision 0003.*

This repository is the platform: the multi-tenant Postgres schema and row-level security, the server-side business flows (firm creation, booking, payment cascade, court updates, consultation notes, service of process, invites, jobs), the Nigerian reference data (states, courts, holidays), the provider adapters, the payment webhooks, the notification dispatcher, the Next.js app (tenant public sites, client PWA, staff console, platform admin), Klinique's seed data, and test suites that prove isolation between firms and between clients.

**Validated:** all thirty-three migrations, the seed and sixteen SQL suites (585 checks) run clean on PostgreSQL 16. The onboarding runbook is `docs/ONBOARDING_A_FIRM.md`; every server function is catalogued in `docs/RPC_REFERENCE.md`.

## Any firm, the same way

A firm registers at **`/firm/start`** (account → firm → two-factor), which calls `create_firm()`: the caller becomes owner and `seed_firm_defaults()` installs the matter statuses, an unpriced consultation service, an intake form and a versioned policies skeleton. The console works immediately; the firm's public site and bookings open when a platform admin **verifies and activates** it from **`/admin`** (RC/BN number, the owner's enrolment number). Owners invite their lawyers with `staff_invites` → `accept_staff_invite()`. A platform admin can also open a firm for an existing owner. `supabase/seed.sql` inserts tenant #1's data directly (already active and verified by the founders) and then calls the same `seed_firm_defaults()`; its owner accounts and Paystack subaccount are attached exactly as for any firm (`docs/ONBOARDING_A_FIRM.md`). No other firm needs SQL to join.

## What's in the box

```
supabase/
  migrations/
    20260909000001_schema.sql        types, 35 tables, indexes, grants, firm_public view
    20260909000002_rls.sql           helpers + policies for every table (staff writes need MFA)
    20260909000003_functions.sql     booking engine, payments, court updates, notes, invites, jobs, triggers
    20260909000004_supabase_storage_cron.sql   storage buckets/policies + pg_cron (no-op on plain Postgres)
    20260909000005_partner_attribution.sql     originating/handling partner on matters, partner_attribution view
    20260909000006–08                          firm_public/lawyer_public projections, hardening, realtime
    20260910000009_platform_firms.sql          create_firm(), seed_firm_defaults(), platform_admins, firms.plan/status
    20260910000010_nigeria_reference.sql       ng_states, courts (hierarchy + suit-number hints), holidays, vacations, SCN/year of call, matters.court_id
    20260910000011_counsel_and_service.sql     matter_counsel, process_service, serve_process(), acknowledge_service(), service_inbox
    20260910000012_platform_hardening.sql      review fixes: settlement to the firm's Paystack subaccount, pending→verified lifecycle, version-pinned
                                               exhibit-grade service (opt-in, undertakings, orders, revocation, inbox-only reads), Lagos/FCT divisions,
                                               matter_court_numbers, state holidays + 2027, staff_invites, SCN uniqueness, court-aware post_court_update
    20260910000013_security_review.sql         served-firm access pinned to process_service.served_firm_id; uploads never follow service; lawyer_profiles
                                               member-only; suspension blocks writes; platform admins limited to firm_admin + set_firm_status(); name/SCN
                                               snapshots; brand validation; vacated/refixed dates, hearing notices, sine die; cause list; verified-only suit hints
    20260910000014_review_round_two.sql        views read-only and no TRUNCATE for API roles; rows must belong to their matter's firm; invites admin-only with
                                               identity-provider email; slug/domain platform-only; only active firms are public; SCN uniqueness among verified;
                                               settlement mismatches recorded and reported (never a webhook retry loop)
    20260910000015_second_firm_walkthrough.sql owner invites by owners; registrant's SCN and profile; no booking on unpublished policies; open_matter()
    20260910000016_storage_guards.sql          storage policies never throw on a stray object name (try_uuid guards every path-segment cast)
    20260910000017_merge_reconciliation.sql    one available_slots(): the active-firm check and the p_ignore argument in a single signature
    20260910000018_staff_console.sql           manual invoicing (create/issue/cancel), matter invitations (invite/revoke), and the two firm-wide reads
                                               the console runs on — firm_sittings_due (the chase list) and firm_overview (every counter in one trip)
    20260910000019_console_review.sql          console review: an invoice filed against a matter must name a party to it (issuing posts a client-visible
                                               fee entry there); firm_overview money is one figure per currency, never kobo added to cents; documents
                                               gain reviewed_at so "client uploads to review" can reach zero
    20260910000020_admin_surfaces.sql          what the two admin consoles write: domain_requests (a firm asks, the platform maps), set_firm_domain/
                                               set_firm_plan, set_member_role/remove_member (never yourself, never the last owner, never a lawyer with
                                               consultations still ahead), validated policies and notification_templates, webhook_events, the three
                                               platform health views and retry_notification()
    20260910000021_hardening.sql               the security pass: RLS on ng_states, a pinned search_path on every definer function, no EXECUTE on a
                                               trigger function, auth.uid() evaluated once per query, FOR ALL write policies split so they stop granting
                                               SELECT, rate_limits + rate_limit_hit(), and an index on every foreign key
  seed.sql                           Attorneys Klinique: brand, policies, 14 services, intake form — then seed_firm_defaults()
  functions/
    paystack-webhook/                HMAC-verified, re-verified with Paystack, then record_payment()
    dispatch-notifications/          drains the outbox to email (Resend), SMS (Termii / Twilio), push (VAPID); pg_cron calls it
    storage-manifest/                downloads and hashes every stored document on a rolling schedule, so "the bytes exist" is measured; pg_cron calls it
    video-session/                   Daily room + owner token per appointment; the only writer of consultation_sessions
  tests/
    00_local_auth_stub.sql           local-only stand-in for Supabase Auth
    10_rls_isolation.sql             two firms, six users, isolation, booking, payments, court updates, rolls back
    20_platform.sql                  self-serve firm creation, slug rules, caps, platform admin sees lifecycle only
    30_nigeria.sql                   states, court directory (platform vs firm-private), holidays, practitioner fields
    40_counsel_service.sql           service of process: served firm sees the record + document and nothing else
    50_staff_console.sql             VAT and line arithmetic, drafts invisible to clients, invitations, the chase list clearing
    60_admin_surfaces.sql            domain requests, role changes and removals, policy/template validation, platform health, the rate limiter
src/lib/providers/
  payments/   PaymentProvider — Paystack (all currencies; decision 0002)
  video/      VideoProvider   — Daily (private rooms, knocking, per-user tokens, no recording)
  messaging/  SmsProvider (Termii, Twilio), EmailProvider (Resend)
src/lib/nigeria.ts   states, +234 normalisation, suit-number shape, court outcomes
src/lib/firm-data.ts the console's shared reads (context, overview, chase list, matters, availability)
src/lib/checksum.ts  SHA-256 of an upload, so a served document's checksum is a real one
app/
  page.tsx                 Docket landing (firms · clients · courts)
  (public)/[firm]/…        tenant public site + booking wizard
  app/…                    client PWA
  app/(auth)/join          matter-invitation landing → accept_invite() (the link a firm sends its client)
  firm/(auth)/start        self-serve firm registration → create_firm()
  firm/(auth)/join         staff-invite landing → accept_staff_invite()
  firm/(auth)/security/mfa TOTP enrolment; firm/(console) staff console
  firm/(console)/          today · overview · sittings · matters · clients · invoices · service inbox · availability
  firm/(console)/admin/    the firm's own: settings · services · intake form · people · audit log (owner/admin only)
  admin/                   platform admin (platform_admins gate; lifecycle only) — firms · domains · plans · health · reference data
  api/report/              the browser error sink; the DSN stays server-side and the CSP names no third-party origin
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
9. **Slice 2 (video + reminders).** Secrets on the project: `DAILY_API_KEY` (rooms and owner tokens are minted only by the
   `video-session` Edge Function), `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (web push), `CRON_SECRET`.
   Migration 9 schedules `dispatch-notifications` every minute through pg_cron + pg_net, reading `dispatch_url` and
   `cron_secret` from Vault: `select vault.create_secret('https://<ref>.supabase.co/functions/v1/dispatch-notifications', 'dispatch_url');`
   and `select vault.create_secret('<CRON_SECRET>', 'cron_secret');`. On Vercel set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` so the
   client can subscribe. Clients knock into the Daily room without a token; only the lawyer holds an owner token and admits.
10. **Slice 3 (client portal).** Migration 10 adds `profiles.quiet_hours_start/end` (push, SMS and email wait until quiet
    hours end; in-app and 10-minute reminders never wait), the `document_versions` → `documents.current_version_id` trigger,
    and adds `updates`, `messages`, `notifications` and `invoices` to the Realtime publication. Client uploads go
    `documents` row → Storage `documents/{firm}/{document}/{version}.{ext}` → `document_versions` row, all as the user.
    The web manifest and icons are rendered per tenant from `firms.brand`; `/offline.html` is the offline shell.
11. **Slice 4 (staff console).** Migration 18 adds manual invoicing (`create_invoice` / `issue_invoice` / `cancel_invoice`),
    matter invitations (`invite_matter_party` / `revoke_matter_invite`) and two firm-wide reads, `firm_overview` and
    `firm_sittings_due`, so Today and the Overview are one round trip each. `firm_sittings_due` is the console's standing
    chase list: a court date whose day has passed with no update posted. It clears the moment `post_court_update()` runs.
12. **Slice 5 (admin and hardening).** Migrations 20 and 21. On Vercel set `VERCEL_TOKEN` and `VERCEL_PROJECT_ID` (plus
    `VERCEL_TEAM_ID` on a team account) so `/admin` can attach a firm's custom domain through the Domains API, and
    `SENTRY_DSN` / `POSTHOG_KEY` to turn on
    reporting (both are server-only and optional — absent, the calls are no-ops, and the CSP deliberately names no
    third-party origin). Turn on **leaked-password protection** in Auth → Policies. Enable **PITR** on the project and
    rehearse `docs/RESTORE_RUNBOOK.md` before launch. Redeploy the Edge Functions: `dispatch-notifications` now compares
    the cron secret in constant time and renders each firm's own `notification_templates`; `paystack-webhook` records every
    delivery in `webhook_events` and no longer retries what a retry cannot fix.

## Run the tests locally

Requires PostgreSQL 16+ (superuser). Never run the stub against Supabase.

```bash
DATABASE_URL=postgres://postgres@localhost:5432/postgres bash scripts/db-test-local.sh
```

Each suite ends with `NOTICE:  ALL CHECKS PASSED` (585 `PASS` lines across sixteen suites). Coverage: client isolation (matters, updates, documents, invoices), staff isolation across firms, MFA gating of staff writes, the anonymous surface, slot computation with breaks, booking and double-booking, the 15-minute hold, the payment cascade and duplicate-webhook idempotency, the court-update form, consultation notes (internal notes invisible to clients), audit-log access and immutability, the hold-release job; self-serve firm creation and its defaults, slug validation, the three-firm cap, platform admins seeing lifecycle rows and no content; the court directory (platform-wide vs firm-private), holidays and vacations, practitioner fields; service of process across firms (record + served document visible to the served firm, nothing else; acknowledgement once; clients see progress); manual invoicing and the chase list; and the admin surfaces — domain requests, role changes and member removal, policy and template validation, what a platform admin can and cannot see on the health screens, and the rate limiter; matter walls (a restricted matter invisible to a colleague outside its team through rows, bytes, threads, the overview and every RPC); document reads as the door to the bytes; document requests (asked once, answered once, withdrawn never deleted, walled like the documents); and conflict checks (the firm's own register only, a match behind a wall reported without the matter, the lawyer's decision recorded once, and — opt-in — no client joined to a matter until it is cleared).

`.github/workflows/ci.yml` runs the same script on every push, so a change that loosens row-level security fails the build rather than the launch. It also runs a real `next build` and checks the route table against the content security policy (`scripts/check-prerendered-routes.mjs`): a page Next.js prerenders carries inline scripts that can hold no per-request nonce, so a route that becomes static without the policy knowing ships as HTML that never hydrates.

## Rules the code enforces (don't undo them in later slices)

- **Staff writes need an MFA-verified session** (`aal2`). Build the TOTP enrolment gate in slice 1 before any staff screen; without it staff can read but not write.
- **Clients never insert appointments or payments.** They call `book_appointment()` and `cancel_appointment()`; webhooks call `record_payment()` with the service role. The frontend callback page displays state; it never sets it.
- **Internal notes never reach clients.** `updates.visibility = 'internal'` and `consultation_internal_notes` have no client policy.
- **Money settles to the firm.** The platform's Paystack account only routes: every prepaid booking needs `firms.paystack_subaccount`, the checkout is initialised with `subaccount` + `bearer: 'subaccount'`, and `record_payment()` applies a payment only when Paystack reports the firm's own subaccount — anything else is recorded as a flagged failure and reported to the firm for reconciliation (decision 0002, migrations 12 and 14). Docket never holds funds.
- **`audit_log` is append-only** for every role except the security-definer `audit()` function.
- **Timestamps are UTC**; render in the viewer's zone (`profiles.timezone`, default `Africa/Lagos`).
- **Storage paths carry the tenant**: `documents/{firm_id}/{document_id}/{version_id}.{ext}`, `intake-uploads/{firm_id}/{client_id}/…`, `firm-assets/{firm_id}/…` — the storage policies parse them.
- **No firm is named in code.** Brand, copy, services, policies, courts and statuses are rows; `seed.sql` is data. Platform-wide reference rows (`courts` with `firm_id is null`, `ng_states`, `public_holidays`, `court_vacations`, `platform_admins`) are written with the service role only.
- **Platform admins never see matter content.** There is no platform policy on matters, documents, messages, updates or invoices — do not add one.
- **A served firm sees only what was served.** Its only read path is the `service_inbox` view (never the `process_service` row, note, proof or the serving firm's `documents` row) and the exact document **version** served (`can_access_document_version`, which the storage policy also uses) — never the matter, roster, timeline or later versions. Platform service needs the other firm's opt-in (`firms.accepts_platform_service`); an originating process needs counsel's undertaking (`matter_counsel.accepts_service`) or an order for substituted service; platform service is timestamped by the platform; a wrong service is withdrawn with `revoke_service()`. The in-app acknowledgement is evidence of receipt: where the rules require an affidavit of service (personal, bailiff, substituted service) it supports that affidavit; where counsel has undertaken to accept service, keep the endorsed acknowledgement as the proof the court expects.
- **Rows belong to the firm that owns their matter or appointment** (`check_row_firm()` on every matter-linked table); a firm cannot plant a court number, sitting, document or update on another firm's matter.
- **Views are read-only and API roles cannot TRUNCATE.** Every new definer view must have insert/update/delete revoked (migration 14 shows how).
- **Lifecycle columns are the platform's.** `firms.status`, `plan` and `verified_at` change only through a platform admin (trigger); `lawyer_profiles.scn_verified_at` likewise.

## Server functions (RPC)

The table below is the shape of the API. **`docs/RPC_REFERENCE.md` is the full reference** — every argument, every error a caller can provoke, and what each function audits.

| Function | Who | What |
|---|---|---|
| `available_slots(firm, lawyer, service, date, ignore?)` | anon, authenticated | slots in the lawyer's zone minus rules, breaks, exceptions, live appointments, daily cap; 2-hour lead time |
| `book_appointment(firm, service, lawyer, starts_at, mode, client_tz, intake, intake_form)` | client | validates slot, creates held appointment + issued invoice (VAT from `firms.vat_rate`), stores intake, returns what the payment step needs |
| `cancel_appointment(appointment, reason)` | client (own, future) or staff | cancels and voids the unpaid invoice |
| `record_payment(provider, ref, invoice_number, amount, currency, status, raw, subaccount)` | service role | idempotent on `provider_ref`; paid → confirms appointment → notifications; a succeeded payment reported against a subaccount other than the firm's (or for a firm with none) is recorded as `failed` with `settlement_mismatch`, audited and reported to the firm — it confirms nothing |
| `save_consultation_notes(appointment, summary, advice, follow_up, internal, mark_completed)` | staff (MFA) | client-visible + internal notes, timeline echo, marks completed |
| `reschedule_appointment(appointment, starts_at, reason)` | staff (MFA) | re-validates the slot through the engine, resets reminders, notifies the client, audits |
| `mark_no_show(appointment)` | staff (MFA) | after the start time; audited |
| `create_invoice(firm, client, items, matter, currency, due_on, issue, note)` | staff (MFA) | numbers from the firm counter, applies `firms.vat_rate`, writes the items; issuing notifies the client and echoes a fee entry to the matter timeline. With a matter, the client billed must be a party to it — the fee entry is client-visible on that file |
| `issue_invoice(invoice, due_on)` | staff (MFA) | draft → issued; the client only ever sees issued invoices |
| `cancel_invoice(invoice, reason)` | owner/admin (MFA) | refuses a part-paid or paid invoice — a credit note is the remedy |
| `invite_matter_party(matter, phone, email, role, expires_days)` | staff (MFA) | returns the token so the console can build the WhatsApp/SMS link; refuses someone already on the matter |
| `revoke_matter_invite(invite)` | staff (MFA) | expires an unaccepted invitation |
| `accept_invite(token)` | client | joins the matter the invite points at |
| `create_firm(name, slug, legal_name, rc_number, timezone, currency, prefix, state_code, brand, owner_email, owner_scn)` | authenticated (owner_email: platform admins with MFA) | opens a firm as `pending`, makes the owner and opens their private practitioner profile (with SCN), seeds defaults, audits; validates and reserves slugs (also a check constraint); three firms per account |
| `seed_firm_defaults(firm)` | internal | matter statuses, an unpriced inactive consultation, a consultation intake form, a `0-draft` policies skeleton — idempotent |
| `open_matter(firm, title, type, client, cause_title, description, court_id, suit_number, judicial_division, originating_lawyer, handling_lawyer, status_key, note_to_client)` | staff (MFA) | issues the reference, adds the client party and lead lawyer, records court and suit number, posts the first client-visible entry |
| `accept_staff_invite(token)` | authenticated (identity-provider email must match) | joins the firm in the invited role (only an owner may invite an owner); lawyers get a private profile |
| `is_platform_admin()`, `is_valid_firm_slug(slug)` | authenticated / anon | gates for `/admin` and the registration form |
| `is_public_holiday(date, country='NG', state)`, `is_non_sitting_day(date, level, state)` | anon, authenticated | national and state-declared holidays (with observed dates), weekends, published court vacations — `court_vacations` is empty until the operator enters each court's practice-direction dates, so until then only weekends and holidays are refused |
| `serve_process(matter, counsel, document, title, method, served_at, note, is_originating, substituted_by_order, authority_document, served_on_name, served_on_capacity, served_at_address, server_name, outside_issuing_state, deemed_served_on)` | staff (MFA) | records service on counsel (platform / counsel_address / email / whatsapp / personal / bailiff / courier / registered_post / publication / pasting), pinned to the document version + checksum, snapshots cause title and suit number, enforces opt-in and undertakings, posts a client-visible timeline entry, notifies the served firm's owners/admins and service contact |
| `acknowledge_service(service, note)` | served firm's owner, admin or lawyer (MFA) | acknowledgement of receipt by a practitioner: timestamps and names, notifies the serving lawyer, internal timeline note, audits both firms |
| `link_service_to_matter(service, matter, response_due_on, note)` | served firm's staff (MFA) | files the received process against the served firm's own matter with a response date |
| `revoke_service(service, reason)` | serving firm owner/admin (MFA) or platform admin | withdraws a wrongly served process; the served firm's access ends immediately |
| `post_court_update(matter, outcome, occurred_at, court_name, adjourned_at_instance_of, next_date, next_purpose, note_to_client, internal_note, court_id, judicial_division, allow_non_sitting, judge, courtroom, purpose_kind)` | staff (MFA) | the 30-second form: composes the title, posts client + internal entries, closes the day's court event (matched in court time), opens the next with `court_id`, judge and courtroom; outcomes: hearing_held, adjourned, ruling_delivered, judgment_delivered, struck_out, stood_down, mention, court_did_not_sit, `hearing_notice` (fixes a date without a sitting), `adjourned_sine_die`; refuses a next date that is a weekend, public holiday or published vacation unless the vacation judge will sit |
| `vacate_court_event(event, reason, new_date, new_purpose)` | staff (MFA) | the registry vacated a date: reminders and the sittings digest skip it; refixed date opens a new event; client told |
| `set_firm_status(firm, status, note)` | platform admin (MFA) | the only write platform admins have on a firm: pending → active (stamps `verified_at`, notifies the firm) or suspended |
| `invoice_settlement(invoice)` | the invoice's client, or the firm | the Paystack subaccount the checkout must route to |
| `request_firm_domain(firm, hostname, note)` / `withdraw_firm_domain_request(request)` | owner/admin (MFA) | the firm asks for its own domain and can take the ask back; the platform decides |
| `set_firm_domain(firm, domain, note)`, `set_firm_plan(firm, plan, note)` | platform admin (MFA) | maps the hostname and moves the plan; both audited |
| `set_member_role(firm, user, role)` | owner/admin (MFA) | refuses your own account, refuses to touch an owner unless you are one, refuses to leave the firm without an owner |
| `remove_member(firm, user)` | owner/admin (MFA) | refuses a lawyer with consultations still ahead; clears their availability and takes their profile off the public site |
| `retry_notification(notification)` | platform admin (MFA) | puts a failed message back in the queue and counts the attempt; refuses a sixth |
| `rate_limit_hit(bucket, limit, window, key)` | authenticated, anon | fixed-window counter; a signed-in caller is keyed on their own id, never on what they sent |
| `firm_admin`, `service_inbox`, `firm_service_directory`, `firm_cause_list`, `reference_data_coverage`, `platform_notification_health`, `platform_failed_notifications`, `platform_settlement_health` | views | lifecycle-only tenant list for platform admins; the served firm's only read path (with the served document's name, mime and checksum); active firms' addresses for service and opt-in, for firm staff picking counsel; today's sittings by court; how far the reference data reaches; and the three platform health reads — queued and failed messages, the failures themselves, and payments that settled to the wrong subaccount |
| `release_expired_holds()`, `enqueue_appointment_reminders()`, `enqueue_court_reminders()`, `mark_overdue_invoices()`, `digest_sittings_without_update()` | pg_cron | jobs |

## Decisions still open before launch (blueprint §14)

Platform domain · platform entity · which entity holds the platform Paystack account (each firm settles to its own subaccount) · first friendly firm for week 11 — which now onboards itself at `/firm/start`. Tenant #1's own launch decisions (VAT treatment, service prices, published policies) are its data: see `docs/MASTER_PROMPT_RECONCILIATION.md`.

## Platform data the operator maintains

`courts` (platform rows), `court_vacations` (from each court's practice direction, with whether time runs), `public_holidays` (national and state-declared; movable Eid dates when declared; 2026–2027 fixed dates seeded), `platform_admins`. Platform admins with MFA write the first three at `/admin/reference` (holidays, including movable Eid dates once declared, and each court's vacation); `reference_data_coverage` shows how far the data reaches. See `docs/DOCKET_PLATFORM_MODEL.md` §2.

## Guides and runbooks

| Document | For |
|---|---|
| `docs/ADMIN_GUIDE.md` | the two consoles: what a firm's owner changes, and what only the platform can |
| `docs/CLIENT_GUIDE.md` | what a client can do in the app, in their words |
| `docs/RPC_REFERENCE.md` | every server function: arguments, errors, what it audits |
| `docs/DEPLOYMENT_RUNBOOK.md` | a project from nothing to serving, and what to check after each deploy |
| `docs/RESTORE_RUNBOOK.md` | PITR, the restore rehearsal, and the RPO/RTO this platform commits to |
| `docs/COMPLIANCE_PACK.md` | the privacy notice and DPA wired to `firms.policies`, the DSR and breach runbooks, the NDPC checklist |
| `docs/ONBOARDING_A_FIRM.md` | taking a new firm from registration to live |

## Next slices

See `BUILD_PROMPTS.md` — six self-contained prompts for Claude Code that build the Next.js app on top of this foundation, in the order of the 90-day plan. Slices 1–5 are built; slice 6 is the launch slice.

## Source requirements

Platform model: `docs/DOCKET_PLATFORM_MODEL.md` and `docs/decisions/0003-platform-first.md`. The original Klinique requirements document lives at `docs/Attorneys_Klinique_Partner_Platform_Prompt.md`; `docs/MASTER_PROMPT_RECONCILIATION.md` maps it section by section onto this architecture — what's covered, what the blueprint deliberately changed (Daily vs Google Meet, Supabase Storage vs Google Drive), and the partnership-pooling additions (originating/handling partner attribution, migration 5; Firm Overview scheduled into slice 4).
