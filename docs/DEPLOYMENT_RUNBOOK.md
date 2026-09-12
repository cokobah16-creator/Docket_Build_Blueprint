# Deployment runbook — standing Docket up from nothing

*For whoever is putting Docket into production for the first time, or rebuilding it. Work top to
bottom. Every step says what proves it worked.*

You will need, before you start:

- a Supabase account and organisation
- a Vercel account with the repository connected
- a Paystack account (the **platform's** account — each firm settles to its own subaccount under it)
- a Daily account, a Resend account, a Termii account, and a Twilio account if you have clients on
  non-Nigerian numbers
- somewhere with **npm registry access** — see step 0, which cannot be done from inside this
  project's build environment

Everything Docket reads from the environment is catalogued in `.env.example`, grouped by which of
the three runtimes reads it. Read it before step 5; the most common deployment fault is a function
secret set on Vercel, or a Vercel variable set with `supabase secrets set`.

---

## 0. Two things that cannot be done from here

These are not optional and they are not reachable from the environment this repository was built
in. Do them somewhere they can be done, and tick them off explicitly.

### 0a. Generate `package-lock.json`

There is no lockfile in this repository. It was built with the npm registry closed, and a lockfile
cannot be written without resolving against the registry. Without one:

- `npm ci` does not work anywhere, including in CI — `.github/workflows/ci.yml` runs `npm install`
  instead and says so in a comment;
- `actions/setup-node`'s npm cache cannot be keyed, so every CI run re-resolves;
- two deploys of the same commit can install different transitive versions.

On a machine with registry access, from a clean checkout:

```bash
rm -rf node_modules
npm install
git add package-lock.json
git commit -m "Add the lockfile: the same commit installs the same tree twice"
```

Then change `.github/workflows/ci.yml`: `npm install --no-audit --no-fund` becomes `npm ci`, and
`cache: npm` goes back on the `actions/setup-node` step. Vercel picks the lockfile up on its own.

### 0b. Turn on leaked-password protection and auth rate limits

Both live in the Supabase dashboard and neither has a migration, an API call in this repository, or
a line in `scripts/configure-providers.sh`. **Neither is on by default.**

- **Authentication → Policies (Password security) → Leaked password protection: on.** Supabase
  checks a new or changed password against HaveIBeenPwned's k-anonymity API and refuses one that
  appears in a known breach. This matters for firm staff: `/firm/start` and `/firm/login` are
  email-and-password, and a staff account is one factor away from a whole firm's matters.
- **Authentication → Rate Limits.** Set the per-hour ceilings for sign-ins, OTP sends, token
  refreshes and verifications to something your firms will not hit but an attacker will.
  `rate_limit_hit()` (migration 21) limits the surfaces Docket controls — slots, booking, checkout,
  invitations, firm registration, unverified webhooks. It **cannot** limit GoTrue, because the
  browser talks to `/auth/v1` directly and never passes through Docket's code. An SMS OTP flood is
  a bill as well as an attack; this is the only place it is stopped.

Write down the values you chose. Nothing in the repository records them and nothing will notice if
they are reset.

---

## 1. The Supabase project

1. **Create the project.** `README.md` records the intended hosting region as **London or
   Frankfurt** — there is no Nigerian region, and the cross-border transfer has to be disclosed in
   each firm's privacy notice and DPA (blueprint §14). Choose the region deliberately: it cannot be
   changed afterwards without migrating the project. Record which one you chose — see
   `COMPLIANCE_PACK.md`, which needs it.
2. **Save the connection string** (Settings → Database) and the **project ref**.
3. **Enable the extensions you will need** if they are not already on: `pg_cron` and `pg_net`
   (Database → Extensions). The migrations create `btree_gist` and `pgcrypto` themselves, and skip
   the cron and storage work with a notice when the extension is absent — which is how the same
   files run against a plain Postgres in CI.

### Auth settings

- **Authentication → Providers → Email: on**, confirmations on (`mailer_autoconfirm` false).
- **Authentication → Providers → Phone: on.** Clients sign in with an SMS code; this is the primary
  route for Nigerian clients (`src/components/auth/sign-in-forms.tsx`).
- **Authentication → Multi-Factor → TOTP: on.** This is not a nicety: `staff_w()` and `admin_w()`
  both require `mfa_ok()`, which is the JWT claim `aal = 'aal2'`. **Without TOTP enabled, no staff
  member can write anything at all.** Staff enrol at `/firm/security/mfa`.
- **Site URL and redirect allow-list.** `scripts/configure-providers.sh` sets these over the
  Management API, along with Twilio for SMS OTP if you give it the three Twilio variables:

  ```bash
  SUPABASE_ACCESS_TOKEN=sbp_... \
  SUPABASE_PROJECT_REF=<ref> \
  APP_URL=https://app.example \
  bash scripts/configure-providers.sh
  ```

  It prints back what it set, and tells you what it did not change.
- **Authentication → Hooks → Send SMS** (optional, later): point it at a small function that
  forwards OTPs to Termii on the `dnd` route, so sign-in codes reach Nigerian numbers on the same
  path as everything else. Supabase's built-in Twilio provider works until then.

**Proves it worked:** you can request a code at `/app/login` and receive it.

---

## 2. The schema

```bash
supabase link --project-ref <ref>
supabase db push
```

Migrations apply in filename order, which is chronological:

```
20260909000001_schema.sql                 tables, types, indexes
20260909000002_rls.sql                    RLS on every table, the gate functions
20260909000003_functions.sql              booking, payments, notes, the cron jobs
20260909000004_supabase_storage_cron.sql  the three buckets and their policies; five pg_cron jobs
20260909000005_partner_attribution.sql
20260909000006_firm_public_policies.sql
20260909000007_security_hardening.sql
20260909000008_public_site_realtime.sql
20260909000009_consultations.sql          reschedule, no-show, the dispatcher cron job
20260909000010_client_portal.sql          quiet hours, document versions, realtime
20260910000009_platform_firms.sql         create_firm(), platform_admins, firms.plan/status
20260910000010_nigeria_reference.sql      ng_states, courts, holidays, vacations
20260910000011_counsel_and_service.sql    service of process
20260910000012_platform_hardening.sql
20260910000013_security_review.sql
20260910000014_review_round_two.sql
20260910000015_second_firm_walkthrough.sql
20260910000016_storage_guards.sql
20260910000017_merge_reconciliation.sql
20260910000018_staff_console.sql          manual invoicing, matter invitations, firm_overview
20260910000019_console_review.sql
20260910000020_admin_surfaces.sql         domains, plans, member roles, health views, retries
20260910000021_hardening.sql              RLS on ng_states, search_path, rate limiting, FK indexes
20260910000022_member_and_message_invariants.sqlfirm_members shut to direct writes; last-owner guard; messages immutable
20260910000023_booking_limit_in_the_rpc.sqlthe booking rate limit inside book_appointment()
20260910000024_wave_zero_doors.sql        dead grants revoked; notifications read_at-only for the API; push only with a subscription; audit_log.ip dropped
20260910000025_message_reads.sql          per-reader receipts, firm_threads, who owes the reply
20260910000026_next_action_work_item.sql  next_action gains an owner and a due day
20260910000027_structured_client_update.sqlwhat it means / next / what you must do / when you will hear
20260910000029_matter_walls.sql           opt-in matter walls: firms.matter_walls, matters.access, can_see_matter()
20260910000030_document_reads.sql         document_reads as the door to the bytes — APPLY ONLY WITH ITS FRONT END
20260910000031_document_requests.sql      document_requests: asked, answered once through fulfil_document_request(), withdrawn — never deleted
20260910000032_conflict_checks.sql        matter_adverse_parties; conflict_checks shaped; run_conflict_check(), decide_conflict_check(); firms.conflict_checks_required
20260910000033_wave_two_review.sql        the review round: invitations walled, last member by update, fulfilment columns, clearance on every move, a check bound to its names
20260910000034_onboarding_and_import.sql  matters.legacy_reference; firm_onboarding_steps; firm_readiness(); import_batches/import_rows, process_import_batch(), preview_import_duplicates(), discard_import_batch(); normalise_scn() checks the number only when it changes
20260910000035_pre_consultation_checkin.sql firms.checkin_before_confirm; document_requests and conflict_checks reach a consultation; appointment_readiness(), amend_intake_response(), confirm_appointment(); book_appointment/record_payment/reminders/release learn the hold
20260910000036_drafts_and_retries.sql     updates.client_ref (a retry returns the posting already made); a document with no file answers no request; retire_empty_document(); storage_integrity() counts rows without a version
20260910000037_notifications_reliability.sql notifications: provider, provider_ref, accepted_at, delivered_at, delivery_status, failure_kind, send_attempts, segments, cost; dedupe_key; claim_notifications()/finish_notification(); record_delivery_receipt(); provider_rates + set_provider_rate(); platform_notification_cost, platform_firm_active_matters
20260910000038_legal_diary.sql            court_events provenance (created_by, source_document_id, source_ref, confirmed_by) and audit; court_rules/rule_provisions; is_time_stopped(), count_deadline(); deadlines + compute/confirm/discharge_deadline(); firm_deadlines; enqueue_deadline_reminders() on cron 06:00
20260910000039_workflow_packs.sql         workflow_packs (versioned, immutable) + firm_workflow_packs; matter_statuses pack/matter_types/default_next_action; tasks template_key; publish_workflow_pack(), install_workflow_pack(), set_matter_status(); open_matter() re-created (unknown key refused, entry stage); two default packs as data; matter_statuses and tasks audited
```

Then the launch tenant's data, if you are running one:

```bash
psql "$DATABASE_URL" -f supabase/seed.sql
```

`seed.sql` is **data, not code**. It inserts one firm with its brand, its service catalogue and its
intake questions, and calls the same `seed_firm_defaults()` every self-registered firm gets.
Nothing in `app/` or `src/` refers to it. Skip it entirely if your first firm will register itself
at `/firm/start`. Its terms and privacy versions are deliberately left as `0-draft`, which means
bookings are refused until the firm publishes real ones.

**Proves it worked:** `select count(*) from pg_policies where schemaname = 'public';` returns a
large number, and `select * from reference_data_coverage;` returns one row.

### The first platform admin

Not created through the app, on purpose. With the service role or in the SQL editor:

```sql
insert into platform_admins (user_id, note)
select id, 'founder' from profiles where email = 'ops@example.com';
```

That account must have signed up first — `profiles` is filled by a trigger on `auth.users` — and
must enrol TOTP before `/admin` will let it do anything, because every platform write checks
`mfa_ok()`.

---

## 3. The Edge Functions

Five functions, and **four of them must be deployed with `--no-verify-jwt`**, because their callers
hold no Supabase session. There is no `supabase/config.toml` in this repository, so the flag has to
be on the command line every time.

```bash
supabase functions deploy paystack-webhook        --project-ref <ref> --no-verify-jwt
supabase functions deploy dispatch-notifications  --project-ref <ref> --no-verify-jwt
supabase functions deploy delivery-receipts       --project-ref <ref> --no-verify-jwt
supabase functions deploy storage-manifest        --project-ref <ref> --no-verify-jwt
supabase functions deploy video-session           --project-ref <ref>
```

- **`paystack-webhook`** is called by Paystack, which sends no JWT. It is not unauthenticated: it
  verifies `x-paystack-signature` (HMAC-SHA512 of the raw body with the secret key) in constant
  time, and re-verifies the charge against Paystack's own `/transaction/verify` before any figure
  reaches `record_payment()`.
- **`dispatch-notifications`** is called by `pg_cron`, which sends `x-cron-secret` and nothing else.
  That secret is its only credential and is compared as a digest, not as a string. From v9
  (migration 37) it claims rows through `claim_notifications()` and finishes them through
  `finish_notification()` with the provider's own message id, the SMS segment count and the cost
  at the rate the platform entered; a 5xx or a timeout comes back with a growing delay, five
  times, and a 4xx or a missing address fails at once.
- **`delivery-receipts`** is called by the providers with what became of a message, at three
  doors: `/functions/v1/delivery-receipts/resend` (Resend's email events, signed by Svix —
  enter that URL in Resend's dashboard with the `email.delivered`, `email.bounced`,
  `email.delivery_delayed` and `email.complained` events, and set the signing secret as
  `RESEND_WEBHOOK_SECRET`), `/twilio` (Twilio's status callback — nothing to enter at Twilio: the
  dispatcher passes `TWILIO_STATUS_CALLBACK_URL` with every message, and the function verifies
  `X-Twilio-Signature` against that same URL, so the two must be the exact same string), and
  `/termii?token=<TERMII_WEBHOOK_TOKEN>` (Termii signs nothing, so the token is the door — enter the
  URL with the token in Termii's dashboard as the delivery-report webhook). A delivery that does
  not verify is recorded in `webhook_events` as `unverified`, rate-limited, and never applied; a
  verified one writes `delivered_at` / `delivery_status` through `record_delivery_receipt()` by the
  provider's message id. Without this function every message stops at *accepted*, which the
  health screen says in words.
- **`storage-manifest`** is called by `pg_cron` every ten minutes with the same `x-cron-secret`
  (migration 28). It downloads a bounded batch of objects from the `documents` and
  `intake-uploads` buckets, hashes them against `document_versions.checksum`, and writes
  `storage_manifest`; `/admin/health` reads the result through `storage_integrity()`. It needs two
  Vault secrets — `cron_secret`, which the dispatcher already has, and
  `vault.create_secret('https://<ref>.supabase.co/functions/v1/storage-manifest', 'storage_manifest_url')`
  — and is a no-op until both exist.
- **`video-session`** is called by signed-in people and reads the `Authorization` header itself, so
  it keeps JWT verification on.

### Function secrets

```bash
supabase secrets set --project-ref <ref> \
  PAYSTACK_SECRET_KEY=sk_live_... \
  DAILY_API_KEY=... \
  CRON_SECRET="$(openssl rand -hex 32)" \
  APP_URL=https://app.example \
  RESEND_API_KEY=... EMAIL_FROM=notifications@example \
  TERMII_API_KEY=... TERMII_SENDER_ID=... \
  TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+1... \
  TWILIO_STATUS_CALLBACK_URL=https://<ref>.supabase.co/functions/v1/delivery-receipts/twilio \
  RESEND_WEBHOOK_SECRET=whsec_... TERMII_WEBHOOK_TOKEN="$(openssl rand -hex 24)" \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:ops@example
```

The three receipt secrets are new with migration 37. `TWILIO_STATUS_CALLBACK_URL` is read by both
the dispatcher (sent with every message) and the receipts function (verified against); Resend's
signing secret comes from the webhook it creates; the Termii token is yours to mint, and goes into
Termii's dashboard inside the URL.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase — do
not set them. Generate the VAPID pair once and keep both halves: the public half also goes on
Vercel as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and a subscription made with one public key cannot be
signed with a different private one.

**Proves it worked:** `curl -X POST https://<ref>.supabase.co/functions/v1/dispatch-notifications`
with no header returns `unauthorized` (401), and with the right `x-cron-secret` returns
`{"sent":0,"failed":0,"requeued":0,"unfinalised":0}` — four fields, and `unfinalised` must stay
zero on every run thereafter, for the reason §7 gives. `curl -X POST https://<ref>.supabase.co/functions/v1/delivery-receipts/termii`
with no token returns `unverified` (401) and leaves an `unverified` row in `webhook_events`. The same call to `/functions/v1/storage-manifest` returns
`forbidden` (403) without the header and a JSON count of what it verified with it; within an hour
`/admin/health` should show every object verified and none missing.

---

## 4. The scheduled jobs

Migration 4 schedules five jobs as soon as `pg_cron` is present, and needs nothing from you:

| Job | Schedule |
|---|---|
| `docket-release-holds` | every minute |
| `docket-appointment-remind` | every minute |
| `docket-court-remind` | 07:00 |
| `docket-overdue-invoices` | 00:15 |
| `docket-sitting-digest` | 07:30 |

The sixth is different. Migration 9 schedules `docket-dispatch-notifications` every minute, and the
job reads its URL and its shared secret **out of Vault every time it runs**. Until both secrets
exist the job fires, finds nothing, and posts nothing — so no client receives any email, SMS or
push message, and nothing on any screen says so. Create them:

```sql
select vault.create_secret(
  'https://<ref>.supabase.co/functions/v1/dispatch-notifications', 'dispatch_url');
select vault.create_secret('<the same CRON_SECRET you set above>', 'cron_secret');
```

**Proves it worked:** after a minute or two,
`select jobname, status, return_message from cron.job_run_details order by start_time desc limit 10;`
shows `docket-dispatch-notifications` succeeding, and a queued notification moves from `queued` to
`sent`. `/admin/health` shows the same thing without SQL.

---

## 5. Vercel

Connect the repository. `vercel.json` already sets the framework; there is nothing to configure
about the build.

Set these in **Settings → Environment Variables** (values and what reads each one are in
`.env.example`):

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything. Without it every screen renders a "not configured" notice |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the same |
| `PAYSTACK_SECRET_KEY` | initialising a checkout from a server action. **The same key as the function secret** |
| `APP_URL` | the host `/admin` tells a firm to point its DNS at |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | the push opt-in. The same public key as the function secret |
| `DAILY_DOMAIN` | **build-time.** Names the room origin in `Permissions-Policy` so the consultation iframe may use the camera and microphone. Unset, that policy falls back to `*` for those features — it works, but wider than necessary. Changing it needs a redeploy |
| `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | mapping custom domains from `/admin`. `VERCEL_TEAM_ID` only if the project is under a team |
| `SENTRY_DSN`, `POSTHOG_KEY`, `POSTHOG_HOST` | optional; each is inert when unset |

**Never set `SUPABASE_SERVICE_ROLE_KEY` on Vercel.** Nothing in `app/` or `src/` reads it and
nothing may: the only clients there run as the signed-in person so that RLS decides.

### Wildcard subdomains

`src/lib/tenant.ts` resolves a firm from the request host in three steps: a subdomain of
**`.docket.app`** by slug, then a custom domain by exact match, then `?firm=<slug>` — which is the
development and preview route, not a public one, and is **ignored entirely on the production
deployment**: `resolveFirm()` skips it whenever `isProductionDeployment()` is true (`src/lib/env.ts`).

**The subdomain suffix is a literal in that file**, not an environment variable:

```ts
if (bareHost.endsWith(".docket.app")) { … firmBySlug(sub) … }
```

So there are two cases:

- **The platform domain is `docket.app`.** Add `*.docket.app` to the Vercel project
  (Settings → Domains) and point the DNS wildcard at Vercel. Every firm is then reachable at
  `{slug}.docket.app` from the moment it is activated.
- **The platform domain is something else.** Subdomain resolution will not work until that
  constant in `src/lib/tenant.ts` is changed to your suffix. Until then, every firm needs a custom
  domain, and `set_firm_domain()` becomes part of onboarding rather than an extra.

**Proves it worked:** `https://<slug>.docket.app/` renders that firm's home page with its own
colours, and the platform's own root renders the landing page. Where the wildcard is not in place
yet, `https://<your deployment>/<slug>` renders the same tenant page **by path** — the `[firm]`
route segment resolves a slug on its own (`app/(public)/[firm]/layout.tsx` calls `firmBySlug()`
and never touches `resolveFirm()`) — which is how to tell a DNS problem apart from a data problem:
a 404 there means the firm is not active or not there; the tenant page means the DNS wildcard is
what is missing.

Do **not** use `https://<your deployment>/?firm=<slug>` for this on production. It is ignored
there, so it renders the landing page whether or not the firm exists — a diagnostic that gives the
same answer in both cases, and reads as "the firm is not there" when the firm is fine.

---

## 6. Paystack

1. **Webhook.** Paystack exposes no API for this; it is dashboard-only.
   Settings → API Keys & Webhooks → set **both** the Test and Live webhook URLs to:

   ```
   https://<ref>.supabase.co/functions/v1/paystack-webhook
   ```

2. **A subaccount per firm.** Docket never holds money (decision 0002). Every prepaid booking
   initialises with `subaccount` and `bearer: 'subaccount'`, and `record_payment()` applies a
   payment **only** when Paystack reports that firm's own subaccount code. Anything else is
   recorded as a `failed` payment carrying `settlement_mismatch`, audited, and reported to the firm
   — it confirms nothing and pays nothing off.

   Create the subaccount from the firm's own bank details (Paystack dashboard → Subaccounts, or
   `POST /subaccount`), give the firm its code, and let the firm's **owner or administrator** store
   it at `/firm/admin/settings`. A platform admin cannot write it.

   Until it is set, `book_appointment()` refuses a priced prepaid booking with
   `this firm is not yet set up to receive payments`.

**Proves it worked:** a test booking reaches Paystack's checkout, and after paying, `/admin/health`
shows the delivery in the webhook list with `signature_ok` true and outcome `processed`, and the
appointment is `confirmed`.

---

## 7. First run through

In this order, because each step unblocks the next:

1. Sign up a staff account and enrol TOTP at `/firm/security/mfa`.
2. Register the firm at `/firm/start`, or seed it. It is `pending`.
3. As the platform admin, verify it against CAC and the Roll of Legal Practitioners — `/admin`
   shows the RC/BN number and each owner's enrolment number for exactly that — and activate it.
4. As the firm: publish terms and privacy at `/firm/admin/settings` (a version starting `0-` is not
   published), store the Paystack subaccount code, price and activate a service at
   `/firm/admin/services`, and set a lawyer's working week at `/firm/availability`.
5. Book a consultation as a client, pay it, and join the room.

If step 5 stalls, `/admin/health` answers all three of the usual questions: did the money settle to
the right account, is the notification queue moving, and did anything reach us that would not
verify.

---

## Redeploying, afterwards

- **Schema:** add a migration; never edit one that has been applied. `supabase db push`.
- **Functions:** `supabase functions deploy <name>` — and remember `--no-verify-jwt` on the two that
  need it, every time.
- **App:** push to the branch Vercel builds.
- **Before any of it:** CI runs the migrations, the seed and **every** suite in `supabase/tests/`
  against a clean Postgres 16 — the job counts the files and refuses to pass unless each one
  printed `ALL CHECKS PASSED`, so a suite that never ran fails the build rather than disappearing.
  A red `sql` job means a policy changed meaning, and that is the one to stop for.

## Release record

What is running against what. Three things, reconciled against the sources named, on the date
given — not a plan, a reading. Update it on every production deploy and every applied migration;
a release nobody can name is the state this section exists to end.

**Order matters for some migrations.** 25 and 30 change what the front end must do (call
`mark_thread_read()`; call `open_document_version()` before asking Storage for a file), so each goes
live only after production is READY on the front end that does it — otherwise threads stop clearing,
or documents stop opening. 29 is safe either side: it is default-off and identical in effect to the
policies it replaces until a firm switches walls on. 31 is additive and goes **first** — the matter
screens that ship with it select from `document_requests`, so the table must exist before they
deploy — and `dispatch-notifications` must carry the `document_requested` / `document_received`
renderers (v8) before the first request is made. 32 is safe either side: it re-creates
`open_matter()` with two more defaulted parameters (the deployed form passes named arguments and
resolves to it), pg_trgm goes into the `extensions` schema, and the clearance guard is off until a
firm switches it on. 33 is safe either side for the same reasons: it tightens what 29, 31 and 32
admit without changing any call the deployed front end makes. 34 is additive and safe either side:
nothing the deployed front end reads changes, and the new screens read only the new function
and tables. **35 goes first, and so does 36** — the "safe either side" this entry first claimed was argued
only in the schema-ahead direction, which is half the question. Schema first is indeed harmless
for both: with every firm's `checkin_before_confirm` off, `book_appointment()` and
`record_payment()` behave exactly as before, `document_requests.matter_id` becoming nullable
changes nothing the deployed front end selects, and `post_court_update()` merely gains trailing
defaulted parameters that the deployed form's named arguments still resolve to. **App first
breaks both screens outright.** The settings page selects `firms.checkin_before_confirm`, and
against a schema without it PostgREST answers 42703, the row reads as null and the page renders
its "this firm's row could not be read" card — taking brand, policies, settlement and domain down
with it, for every firm. And the new court-update form always sends `p_client_ref`; PostgREST
matches an RPC by the set of named parameters supplied, so against the 20-parameter
`post_court_update` there is no such function and every court update is refused with PGRST202.
Apply 35 and 36, then deploy. 37 goes **first, then the functions**: the deployed dispatcher (v8) keeps working
against 37 — it updates rows as the service role, which the column rule lets through, and simply
records nothing new — while v9 calls `claim_notifications()`, which exists only after 37, so v9
deployed ahead of 37 sends nothing and answers 500 every minute. Apply 37, deploy
`dispatch-notifications` v9 and `delivery-receipts`, set the three receipt secrets, then enter the
provider rates on `/admin/health`. **Watch `unfinalised` in the dispatcher's answer.** The run
returns `{sent, failed, requeued, unfinalised}`; the last is the count of messages the provider
accepted whose outcome could not be written back after three attempts. Those rows are still
`sending`, `claim_notifications()` requeues them after ten minutes, and the person is sent the same
message a second time. It should be zero; anything else is a database the function could reach to
claim and not to finish, and is worth looking at the moment it appears rather than hearing about
from a client; nothing the front end reads changes except the two health views
gaining columns at the end. 38 is additive and safe either side: `firm_cause_list` gains columns
at the end, every new table and function is new, and the deadline reminders (`docket-deadline-remind`,
06:00 daily) render through the v9 dispatcher — deploy v9 before the first confirmed deadline
comes within a week of its day, or the reminder goes out with the generic sentence. 39 is safe
either side: `open_matter()` keeps its signature (the deployed form resolves to it; the default
key now means the firm's entry stage, and a firm's own unknown key is refused instead of opening
the matter with no stage), a direct write of `matters.status_id` — what the deployed edit panel
does — is still allowed by the policy and simply does not post the status_change entry or start
the stage's tasks until the front end that calls `set_matter_status()` deploys, and the two
default packs are catalogue rows nothing reads until a firm installs one. 40 is safe either side,
but it is the one migration in this wave that **narrows an existing grant**, so check the list rather
than assume: it revokes the blanket `insert` on `document_versions` and re-grants exactly
`(id, document_id, storage_path, mime, size_bytes, checksum, uploaded_by)`, and revokes the blanket
`update` on `documents` and re-grants exactly `(name, category, client_visible, reviewed_at,
reviewed_by)`. Those are the columns the deployed front end writes and no others — the staff upload,
the portal upload, the share toggle and "mark as reviewed" all resolve to the granted list, so they
keep working; anything outside it now answers `42501` instead of being written. The lock guards fire
only on a document that has been executed, and none exists until the front end that executes one
deploys. Everything else in 40 is new tables, new columns at the end of `documents` and
`document_versions`, and new functions. The dispatcher must carry the `document_ready_to_sign` /
`document_signed` renderers — they are in the same v9 that 37 requires — before the first signature
is asked for, or the ask goes out with the generic sentence. 41 is additive and safe either side:
`firm_baselines`, `firm_metrics()`, `record_firm_baseline()` and the `audit_log (firm_id, action,
at desc)` index are all new, and only the new screen reads any of them. It deliberately leaves the
`audit_log` platform allow-list alone: taking a baseline is the firm's own act over its own rows,
and an earlier draft that re-created the policy to add an entity nobody needed silently dropped
four arms of it. 42 is safe either side and is the one migration in this wave that
**removes** something: the `insert`, `update` and `delete` grants on `invoices` and `invoice_items`,
with their policies. Checked before writing it — every reference to either table in `app/` and
`src/`, on this branch and on `origin/main`, is a `.select()`; the four invoice functions are
SECURITY DEFINER and unaffected. So nothing the deployed front end does stops working, and what
stops working is only what nothing ever did.

**43 goes before the app.** The two new search screens — `/firm/search` and `/app/search` — call
`search_docket()`, which exists only after this migration, so an app deployed first answers every
search with PGRST202 and a screen that says the search did not come back. Nothing else in the
deployed front end touches it, so the reverse order is harmless: applied ahead of its screens, 43
simply adds a `search_doc` column to ten tables and a function nothing yet calls. Two notes for
whoever applies it. It rewrites those ten tables to add the stored column, so it is not instant on
a large database — at pilot volumes it is seconds, but do it in the same window as the rest rather
than mid-morning. And there is one property to check afterwards rather than assume, because the
whole design rests on it:

```sql
select prosecdef from pg_proc where proname = 'search_docket';   -- must be f
```

`false` is the answer that matters. `search_docket()` is SECURITY INVOKER on purpose: it reads
every table as the caller, so a walled matter is absent from a search because it is absent from
`matters` for that reader. Were it ever changed to SECURITY DEFINER, it would become a firm-wide,
wall-free read of everything in one word, and suite `99_search.sql` asserts `prosecdef` is false
for exactly that reason.

| | As of 11 Sep 2026, 16:40 UTC | Reconciled against |
|---|---|---|
| **App** | `bcc1dc8` (the merge of PR #20), production READY | Vercel → the project's deployment list: the latest deployment with `target: production` and `state: READY` |
| **Schema** | Migrations **1–33**, all applied: 35 ledger entries (`20260909000001_schema` … `wave_two_review`, plus the two unnumbered `consultations` and `client_portal`). 30 (`document_reads`) was applied last, after this deploy was READY, per the ordering rule above; 29, 31, 32 and 33 had gone live ahead of their front end, each default-off or additive | `supabase_migrations.schema_migrations` (MCP `list_migrations`) |
| **Edge Functions** | `paystack-webhook` **v5** · `dispatch-notifications` **v8** (renders `document_requested` / `document_received`) · `video-session` **v2** · `storage-manifest` **v1** (`storage_manifest_url` in Vault; `docket-storage-manifest` runs `*/10 * * * *`) | MCP `list_edge_functions`; `cron.job`; `cron.job_run_details` |

Migration ledger names are the file names for 1–21 and short names after: `wave_two_review` is
`20260910000033_wave_two_review.sql`, `conflict_checks` 32, `document_requests` 31, `matter_walls` 29, `storage_manifest` 28, `structured_client_update` 27,
`next_action_work_item` 26, `message_reads` 25, `wave_zero_doors` 24, `booking_limit_in_the_rpc` 23,
`member_and_message_invariants` 22.

Previous: app `2adae58` against 1–29 and 31–33 (16:28 UTC — the record as first written said 16:50, ahead of its own commit); app `2adae58` against 1–28 (13:35 UTC).

Previous: app `fe45072` against 1–25 (12:40 UTC); app `6778f3c` against 1–24 (11:30 UTC), when the
schema was ahead of the app by five migrations with the compat suite as the reason that was safe.

## Related

- `docs/ONBOARDING_A_FIRM.md` — bringing a firm on, step by step, once the platform is up.
- `docs/RPC_REFERENCE.md` — every function, who may call it, what it refuses.
- `docs/RESTORE_RUNBOOK.md` — what a backup covers, what it does not, and how long recovery takes.
- `docs/COMPLIANCE_PACK.md` — what personal data is held and where.
