# Restore runbook — what a backup covers, and what it does not

*For whoever is on the end of the phone when something is gone. Read the inventory first: half of
what Docket depends on is not in any database backup, and knowing which half is the difference
between a two-hour recovery and a two-day one.*

---

## Point-in-time recovery is OFF until somebody turns it on

Say this out loud before anything else, because it is the single assumption most likely to be
wrong.

A Supabase project takes **daily** backups by default. **Point-in-time recovery is a paid add-on
and it is not enabled by default** — Database → Backups → Point in Time Recovery in the dashboard.
There is no migration, no API call in this repository and no line in
`scripts/configure-providers.sh` that turns it on, and nothing in Docket will ever notice that it
is off.

With daily backups only, the worst case is **losing a full working day** of court updates,
consultations, invoices, messages and uploaded documents. For a law firm that is a day of a
client's file: a hearing outcome not recorded, a filing not logged, a date not fixed. Decide
deliberately whether that is acceptable. It probably is not.

**Check now, and record the answer with a date:**

- [x] PITR enabled — **no, by decision, 11 Sep 2026.** No firm has real client files on Docket yet, so the add-on is not bought yet; the RPO below is stated as 24 hours accordingly. **Revisit before the first firm goes live with real matters** — that is the trigger, and it is written here so it is not forgotten
- [ ] Daily backup retention: ______ days
- [ ] Storage object backup arrangement: ______ (see §2)

---

## 1. The inventory — everything with state

### 1.1 The database

Everything in `public`, plus `auth.users`, plus `storage.objects` metadata. That is:

| Group | Tables |
|---|---|
| Identity and tenancy | `profiles`, `firms`, `firm_members`, `firm_counters`, `lawyer_profiles`, `platform_admins`, `staff_invites` |
| Catalogue and intake | `services`, `intake_forms`, `intake_responses` |
| Diary and consultations | `availability_rules`, `availability_exceptions`, `appointments`, `consultation_sessions`, `consultation_notes`, `consultation_internal_notes` |
| Matters | `matter_statuses`, `matters`, `matter_parties`, `matter_lawyers`, `matter_counsel`, `matter_court_numbers`, `updates`, `court_events`, `tasks`, `conflict_checks`, `invites` |
| Documents and messages | `documents`, `document_versions`, `messages`, `process_service` |
| Money | `invoices`, `invoice_items`, `payments` |
| Comms | `notifications`, `notification_preferences`, `push_subscriptions` |
| Compliance | `consent_records`, `audit_log` |
| Content and platform | `content`, `domain_requests`, `webhook_events`, `ng_states`, `courts`, `public_holidays`, `court_vacations`, `rate_limits` |

Three of these deserve naming separately:

- **`audit_log` is append-only.** A restore rolls it back like anything else. The log will then be
  missing entries for actions that really happened, and — if you restored to an earlier point —
  will contain entries for rows that no longer exist. Note the restore point in the log itself as
  the first act after recovery, so the discontinuity is documented rather than discovered.
- **`consent_records` is the consent chain.** Each row pins one client to one firm's terms or
  privacy **version string**. Lose rows and every affected client is asked to consent again at
  their next sign-in, which is harmless. Lose the whole table and you have no evidence any client
  ever consented, which is not.
- **`rate_limits`** is disposable. It rebuilds itself; never restore it deliberately.

**Covered by:** Supabase daily backups, and PITR if you enabled it.

### 1.2 Storage — three buckets, and only one is replaceable

Created by migration 4. The file bytes live in object storage; the **rows describing them** live in
the database, and the two can be restored to different moments.

| Bucket | Public | Limit | Holds | If the bytes are lost |
|---|---|---|---|---|
| `documents` | no | 25 MB | Every matter and consultation document, at every version: `documents/{firm_id}/{document_id}/{version_id}.{ext}`. PDFs, Word documents, photographs of exhibits | **Unrecoverable from within Docket.** `document_versions` rows survive with a `storage_path` that 404s and a `checksum` of a file nobody has. To a lawyer this reads as "the document is gone", because it is |
| `intake-uploads` | no | 25 MB | What clients attach when booking: `intake-uploads/{firm_id}/{client_id}/{filename}` | Lost. The answers themselves are in `intake_responses` and survive |
| `firm-assets` | **yes** | 5 MB | Firm logos and public images: `firm-assets/{firm_id}/…` | Replaceable — ask each firm to upload its logo again |

**Covered by:** this is the question to settle explicitly, because the answer depends on your
Supabase plan and on Supabase's current backup product, and **this repository cannot tell you**.
The `storage.objects` rows are in Postgres and are in the database backup; the object bytes are
not the same thing.

Do this, in writing, before you need it:

1. Read Supabase's current backup documentation for your plan and establish whether object bytes
   are included in the backup you are relying on.
2. If they are not, arrange a separate copy of the `documents` and `intake-uploads` buckets on a
   schedule at least as frequent as your database backup, and store it somewhere a compromise of
   the Supabase project cannot reach.
3. Record the answer and the date in the checklist at the top of this file.

A restore that brings back rows without bytes is worse than one that brings back neither, because
the system will look intact.

### 1.3 Edge Function secrets

Held only in Supabase's secret store. **Not in any database backup, and not readable back out** —
`supabase secrets list` shows names and digests, not values.

`PAYSTACK_SECRET_KEY`, `DAILY_API_KEY`, `CRON_SECRET`, `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`,
`TERMII_API_KEY`, `TERMII_SENDER_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

**Keep every value in the team password manager.** Two of them cannot simply be regenerated:

- `VAPID_PRIVATE_KEY` — lose it and **every existing push subscription is dead**. A subscription is
  bound to the public key it was created with. You would mint a new pair, set both halves (the
  public one also goes on Vercel as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`), and `truncate
  push_subscriptions` so clients are asked to opt in again. Push notifications stop silently until
  they do; nothing else breaks.
- `CRON_SECRET` — it has a twin in Vault (§1.4). Change one and you must change the other in the
  same breath, or the dispatcher stops sending and nothing says so.

### 1.4 Vault

Two secrets, read by the `docket-dispatch-notifications` cron job every minute:

- `dispatch_url` — `https://<ref>.supabase.co/functions/v1/dispatch-notifications`
- `cron_secret` — the same value as the `CRON_SECRET` function secret

They live in `vault.secrets`, encrypted with a key held by the platform and scoped to the project.
**Restoring a logical dump into a different project does not bring back usable secrets.** Recreate
them by hand after any restore into a new project — and note that the `dispatch_url` itself changes,
because it carries the project ref.

Until both exist, the job runs every minute, posts nothing, and **no client receives any email, SMS
or push message**. Nothing on any screen reports this. It is the quietest failure in the system.

### 1.5 Scheduled jobs

Six, in `cron.job`: `docket-release-holds`, `docket-appointment-remind`, `docket-court-remind`,
`docket-overdue-invoices`, `docket-sitting-digest` (migration 4) and
`docket-dispatch-notifications` (migration 9).

They are re-created by re-running the migrations, which is the reliable way to get them back —
migration 9 unschedules before it schedules, and `cron.schedule` replaces a job of the same name.
Do not hand-edit `cron.job`.

**Verify after any restore:** `select jobid, jobname, schedule, active from cron.job order by jobname;`
— six rows, all active.

### 1.6 Everything outside Supabase and Vercel

**No backup holds any of this.** It is the part that turns a database restore into a working
platform, and it is the part people forget.

| What | Where it lives | What it costs to rebuild |
|---|---|---|
| **Paystack subaccounts** | Paystack. `firms.paystack_subaccount` holds only the **code**; the bank details behind it are Paystack's | The codes come back with the database. If the Paystack account itself is lost, every firm must re-supply its bank details and every code changes — and until each firm's owner stores the new code, `book_appointment()` refuses prepaid bookings with *this firm is not yet set up to receive payments* |
| **The Paystack webhook URL** | Paystack dashboard only — there is no API for it | Re-enter it. Must change if the project ref changed. Until it is right, charges succeed at Paystack and Docket never learns: invoices stay unpaid, appointments stay `awaiting_payment`, and a 15-minute hold expires under a client who has already paid |
| **Daily rooms** | Daily, created on demand by `video-session` | Nothing. Rooms are per appointment, expire an hour after it ends, and are re-created on the next join. `consultation_sessions.room_name` may point at an expired room; the function handles that |
| **The Vercel domain mapping** | Vercel project domains, plus `firms.custom_domain` in the database | Both sides must agree. The database half comes back with the restore; the Vercel half must be re-attached with `set_firm_domain()`'s counterpart in `src/lib/providers/domains/vercel.ts`, or by hand in the Vercel dashboard. A hostname in `firms.custom_domain` that Vercel is not holding is a firm's entire public site pointing at a host that never loads |
| **DNS at each firm's registrar** | The firm's registrar. Not yours | Out of your hands entirely, and bounded by that record's TTL. This is why the recovery time for custom domains cannot be promised |
| **The wildcard `*.yourdomain` record** | Your DNS | Re-point at Vercel. Every firm without a custom domain is unreachable until it resolves |
| **Supabase Auth configuration** | Supabase project settings | Site URL, redirect allow-list, email and phone providers, **TOTP**, **leaked-password protection**, **auth rate limits**. `scripts/configure-providers.sh` restores the first three. The last three are dashboard-only. Without TOTP enabled **no staff member can write anything**, because `staff_w()` requires `aal2` |
| **Supabase API keys** | The project | Restoring into a **new** project mints new anon and service keys. Every `NEXT_PUBLIC_SUPABASE_*` value on Vercel changes, and the app must be redeployed |
| **Vercel environment variables** | Vercel | Re-enter from `.env.example` and the password manager |
| **Resend domain verification, Termii sender ID, Twilio number** | Each provider | Verification and sender-ID approval take provider time, not yours. Until then messages fail and land in `notifications` as `failed` — recoverable one at a time with `retry_notification()`, five attempts maximum |
| **Sentry and PostHog projects** | Each provider | Telemetry only. Nothing in Docket depends on them; both are inert when unset |

---

## 2. The objectives, and the working behind them

These are targets to commit to, with the arithmetic shown. **Replace them with measured numbers
after the first drill** (§4) — an untested objective is a wish.

### RPO — how much work can be lost

| Configuration | RPO | Why |
|---|---|---|
| Daily backups only (**the default**) | **up to 24 hours** | The backup is taken once a day; everything since is gone |
| PITR enabled | **minutes**, to the granularity of the WAL archive interval on your plan | Recovery to a chosen moment rather than to last night |

**The RPO this platform commits to today is 24 hours.** PITR is off by a dated decision (§0):
until a firm has real client files here, the add-on is not bought, and this document says what is
true rather than what is wished. The 15-minute figure returns the day PITR is switched on — and
only then, with the date beside it.

What 24 hours actually costs, in this system:

- **Court updates.** A day of `post_court_update()` calls: outcomes, next dates, the client entries
  posted against them, and the `court_events` closed by them. `firm_sittings_due` will correctly
  report those sittings as still needing an update, so the firm sees the gap rather than losing it
  silently — but it must be typed again from the lawyer's own note.
- **Appointments and payments.** Payments are the least bad case: Paystack holds the truth, and
  `record_payment()` is **idempotent on `provider_ref`**, so redelivering a day of webhooks from the
  Paystack dashboard restores the payment rows exactly. What cannot be replayed is an **appointment
  booked and not yet paid**, whose row is simply gone.
- **Documents.** If Storage is on a different timeline from the database, a day of uploads leaves
  bytes in the bucket with no row (findable by listing the bucket and comparing against
  `document_versions`) or rows with no bytes (not recoverable). The first is tedious; the second is
  a loss.
- **Messages, invoices, consent.** Straightforwardly lost for that window. Clients re-consent at
  their next sign-in without being asked anything unusual.

### RTO — how long until it works again

Two cases, because they are very different.

**A. Restore in place, same project** — corruption or a bad write, nothing lost externally:

| Step | Budget |
|---|---|
| Decide, declare, and stop writes | 15 min |
| Supabase restore to the chosen point | 30 min (longer as the database grows; measure yours) |
| Verify: policy count, the six cron jobs, `reference_data_coverage`, a signed-in read | 15 min |
| Smoke test: book, pay, join a room, post a court update | 20 min |
| **Total** | **≈ 1 hour 20 minutes** |

Nothing external moves: the project ref, the keys, the webhook URL, the Vault secrets and the
domains are all unchanged.

**B. Restore into a new project** — the project is lost:

| Step | Budget |
|---|---|
| Create the project, same region; restore the backup into it | 45 min |
| Re-create the two Vault secrets (§1.4) | 5 min |
| Re-deploy three Edge Functions — **two with `--no-verify-jwt`** — and set every secret (§1.3) | 20 min |
| Re-run `scripts/configure-providers.sh`; re-enable TOTP, leaked-password protection and auth rate limits by hand | 20 min |
| New anon key into Vercel; redeploy | 15 min |
| Re-point the Paystack webhook at the new project ref | 5 min |
| Re-attach every custom domain in Vercel | 15 min + **the registrar's TTL, which is not yours** |
| Verify and smoke test | 30 min |
| **Total, excluding DNS** | **≈ 2 hours 35 minutes** |

The objective to commit to is **4 hours** for the platform's own surface — the arithmetic above
plus room for one thing going wrong. **Custom domains are excluded from the objective**, because
their recovery is bounded by TTLs at registrars Docket does not control. Say so to firms in
advance; a firm that learns this during an outage hears an excuse.

---

## 3. The restore itself

1. **Stop the bleeding.** If the cause is still writing, suspend the firms involved
   (`set_firm_status(firm, 'suspended')`) — `staff_w()` and `admin_w()` both consult
   `firm_not_suspended()`, so every write at that firm stops at once while reads keep working.
   Do not pause the project: pausing stops the cron jobs and the dispatcher too.
2. **Choose the point**, and write down why. With PITR, the moment before the first bad write. With
   daily backups only, you have no choice — say which night's backup, in UTC.
3. **Restore** from the Supabase dashboard.
4. **Reconcile Storage against the database.** List `documents/` and compare the object paths with
   `select storage_path from document_versions`. Rows with no object are the ones to tell firms
   about, by name, before they find out from a client.
5. **Re-run the checks in §1.4 and §1.5**: the two Vault secrets, and six active cron jobs.
6. **Note the restore in the audit trail** so the discontinuity is documented:

   ```sql
   select audit('platform.restored', 'platform', null, null,
                jsonb_build_object('restored_to', '2026-09-10T22:00:00Z', 'reason', '…'));
   ```

   (`audit()` is revoked from every API role; run it as the service role or in the SQL editor.)
7. **Smoke test the whole path:** sign in, book, pay, receive the confirmation message, join the
   room, post a court update, raise and issue an invoice. `/admin/health` answers the three
   questions that matter — did money settle to the right account, is the queue moving, is anything
   arriving unverified.
8. **Tell every firm** what window was lost and what specifically to re-enter. Not "some data may
   have been affected": the dates, and which of their sittings `firm_sittings_due` is now asking
   about again.

### If the schema is what is wrong, not the data

The migrations are the schema's source of truth and rebuild it from empty. `scripts/db-test-local.sh`
does exactly that against a throwaway Postgres, and CI runs it on every push — so a clean rebuild is
proven continuously, not hoped for. That path recovers the *shape* of the database and none of its
contents.

---

## 4. The drill

An untested backup is a belief. Once a quarter, on a scratch Supabase project:

1. Restore the most recent backup into it.
2. Walk **case B** above end to end, with a stopwatch.
3. Try to open a real document from `document_versions` through a signed URL. This is the step that
   catches a Storage arrangement that was never actually in place — and it is the one loss Docket
   cannot recover from.
4. Replace the budgets in §2 with what you measured, and date them.
5. Confirm the three boxes at the top of this file are still ticked.

Record each drill: the date, who ran it, the measured times, and what was wrong this time.
