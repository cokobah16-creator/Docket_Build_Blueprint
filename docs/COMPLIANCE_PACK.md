# Compliance pack — personal data in Docket

*Reference material for the Nigeria Data Protection Act 2023 and the NDPC, for whoever answers a
data-subject request, reports a breach, or fills in a registration form.*

**This document states what the system does.** Every claim below points at a table, a policy, a
function or a file, and was read out of this repository rather than remembered. It draws no legal
conclusions and it is not advice: whether a given processing is lawful, which lawful basis applies,
and whether a firm or the platform is the controller for a given record are questions for the
firm's own data-protection counsel. Where the repository records an *intention* rather than an
implementation, it says so.

Two working assumptions, recorded in the blueprint (§14) rather than in code:

- **Each firm is the controller of its clients' data; Docket is the processor.** A standard DPA is
  signed at firm onboarding.
- **Docket itself is a controller for the accounts it holds** — `profiles`, `auth.users`,
  `platform_admins` — and for the operational records in §1.6.

The database enforces the separation the arrangement assumes: there is **no policy anywhere** that
lets one firm read another firm's rows, and **no policy at all** that lets a Docket platform admin
read matters, documents, messages, updates, invoices or notification payloads. That is enforced by
the absence of a policy, which is the strongest form the database has.

---

## 0. Facts to fill in before this pack is used

Three things this repository cannot tell you. Fill them in and date them.

| | |
|---|---|
| **Supabase region (where the data is processed)** | ______ . `README.md` step 1 and the blueprint (§14) record the *intended* region as **London or Frankfurt** — "no Nigerian region; cross-border transfer disclosed in the DPA and privacy notice". Nothing in the repository records the region a deployed project actually sits in. Read it from the Supabase dashboard and write it here |
| **Retention periods** | ______ . See §5 — **nothing is implemented.** The blueprint records an intention of "six years after closure, configurable per firm"; there is no column, no job and no screen |
| **NDPC registration status and data-subject counts** | ______ . See §7 |

---

## 1. What personal data Docket holds, and where

### 1.1 Accounts and identity

| Table | Personal data |
|---|---|
| `auth.users` | email, phone, identity records, sign-in timestamps. Managed by Supabase Auth |
| `profiles` | `full_name`, `phone` (unique), `email` (unique), `country`, `state`, `address`, `client_type`, `company_name`, `timezone`, `locale`, `preferred_channel`, `quiet_hours_start/end`. One row per person, created by a trigger on `auth.users` |
| `firm_members` | which firm a person works at and in what role |
| `lawyer_profiles` | `title`, `bio`, `photo_path`, `practice_areas`, `category`, and the practitioner identity fields: `scn` (Supreme Court enrolment number), `scn_verified_at`, `nba_stamp_serial`, `nba_stamp_year`, `practising_fee_year` |
| `platform_admins` | which accounts are Docket operators |
| `staff_invites`, `invites` | the email or phone an invitation was sent to, before there is an account |

Who can read a `profiles` row is `can_see_profile(id)`: yourself, a colleague at the same firm, or
somebody you share a matter or an appointment with. Nothing broader.

### 1.2 What a client tells the firm

| Table | Personal data |
|---|---|
| `intake_responses.answers` | **free text the client typed before their first consultation.** The questions are the firm's own (`intake_forms.schema`), so the content is whatever that firm asked for. `intake_forms.schema` has **no database validation at all** |
| `consultation_notes` | `client_summary`, `advice_given`, `follow_up` — the client can read these |
| `consultation_internal_notes` | `body` — a separate table precisely so that RLS can keep it from the client. There is no client policy on it |
| `messages` | `body` and `attachments` between client and firm |
| `consent_records` | see §2 |

### 1.3 The matter itself

| Table | Personal data |
|---|---|
| `matters` | `title`, `description`, `next_action`, `court_name`, `suit_number`, `judge`, `opposing_party`, cause title. A third party's name may appear here without that person ever using Docket |
| `matter_parties` | who is a party, in what role |
| `matter_lawyers`, `matter_counsel` | practitioners on both sides, with contact details for counsel |
| `matter_court_numbers` | suit numbers by court |
| `updates` | the timeline. `visibility = 'client'` or `'internal'`; `updates_client_select` allows only `visibility = 'client'` rows to a party |
| `court_events` | sittings, purposes, outcomes |
| `tasks` | internal |
| `matter_adverse_parties` | **the other side, by name and alias** — people who have never used Docket, recorded by the firm for conflict checking. Firm work product: no client policy |
| `conflict_checks` | what the firm searched for and what matched (names, and which matter each was found on), the lawyer's decision and its note. Staff who can see the matter read it; never edited or deleted through the API |
| `process_service` | `served_on_name`, `served_on_capacity`, `served_at_address`, `server_name`, the note and the proof |
| `documents`, `document_versions` | the filename, who uploaded it, size, mime, checksum, and the storage path |
| `document_requests` | what the firm asked the client for, why, and by when — `why` is free text a lawyer typed about the client's matter. The client reads their own requests; never deleted |
| `document_reads` | who opened which document version, when (migration 30). Staff who can see the matter read it; the client never does |

**Docket does not classify sensitivity and cannot.** `matter_type` includes `family`, `employment`,
`immigration`, `regulatory` and `debt_recovery`, and a matter's description, its documents and its
timeline may contain anything a legal file contains — health, allegations of crime, family
circumstances, finances. Treat every matter record as capable of holding sensitive personal data.

### 1.4 Money

| Table | Personal data |
|---|---|
| `invoices`, `invoice_items` | who is billed, for what, how much |
| `payments` | amount, currency, provider reference, and **`raw`** — the provider's own payload, which carries whatever Paystack returns about the transaction. Treat it as containing personal data |

### 1.5 Messaging and devices

| Table | Personal data |
|---|---|
| `notifications` | `user_id`, channel, event, and a `payload` carrying appointment references, invoice numbers and matter titles. **A platform admin cannot read this**: `platform_notification_health` groups and counts, and exposes neither the payload nor the recipient |
| `notification_preferences` | per event and channel |
| `push_subscriptions` | `endpoint`, `keys`, `user_agent` — a browser-identifying record |

### 1.6 Operational records

| Table | Personal data | Note |
|---|---|---|
| `audit_log` | `actor_id`, `action`, `entity`, `entity_id`, `meta` | **Append-only**: insert, update and delete are revoked from every API role; `audit()` is the only writer. **No address column**: there was one, never populated, and it was dropped (migration 24) rather than filled — Postgres cannot see a request's address, and a value a caller can forge has no place in a table people read as forensic |
| `consent_records` | see §2 | The `ip` and `user_agent` columns are likewise **never populated** — `recordConsent` in `app/app/(portal)/actions.ts` writes `user_id`, `firm_id`, `kind` and `version` only |
| `rate_limits` | For a signed-in caller the key **is** `auth.uid()`; for an anonymous one it is a SHA-256 digest of the client address, computed in `src/lib/rate-limit.ts` — **the address itself never reaches the database** | No RLS policy at all: only `rate_limit_hit()` touches it. Rows older than a day are swept opportunistically inside that function |
| `webhook_events` | provider, event type, provider reference, outcome, firm, invoice | Never the body of a verified event |
| `domain_requests` | `requested_by`, `decided_by` | |

### 1.7 Storage

Three buckets (migration 4). Object paths carry the tenant, and the storage policies parse them.

| Bucket | Public | Path | Holds |
|---|---|---|---|
| `documents` | no | `documents/{firm_id}/{document_id}/{version_id}.{ext}` | every matter and consultation document, at every version |
| `intake-uploads` | no | `intake-uploads/{firm_id}/{client_id}/{filename}` | what a client attaches when booking |
| `firm-assets` | **yes** | `firm-assets/{firm_id}/…` | firm logos and public images. **Anything placed here is world-readable** |

---

## 2. How consent is recorded

### The record

`consent_records`: `user_id`, `firm_id`, `kind` (`terms`, `privacy`, `engagement`, `recording`,
`marketing`), `version` (text), `accepted_at`.

- **Insert** requires `user_id = auth.uid()` — nobody can consent on somebody else's behalf.
- **Read** is `user_id = auth.uid() or is_firm_member(firm_id)` — the person, and the firm. Matter content (the matter, its documents and their bytes, updates, messages, tasks, court events, parties, counsel, process served, invoices) is further gated by `can_see_matter()` since migration 29: a matter a firm has restricted to its team is readable and writable only by that team — owners and admins included — and every definer function that takes a matter asks the same. Off by default; a firm switches it on.
- **There is no update policy and no delete policy.** In practice the table is append-only: a
  consent record cannot be altered or removed through the API.
- `ip` and `user_agent` columns exist and are **not populated** by the portal's consent action.

### The version chain

A firm's policy documents live in `firms.policies`, and **each document carries its own version**:
`policies.terms.version` and `policies.privacy.version`. The chain works like this:

1. `seed_firm_defaults()` gives every new firm a skeleton whose versions start `0-` — the reserved
   prefix for *unpublished*.
2. `firm_policies_published(firm)` is true only when both `terms` and `privacy` have a version that
   is non-empty and does not start `0-`.
3. `book_appointment()` calls it and refuses with
   *this firm has not published its terms and privacy notice yet*. **No client can be booked
   against unpublished drafts.**
4. At the portal, `app/app/(portal)/page.tsx` reads the firm's two versions and the client's
   `consent_records` rows and compares them **by exact string equality**. A missing or different
   version shows the consent gate and the client goes no further until they accept.
5. Accepting writes two rows — one `terms`, one `privacy` — each stamped with the exact version
   string in force at that moment.

**Changing a version string is therefore a deliberate act with a consequence**: every client of
that firm is asked to consent again at their next sign-in, and none of them can use the portal
until they do. The firm's settings screen says so before saving. `validate_policies()` caps a
version at 40 characters and strips angle brackets, and the admin surface refuses to publish a
version beginning `0-`.

### Consents Docket does not take

- **Recording.** `consent_kind` includes `recording`, and nothing writes it, because **consultations
  are never recorded**: `video-session` creates every Daily room without recording enabled, and
  there is no code path that turns it on.
- **Marketing.** The kind exists; nothing writes it.
- **Engagement.** The kind exists. `firms.policies` accepts an `engagement` document and the blueprint
  intends engagement terms to be accepted when a matter is opened; `open_matter()` does not write a
  consent row.

---

## 3. Who can see what — the technical measures

Stated as mechanisms, not as assurances.

- **Row-level security is on for every table in `public`** (migration 2 enables it in a loop), and
  every read and write in `app/` and `src/` runs as the signed-in person through `supabaseServer()`
  or `supabaseBrowser()`. The service role key is used only inside Supabase Edge Functions.
- **A second factor is required for every staff write.** `staff_w()` and `admin_w()` both require
  `mfa_ok()` — the JWT claim `aal = 'aal2'`. A staff member without TOTP can read and cannot write.
- **Internal notes cannot reach a client.** `consultation_internal_notes` has one policy, `staff_w`,
  and no client policy; `updates` with `visibility = 'internal'` are excluded from
  `updates_client_select`.
- **Documents are never public.** The `documents` bucket is private and every view is a **signed URL
  valid for 120 seconds**, minted by the browser as the signed-in person; the storage policy calls
  `can_access_document()`. A served firm reaches exactly the one **version** it was served, through
  `can_access_document_version()`, and nothing else on the matter.
- **Legal records are not hard-deleted through the app.** `documents` has no delete policy at all;
  `matters` and `documents` carry `deleted_at` and every read excludes soft-deleted rows.
- **Cross-tenant isolation is tested, not assumed.** Six suites in `supabase/tests/` exercise every
  read path from both sides of every wall, and CI runs them against a clean Postgres on every push.
- **Transport and browser policy.** A per-request Content-Security-Policy with a nonce
  (`src/lib/csp.ts`, applied in `middleware.ts`) and a `Permissions-Policy` that denies every
  browser capability Docket does not use (`next.config.mjs`).
- **Rate limiting** on slot browsing, booking, checkout, invitations, firm registration and
  unverified webhooks (`rate_limit_hit()`, migration 21). It does **not** cover Supabase Auth: the
  browser talks to GoTrue directly, so OTP and sign-in limits must be set in the Supabase dashboard
  — see `DEPLOYMENT_RUNBOOK.md` §0b.
- **Leaked-password protection is off until somebody turns it on.** Dashboard-only. Also §0b.

---

## 4. Who else the data goes to

Every outbound flow, and exactly what leaves.

| Recipient | What is sent | Where from |
|---|---|---|
| **Supabase** | everything — the database, Storage, and Auth | the whole platform |
| **Vercel** | HTTP requests and their logs; server-rendered pages | hosting |
| **Paystack** | the payer's **email address**, the amount, the currency, the invoice number, a description that is `Consultation <reference>` or `Invoice <number>`, and the firm's subaccount code. **No name, no matter, no line items** | `src/lib/providers/payments/paystack.ts` |
| **Daily** | a room named `appt-<appointment uuid>`, the participant's **user id and full name** (or "Lawyer"/"Client" where no name is on the profile). Rooms are private with knocking, expire an hour after the appointment ends, and **recording is never enabled** | `supabase/functions/video-session` |
| **Resend** | the recipient's email address, the subject, the message text and a link | `supabase/functions/dispatch-notifications` |
| **Termii** | Nigerian numbers (+234): the recipient's phone number and the message text, on the DND route | the same |
| **Twilio** | every other country code: the recipient's phone number and the message text | the same |
| **Web push** | the browser's push endpoint, plus a title, a body and a URL | the same |
| **Sentry** | error messages and stack traces, plus `where`, tags, extra context and a **user id** — a uuid, never a name, phone or email. Inert with no `SENTRY_DSN` | `src/lib/observability/sentry.ts` |
| **PostHog** | three funnel events today — a tenant site viewed, a booking started, a matter opened. Two more are named in the code and emitted by nothing: a payment is only trustworthy from the Paystack webhook, which runs in Deno and does not share this module, and attendance has no single moment that makes it true. | a distinct id that is either the account's uuid or the anonymous visitor cookie, and event properties. **Nothing identifies a person by name, phone or email.** Default host `https://eu.i.posthog.com`. Inert with no `POSTHOG_KEY` | `src/lib/observability/posthog.ts` |

The **message text** sent to Resend, Termii and Twilio is composed by the dispatcher and may name
the firm and carry a reference, an invoice number, an amount or a court date. A firm may override
the sentence per event through `firms.notification_templates`, so its content is partly that firm's
choice.

---

## 5. Retention — what is implemented

**Nothing is.** Stated plainly because a compliance pack that implies otherwise is worse than one
that says so:

- There is **no retention column** on `firms` or anywhere else.
- There is **no purge, expiry or anonymisation job.** The five scheduled jobs release booking holds,
  enqueue reminders, mark invoices overdue and build the sittings digest. None deletes anything.
- `matters` and `documents` carry `deleted_at`, every read honours it, and **nothing in `app/` or
  `src/` ever sets it**. Soft deletion exists in the schema and has no user interface.
- Three things do expire on their own: `invites` and `staff_invites` (`expires_at`, default 14
  days — the rows remain, they stop working), a booking hold (15 minutes, released by
  `release_expired_holds()`), and `rate_limits` rows (swept after a day inside `rate_limit_hit()`).

The blueprint (§14) records the intended policy — *"retention configurable per firm (default six
years after closure) with soft deletion and an authorised destruction workflow"*. Until it is
built, retention is a manual process: decide the periods, write them into each firm's privacy
notice and DPA, and record here who executes them and how.

---

## 6. Data-subject requests — the runbook

Establish first **who the controller is** for the records requested. A request about a client's
matter is a request to the firm; Docket acts on the firm's instruction. A request about a Docket
account is Docket's own.

Every query below runs with the service role or in the SQL editor. Start from the person's
`profiles.id`:

```sql
select id, full_name, email, phone from profiles
where lower(email) = lower('…') or phone = '+234…';
```

### 6a. Access / portability — what to export

Run as that `:user`, and keep the output with the request.

| Kind | Query |
|---|---|
| Account | `select * from profiles where id = :user;` |
| Memberships | `select * from firm_members where user_id = :user;` `select * from lawyer_profiles where user_id = :user;` |
| Consultations | `select * from appointments where client_id = :user or lawyer_id = :user;` |
| Consultation notes | `select cn.* from consultation_notes cn join appointments a on a.id = cn.appointment_id where a.client_id = :user;` — **note: `consultation_internal_notes` is the firm's own work product and is a separate decision, not an automatic inclusion** |
| Intake answers | `select * from intake_responses where client_id = :user;` |
| Matters | `select m.* from matters m join matter_parties mp on mp.matter_id = m.id where mp.user_id = :user;` |
| Timeline | `select u.* from updates u join matter_parties mp on mp.matter_id = u.matter_id where mp.user_id = :user and u.visibility = 'client';` |
| Court dates | `select ce.* from court_events ce join matter_parties mp on mp.matter_id = ce.matter_id where mp.user_id = :user;` |
| Messages | `select * from messages where sender_id = :user;` plus messages on their matters and appointments |
| Documents | `select d.*, dv.storage_path, dv.checksum from documents d left join document_versions dv on dv.document_id = d.id where d.uploaded_by = :user or d.matter_id in (select matter_id from matter_parties where user_id = :user);` — then export the **objects** from the `documents` bucket at each `storage_path` |
| Booking uploads | list `intake-uploads/{firm_id}/{user_id}/` in Storage |
| Money | `select * from invoices where client_id = :user;` `select ii.* from invoice_items ii join invoices i on i.id = ii.invoice_id where i.client_id = :user;` `select p.* from payments p join invoices i on i.id = p.invoice_id where i.client_id = :user;` |
| Messaging | `select * from notifications where user_id = :user;` `select * from notification_preferences where user_id = :user;` `select * from push_subscriptions where user_id = :user;` |
| Consent | `select * from consent_records where user_id = :user order by accepted_at;` |
| Invitations | `select * from invites where accepted_by = :user;` `select * from staff_invites where accepted_by = :user;` |
| Activity | `select * from audit_log where actor_id = :user order by at;` |

A client can already see most of this for themselves: `/app` shows their matters, timeline,
documents, invoices and messages, and `/app/profile` lists their **fifty most recent** consent
records — the query is capped there (`app/app/(portal)/profile/page.tsx`), so a long-standing client
of several firms may hold more than that page shows. Point them there first for the everyday case;
for a subject-access request, the `consent_records` query above is the complete set and the page is not.

### 6b. Rectification

`profiles` is writable by its owner (`profiles_update` is `id = auth.uid()`), so a person corrects
their own **name, email address, timezone, preferred channel and quiet hours** at `/app/profile`
without anyone's help — those are the fields `updateProfile()` accepts (`src/lib/actions/portal.ts`),
and they are the only ones. `profiles` also carries `address`, `country`, `state`, `client_type`
and `company_name`, and the console's client list reads them — but **nothing writes them**:
`updateProfile()` does not accept them, and no staff member can update another person's profile at
all, because `profiles_update` is `id = auth.uid()` and there is no RPC that does it for them. So
today those columns are empty for every person and there is nothing to rectify in them; the day a
screen starts filling them in, it must be a screen the person can correct them on too, because the
policy already gives them that right and a field a person cannot see is one they cannot dispute.
The phone number is the sign-in identity and changes by re-verifying a new number, not by editing
a field. Anything else a person asks to correct — an address on a matter, a name on an invoice —
is matter content, which is the firm's record: correcting it is the firm's act, and every change to
`matters` is written to `audit_log` by `audit_row_change()`.

### 6c. Erasure — what actually happens, including what blocks it

**Deleting `auth.users` cascades to `profiles`, and `profiles` cascades onward:** `firm_members`,
`lawyer_profiles`, `intake_responses`, `matter_parties`, `notifications`,
`notification_preferences`, `push_subscriptions` and `consent_records` all carry
`on delete cascade`.

**But two foreign keys have no cascade and will block the delete outright:**

- `appointments.client_id uuid not null references profiles` — no `on delete` clause, so
  `NO ACTION`;
- `invoices.client_id uuid not null references profiles` — the same.

So **a person who has ever booked a consultation or been invoiced cannot have their account
deleted** by deleting the row: Postgres raises a foreign-key violation. This is not an oversight to
work around — an appointment and an invoice are the firm's own records of a transaction, and the
firm's retention duty attaches to them. Erasure of such an account is therefore a decision, not a
command, and the options are:

1. **Refuse the deletion for those records** and say which ones and why.
2. **Redact rather than delete**: null or replace `full_name`, `phone`, `email`, `address` and
   `company_name` on `profiles`, leaving the id and the transaction rows intact. Nothing in the
   schema forbids this. `profiles.phone` and `profiles.email` are `unique`, so redact to null
   rather than to a shared placeholder.
3. **Delete only what cascades cleanly**, having first exported it under 6a.

Whichever is chosen, these do **not** go away on their own and must be handled deliberately:

- `audit_log.actor_id` — an unconstrained uuid column. Rows survive and the log is append-only by
  design; it cannot be edited through the API at all.
- `messages.sender_id`, `updates.posted_by`, `documents.uploaded_by`,
  `document_versions.uploaded_by` — `references profiles` with no cascade, so the delete would be
  blocked by these too where rows exist.
- **Storage objects.** Deleting a `documents` or `document_versions` row does not delete the file.
  Remove the object from the bucket separately, at the `storage_path`.
- `matters`, `updates` and `messages` may name the person in **free text** that no foreign key
  reaches. Only a human reading the file can find those.

Record every erasure decision with its reasons. Do it under the firm's instruction where the
records are the firm's.

### 6d. Objection to messaging

Not a deletion. `/app/notifications/preferences` writes `notification_preferences`, which
`enqueue_notification()` consults before it queues anything — an event and channel switched off is
never enqueued at all. `profiles.quiet_hours_start/end` defers push, SMS and email until quiet
hours end (in-app and the 10-minute reminder are never deferred). Removing every row from
`push_subscriptions` ends push for that person's devices.

---

## 7. Breach response — the runbook

*Timelines under the NDPA and the NDPC's guidance are not stated here; confirm the current
notification window and thresholds with counsel and put them in the box below before an incident,
not during one.*

**Notification window to the NDPC: ______ . To data subjects: ______ . Confirmed with ______ on ______ .**

### Hour one — contain

1. **Suspend the affected firm** if the exposure is at one firm:
   `select set_firm_status('<firm>', 'suspended', 'incident <ref>');` — `staff_w()` and `admin_w()`
   both consult `firm_not_suspended()`, so **every write at that firm stops at once** while reads
   keep working and nothing is destroyed.
2. **Revoke the credential** if one leaked. The service role key and the anon key are rotated in
   the Supabase dashboard; a rotation invalidates existing sessions. `PAYSTACK_SECRET_KEY`,
   `DAILY_API_KEY` and `CRON_SECRET` are rotated at the provider and reset with
   `supabase secrets set` — and `CRON_SECRET` must be changed in **Vault** in the same breath
   (`RESTORE_RUNBOOK.md` §1.4) or the dispatcher stops silently.
3. **Do not restore, delete or "clean up" anything yet.** Preserve the evidence.

### Hours one to four — establish the facts

| Question | Where the answer is |
|---|---|
| What was done, by whom, when | `audit_log` — append-only, so it cannot have been tampered with through the API: `select * from audit_log where firm_id = '<firm>' and at > '<t>' order by at;` |
| Which account | `audit_log.actor_id` → `profiles`. A null actor means the database itself — a scheduled job or a provider webhook |
| Did money go somewhere wrong | `platform_settlement_health`, and `/admin/health`. A mis-settled charge is recorded as a **failed** payment carrying `settlement_mismatch`, `reported_subaccount` and `expected_subaccount`, and audited as `payment.settlement_mismatch` |
| Did anything arrive unverified | `webhook_events` — `signature_ok` and `outcome`, with `outcome <> 'processed'` indexed |
| Were messages sent | `notifications` (status, event, channel, `sent_at`) — and remember the **payload is personal data**, so a queue export is itself a disclosure |
| Were documents read | `document_reads` (migration 30): one row per open — who, which version, when — and a `document.opened` line in `audit_log`. **The record is the door, not a courtesy log**: the Storage read policy requires a read recorded by the caller within the last five minutes before it will mint a signed URL, so no bytes leave without one. Staff who can see the matter see the record; a client never does. Storage's own access logs remain the second source |
| Was the schema itself changed | `supabase/migrations/` in git, against the live schema |

### Then — assess and notify

1. **Scope it by table**, using §1: which tables, which rows, whose data, and whether matter content
   (which may be sensitive) was among it.
2. **Name the controller for each affected set.** A firm's client data is that firm's; tell the firm
   without delay, with specifics, so it can meet its own duty.
3. **Notify the NDPC** within the window recorded above, if the threshold is met.
4. **Notify data subjects** where required — through the firm, whose relationship it is.
5. **Write it up** in `audit_log` so the record lives with the data:

   ```sql
   select audit('platform.incident', 'platform', null, '<firm or null>',
                jsonb_build_object('ref', '…', 'discovered_at', '…', 'contained_at', '…',
                                   'tables', array['…'], 'notified_ndpc_at', '…'));
   ```

6. **Lift the suspension** only once containment is proved: `set_firm_status(firm, 'active', …)`.

### Standing gaps to state in any incident report

- **Document reads are logged by Docket** since migration 30, as above; the app-layer fetch cannot skip the record because the Storage policy refuses a read without one.
- **`consent_records.ip`/`user_agent` are never populated** (and `audit_log` no longer has an address column), so no request can be
  traced to an address from within the database.
- **`audit_row_change()` does not cover every table.** `/firm/admin/audit` names its own coverage at
  the foot of the page; read that before concluding from a silence in the log.

---

## 8. NDPC registration checklist

*A working checklist, not a determination that registration is required. Whether a given
organisation must register, and in which class, follows from the NDPA and the NDPC's current
guidance applied to that organisation's numbers — get that confirmed.*

- [ ] **Decide the controller structure** and write it down: each firm as controller of its clients'
      data, Docket as processor; Docket as controller of accounts and the operational records in
      §1.6. Blueprint §14 records this as the intention; confirm it and reflect it in the DPA.
- [ ] **Count data subjects processed in the last twelve months.** From the live database:
      `select count(*) from profiles;` — and separately, per firm:
      `select firm_id, count(distinct user_id) from matter_parties group by firm_id;` and
      `select firm_id, count(distinct client_id) from appointments group by firm_id;`.
      Compare against the NDPC's current thresholds.
- [ ] **Establish whether a Data Protection Officer is required**, and if so appoint one and record
      the name and contact here: ______ .
- [ ] **Confirm whether registration as a data controller or processor of major importance applies**,
      and complete it if so. Record the registration number and date: ______ .
- [ ] **Record the processing**, using §1 as the inventory of categories and §4 as the inventory of
      recipients.
- [ ] **Record the transfer.** The data is processed outside Nigeria (§0). Establish the basis, and
      disclose it in every firm's privacy notice and DPA — blueprint §14 records this as the
      intention.
- [ ] **Sign a DPA with every firm** at onboarding, and record which firms have signed:
      `select slug, name, status, verified_at from firm_admin order by created_at;` as the list to
      tick against.
- [ ] **Check each firm has published real policies**, because a client cannot consent to a draft
      and cannot book without one: `select slug, name, policies_published from firm_admin where not policies_published;`
      returns the firms that have not.
- [ ] **Fix and document the retention periods** (§5) — and note that nothing enforces them yet.
- [ ] **Complete the data-subject request runbook** (§6) with who executes it and the response time
      committed to.
- [ ] **Complete the breach runbook** (§7) with the confirmed notification windows.
- [ ] **Turn on leaked-password protection and auth rate limits**
      (`DEPLOYMENT_RUNBOOK.md` §0b) — neither is on by default.
- [ ] **Turn on point-in-time recovery and settle the Storage backup arrangement**
      (`RESTORE_RUNBOOK.md`) — availability is a protection obligation, and a document that cannot
      be restored is a document that has been lost.
- [ ] **Run the restore drill** and record the measured recovery time.
- [ ] **Have a Nigerian data-protection practitioner review the implementation and the policies
      before launch.** Blueprint §14 is explicit that compliance *features* are not compliance;
      nothing in this pack changes that.

---

## Related

- `docs/RPC_REFERENCE.md` — every function, who may call it, what it refuses.
- `docs/RESTORE_RUNBOOK.md` — what a backup covers and what it does not.
- `docs/DEPLOYMENT_RUNBOOK.md` — the two dashboard settings that are off by default.
- `docs/CLIENT_GUIDE.md` — what a client can and cannot see, in their own words.
- `Docket_Build_Blueprint_v0.2.md` §14 — the compliance intentions this pack measures against.
