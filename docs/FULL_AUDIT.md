# Docket — full-scale audit

September 2026 · branch `claude/docket-product-uiux-transformation-q11r7i` · read-only review

Six parallel reviews covered security and authorization, backend logic and data, frontend and
performance, accessibility and UX consistency, privacy and product claims, and testing, CI and
operations. Every **Critical** and **High** finding below was checked again against the code
before being written here. Findings marked *(reproduced)* were exploited in a throwaway Postgres 16
built from the 52 migrations. Findings marked *needs verification* depend on live configuration
this review could not see.

`docs/UX_AUDIT.md` covers the earlier design pass and is not repeated here.

---

## 1. Verdict

The database layer is unusually strong for a product at this stage:

- RLS is enabled on every table.
- All 192 SECURITY DEFINER functions pin `search_path`.
- Invoices and payments are written only through RPCs.
- The Paystack webhook uses a constant-time HMAC check and verifies the charge server-side.
- Bookings cannot overlap, because an exclusion constraint prevents it.
- 31 SQL suites with 1,416 checks gate every merge.

The weaknesses sit **at the edges of that core**:

- server actions that act before they authorize;
- identity fields that users can edit themselves;
- write policies that let a firm attach any person to a matter;
- money paths that do not handle the unhappy cases;
- notification and analytics payloads that carry confidential matter detail;
- missing platform-level legal documents.

None of these needs a redesign. Most are a few lines of SQL or TypeScript each.

**Launch blockers** are the 1 Critical and 13 High findings. They should be fixed before a second
real firm or any real client data goes onto the platform.

| Severity | Count |
| --- | --- |
| Critical | 1 |
| High | 13 |
| Medium | 24 |
| Low | 25+ |

---

## 2. Critical and High findings

### C1. The Vercel domain action runs before any authorization check (Critical, security)

`app/admin/actions.ts:237-294`: `setFirmDomain` calls `addDomain(domain)`
(`src/lib/providers/domains/vercel.ts`). That adds the hostname to the **production Vercel project
using the platform `VERCEL_TOKEN`**. The action has no `getUser()` or platform-admin check first.
The later `set_firm_domain` RPC refuses a non-admin, but by then the domain has already been added.

Server actions are public HTTP endpoints. Their IDs ship in client bundles.

**Impact**
- Anyone can attach an arbitrary hostname to production and get a TLS certificate for it.
- That makes a convincing phishing origin for staff sign-in.
- Repeated calls can exhaust the project's domain quota.

`startDomainRequest` and `completeDomainRequest` have the same ordering problem for firm members.

**Fix:** at the top of every action in `app/admin/actions.ts`, call an RPC that asserts
`is_platform_admin() and mfa_ok()`. Do this before any provider call.

### H1. Any signed-up user can attach any person to a matter and read their contact details (security, reproduced)

**How the attack works**
1. `create_firm` lets any authenticated user create a firm in `pending` status.
2. A pending firm can write, because `staff_w` checks only "not suspended".
3. `matter_parties_write_ins` (`…029_matter_walls.sql:233`), `appointments_staff_write_ins`, `open_matter(p_client)` and `create_invoice(p_client)` all accept **any existing profile id**.
4. `can_see_profile` then grants that firm's members the victim's email, phone and address.

`lawyer_public.id` exposes every public lawyer's user id, so victims are easy to find. The victim
then sees the attacker's matter and invoices in their own portal, which is a ready-made phishing
channel.

**Fix**
- Revoke direct INSERT on `matter_parties` and `appointments`.
- Bind a person to a firm only through `accept_invite` or `book_appointment`.
- In `open_matter` and `create_invoice`, require an existing relationship with the firm.
- Block writes that involve people outside the firm while the firm is `pending`.

### H2. `profiles.email` and `profiles.phone` are editable by the user and trusted for identity (security, reproduced)

`profiles_update` (`…021_hardening.sql:134`) lets a user set any column on their own row, and
nothing verifies it. Two RPCs look people up by that column:

- `add_registry_member` (`…049:188`)
- `create_firm(p_owner_email)` (`…015:44`)

The unique index is case-sensitive, so `Registrar@court.gov.ng` can sit alongside
`registrar@court.gov.ng`. The team already fixed this pattern for delegation (`…044:438-446`
checks `auth.users`); these two RPCs were missed.

**Impact**
- A platform admin adding a registrar or firm owner by email can grant the role to an impostor.
- Notifications can be pointed at third parties.
- A person's future sign-up can be blocked by squatting their email or phone.

**Fix**
- Resolve users in `auth.users` (verified email) in both RPCs.
- Make `email` and `phone` non-updatable by `authenticated`, and sync them from `auth.users` by trigger.
- Use a `lower(email)` unique index.

### H3. Open redirect after sign-in (security, verified)

`safeNext` (`src/lib/auth-redirect.ts:48-57`) blocks `//` and `/\` but not tab or newline.
`searchParams.get` decodes `%09`, and the WHATWG URL parser strips tabs, so
`new URL("/\t/evil.example", origin)` resolves to `https://evil.example/`.

- **Where it fires:** `app/auth/callback/route.ts:38,76`, the login pages and the MFA page.
- **Proof of concept:** `/auth/callback?next=/%09/evil.example`, followed from a sign-in or password-reset email.
- **Fix:** resolve with `new URL(raw, origin)`, require the same origin, and reject control characters. Add a table-driven unit test.

### H4. A client can read the whole `matters` row, and every party reads every matter message (privacy and security)

`matters_select` (`…029:124`) gives parties every column: `description`, `next_action`,
`opposing_party`, `judge`, `search_doc`, `access` and more. There are no column grants.

`messages_select` (`…029:195`) has no internal flag and covers every `party_role`. That means an
external co-counsel or contact reads every privileged client–firm message.

The portal no longer requests these fields (this branch), but the API still returns them to
anyone who asks.

**Fix**
- Add a column-restricted `client_matters` view or definer RPC, and remove the party arm from the base table's policy.
- Scope messages per party, or add a visibility column.
- Update `portal-data.ts` and suites 10 and 95.

### H5. Reference numbers collide across firms (backend, verified)

`appointments.reference`, `matters.reference` and `invoices.number` are unique **platform-wide**
(`…001_schema.sql:155,230,351`). But `firms.reference_prefix` is not unique. It is derived from
the firm's initials and falls back to `DK` (`…015:63-67`).

**Impact:** a second firm whose initials match an existing firm's hits a 23505 duplicate-key error
on its first booking, matter or invoice.

**Fix:**
- Add `unique(reference_prefix)`, checked at creation with a suggested alternative. Alternatively, make the unique keys `(firm_id, reference)`.
- Include the firm in `record_payment`'s invoice lookup.

### H6. Payment for a cancelled or expired booking is taken and not handled (backend)

**What happens**
- A booking hold expires after 15 minutes, and `release_expired_holds` cancels the appointment and its invoice.
- `startCheckout` (`src/lib/actions/booking.ts:140-151`) does not refuse a cancelled or expired booking.
- Bank-transfer and USSD payments often settle after the 15 minutes.
- `record_payment` then marks the cancelled invoice paid. The appointment stays cancelled, and its slot may already have been rebooked.
- The client is told the payment was received. The firm is told nothing.

**Fix**
- Refuse checkout for a cancelled appointment, or one whose hold has expired.
- In `record_payment`, detect a payment to a cancelled invoice or appointment and record it as `needs_refund`.
- Notify the firm.

### H7. Double charges and overpayment go unnoticed (backend)

- Every checkout creates a new Paystack reference (`paystack.ts:19`), so two tabs or a double click produce two successful charges.
- `record_payment` adds to `paid_minor` without comparing it against `total_minor`.

**Fix:** reuse one open reference per invoice, and flag `paid_minor > total_minor`.

### H8. A charge can be lost when Paystack's verify call fails (backend, verified)

`paystack-webhook/index.ts:157-166` returns **200** whenever `/transaction/verify` fails, including
network errors, 5xx and 429. Paystack therefore never retries. A currency mismatch is also
acknowledged and rolled back. No reconciliation job exists.

**Fix**
- Return 5xx on transient verify failures.
- Add a scheduled job that re-verifies `webhook_events` rows with outcome `error`.
- Add a daily comparison against Paystack's transaction list.

### H9. Any staff member can hard-delete a matter and its whole history (backend, verified)

`matters_write_del` (`…029:135`) allows DELETE for any `staff_w` member. The delete cascades to
updates, court events, documents and versions, messages, deadlines and parties. The storage objects
are left orphaned.

Nothing sets `deleted_at`. `COMPLIANCE_PACK.md:212` says "Legal records are not hard-deleted
through the app", and that is not true at the API level.

**Fix**
- Revoke DELETE on `matters`, `appointments`, `updates` and `court_events`.
- Add an audited `retire_matter` RPC that sets `deleted_at`.
- Make every reader honour `deleted_at`.

### H10. Cancelling a reason prompt still carries out the destructive action (UX and safety, verified)

`window.prompt(...) ?? ""` turns Cancel into an empty reason, and the server accepts it. This
happens at five sites:

- revoke an API key (`partner-api-panel.tsx:58`)
- end a collaboration (`collaboration-panel.tsx:88`)
- decline a collaboration (`collaboration-inbox.tsx:43`)
- end a collaboration (`collaboration-inbox.tsx:53`)
- revoke a representation (`representations-panel.tsx:90`)

**Fix:** return when the prompt comes back `null`. Better, replace these with `Modal` and a required reason field. The registry controls already get this right.

### H11. Confidential matter content is sent in SMS, email and lock-screen push (privacy and privilege, verified)

`dispatch-notifications/index.ts:150-165` puts the following into message bodies:

- update titles
- court names and purposes
- requested document titles
- the names of documents to sign
- for staff: case titles and suit numbers

That content goes to Termii, Twilio and Resend. It also shows on shared or seized handsets, because
push payloads carry the same text.

**Fix:** default to content-free text ("You have an update from {firm}. Open the app."). Make detail opt-in per client or per firm.
**[Counsel review]**

### H12. The platform has no privacy notice, terms or DPA, and the sign-up clickwrap points at a document that does not exist (privacy)

`firm-start.tsx:157-162` says "By continuing you accept the Docket firm terms", but those terms do
not exist and acceptance is not recorded. Also missing:

- a platform privacy notice for accounts, analytics and the visitor cookie, where Docket is the controller;
- a cookie notice;
- the DPA that `COMPLIANCE_PACK.md` assumes is signed at onboarding.

**Fix:** publish all of these, link them from the landing page, sign-in and sign-up, and record which version each firm accepted.
**[Counsel]**

### H13. A tracking cookie and person-level analytics run without consent (privacy)

The middleware sets `docket_did` (httpOnly, one year) on every route, including `/app`, `/firm` and
`/api`. There is no notice or consent mechanism.

PostHog events are keyed to the user's UUID after `$identify`, and they include:

- `matter_opened` with the **matter type** (for example family or immigration), keyed to the client (`matters.ts:133-139`);
- `booking_started` with the service and the amount.

Together these reveal a lawyer–client relationship to a third party.

**Fix**
- Gate the cookie and these events behind consent, or document a legitimate-interest assessment.
- Drop `matter_type` and `service_id` from person-keyed events.
- Don't set the cookie on authenticated surfaces.

**[Counsel]**

---

## 3. Medium findings

### Security

- **M-S1 · Cross-tenant file read through the text extractor.**
  - Clients and staff may insert `document_versions` rows with any `storage_path` (`…021:76`, `portal.ts:152`).
  - `extract-text` then downloads that path using the service role and writes the text back into a row the attacker can read.
  - Separately, real upload paths carry no bucket prefix, so extraction probably fails for every upload (needs verification).
  - **Fix:** enforce the path shape with a trigger, stop accepting a client-supplied `id`, and hard-code the bucket.
- **M-S2 · Two-factor protects writes only.** A password-only (aal1) staff or platform-admin session can read every matter, message and document through PostgREST. **Fix:** add `mfa_ok()` to the staff and platform read helpers.
- **M-S3 · The `documents` bucket read policy lost its `try_uuid` guard in migration 030.** A malformed object name can make listings error. That is an availability risk.
- **M-S4 · Blind SSRF from partner webhooks.** The endpoint only has to match `^https://`. `fetch` follows redirects and the status code is shown to the admin. **Fix:** block private address ranges and set `redirect: 'manual'`.
- **M-S5 · Staff can write appointments directly** (`…021:155-161`): status, fee, client and time, bypassing the booking and payment RPCs. Migration 42 closed the same hole for invoices.
- **M-S6 · The Partner API returns titles and suit numbers of walled matters** (documented in `PARTNER_API.md:81-84`). Collaboration proposals also reveal the case title to the other firm before it accepts or runs a conflict check.

### Backend and data

- **M-B1 · Court reminders fire late.**
  - The daily job runs at 08:00 Lagos time and compares raw intervals.
  - For a 09:00 sitting, the "day before" reminder arrives about an hour before the sitting, and the "3 days" reminder arrives 2 days out.
  - **Fix:** compare Lagos calendar dates.
- **M-B2 · Holiday and vacation data is incomplete.**
  - Only 2026–27 is covered, with no Eid or Maulud dates, no observed-day shifts and no court vacations.
  - Deadlines are never re-flagged when a holiday is gazetted later.
  - `proposed` deadlines never produce a reminder.
- **M-B3 · Suit-number matching is too weak.**
  - Normalisation only uppercases and strips whitespace, so `FHC/L/CS/0123/2024`, `FHC/L/CS/123/24` and `FHC-L-CS-123-2024` never match.
  - The per-row RLS predicate has no index.
- **M-B4 · Expensive views and missing indexes.**
  - `firm_threads` does a DISTINCT ON over every message with a correlated count per row, and `firm_overview` evaluates it twice.
  - Missing indexes: `messages(firm_id, matter_id, appointment_id, created_at desc)`, `updates(firm_id, occurred_at desc)`, `appointments(status, starts_at)` (used by minute-level cron jobs) and `payments(paid_at)`.
- **M-B5 · Notification dispatch.**
  - No provider timeouts.
  - A run that dies mid-batch re-sends after 10 minutes, with no idempotency key.
  - No failover from Termii to Twilio.
  - Time-sensitive reminders have no expiry.
  - Nobody is alerted to failures.
  - The seven-day sittings digest goes out by SMS every day.
- **M-B6 · Audit gaps.**
  - Not audited: `matter_lawyers` (which controls access to walled matters), message inserts, consultation note contents, `intake_responses`, adverse parties and profiles.
  - Reads of internal notes and search queries are not logged.
  - Free-text column values are copied into the append-only `audit_log`, which has no retention.
- **M-B7 · Retention and data-subject rights are not implemented.**
  - There is no export, erasure or redaction RPC.
  - No job deletes anything.
  - Several foreign keys block erasure.
  - `COMPLIANCE_PACK.md` says so honestly.
- **M-B8 · No refunds or credit notes.** The `refunded` status is never written, and Paystack refund and dispute events are ignored.

### Frontend and performance

- **M-F1 · Four auth round-trips and about nine queries run before every console page.**
  - The middleware calls `getUser()`; the layout calls `getUser()` again and then `staffContext()`; each page calls `staffContext()` again.
  - `React.cache()` is used nowhere.
  - The portal does the same with `clientFirms()`, whose firm-id scans are unbounded.
  - **Fix:** wrap the context helpers in `cache()`, verify the JWT locally with `getClaims()`, and skip prefetch requests in middleware.
- **M-F2 · Query errors are treated as empty results.**
  - About 220 `(data ?? [])` reads, and most pages never read `error`.
  - During an outage a lawyer sees "No upcoming court dates" or "No invoices yet". In a legal product that is dangerous.
  - The shared `firm-data.ts` helpers swallow errors too.
  - **Fix:** return errors from the helpers and show the `Alert` pattern that the Tasks and Messages pages already use.
- **M-F3 · Silent truncation.**
  - The Clients page runs five 1,000-row scans, three of them unordered, then aggregates in JavaScript.
  - The Reports fee scan asks for 5,000 rows. If PostgREST's row limit is the Supabase default of 1,000, the "capped" note can never show while fees are under-reported (*needs verification* of the project's max rows).
  - The awaiting and unread message views filter only the latest 100 threads.
  - `.range()` pagination is used nowhere.
- **M-F4 · There is only a root error boundary.** Any error inside the console or portal unmounts the whole shell. **Fix:** add `error.tsx` files under `firm/(console)`, `app/(portal)`, `admin`, `registry` and `(public)/[firm]`.
- **M-F5 · Waterfalls.**
  - Messages page: 7 sequential round-trips.
  - Matter page: 4 or more.
  - Invoices, tasks and the portal appointment page have independent reads that could be combined in one `Promise.all`.
- **M-F6 · Saved offline pages survive sign-out** (verified). `public/sw.js` says the saved copy is deleted at sign-out, but `signOut` never clears it. On a shared phone, private matter pages stay readable offline. **Fix:** send `Clear-Site-Data: "cache"` on sign-out.
- **M-F7 · The generated database types are stale and unused.**
  - `database.types.ts` is missing 45 of 79 tables, and no Supabase client is typed with it.
  - About 280 casts cover the gap, so column and RPC-argument drift is never caught at compile time.

### Accessibility and UX

- **M-A1 · Seven destructive actions have no confirmation.** Remove adverse party, discard import batch, retire template, withdraw domain request, remove rule provision, a client's Cancel appointment, and Sign out everywhere.
- **M-A2 · Staff pages still render raw database errors and unsanitised `?error=` text.**
  - About 118 server-action sites return `error.message`, and 81 client sites render it.
  - Four client-facing sites remain: the accept-authority form, the check-in card, the documents tab, and the booking wizard.
  - `?error=` is rendered from the URL on `sittings`, `invoices/[id]`, `matters/[id]` and `admin/health`.
- **M-A3 · Form accessibility.**
  - Six controls are labelled only by a placeholder, including the client's message composer (`messages-thread.tsx:211`).
  - None of the 360 raw controls has `aria-invalid` or `aria-describedby`.
  - Six inputs remove the focus outline and show only a 1px border change.
  - The profile's name and email fields have no `autocomplete`.
- **M-A4 · The firm switcher sheet** (`firm-switcher.tsx`) has no focus trap and does not return focus. It should use `useDialogBehaviour`.
- **M-A5 · Hard-coded colours.**
  - 240 hex colours across 49 files, and 306 default-palette classes across 55 files.
  - In the portal, which follows dark mode, they break contrast: `documents-tab.tsx:226-296`, `payment-result.tsx:68`, `update-structure.tsx`, `before-card.tsx`.
- **M-A6 · Inconsistent names and titles.**
  - Six nav labels don't match their page titles: Court diary / Sittings, Billing / Invoices, Firm settings / Firm administration, and three more.
  - Page titles are built four different ways.
  - Admin pages have two `<h1>` elements, or none.
- **M-A7 · Nine record lists are still card lists:** clients, invoices, appointments, messages, inbox, sittings, collaborations, admin people and uploads.

### Privacy and claims

- **M-P1 · Weak consent capture.**
  - Terms and privacy are bundled in one mandatory click.
  - A firm that publishes its policies as page text shows no link at the gate.
  - IP and user agent are never recorded, and consent cannot be withdrawn.
  - **Booking collects intake answers and uploads before any privacy notice is shown.**
- **M-P2 · The booking button quotes the price before VAT, but the client is charged price plus VAT** (verified at `booking-wizard.tsx:580` and `…035:464`). The fee copy this branch added to the firm homepage has been corrected. The wizard itself still needs to show subtotal, VAT and total.
- **M-P3 · Hosting regions are not pinned.**
  - `vercel.json` has no `regions`.
  - The Supabase region is only an intention (London or Frankfurt).
  - Google Fonts, Daily, Resend and Twilio are not in the recipients table, and cross-border transfer is undocumented.
- **M-P4 · Personal data can reach Sentry.** `/api/report` needs no sign-in and forwards browser error text, and some database error messages embed user input.
- **M-P5 · Invoices are thin.**
  - No TIN or VAT number, and no VAT rate on the PDF.
  - A paid invoice is relabelled "RECEIPT" and given no receipt number.
  - The PDF refuses ₦ and Yoruba characters.
  - `vat_rate` defaults to 0.
- **M-P6 · Firm verification is manual and unrecorded.** `set_firm_status('active')` stamps `verified_at` without any stored evidence.

### Operations

- **M-O1 · Server-action failures are not logged.** Only the portal and booking actions report to Sentry. There is no `instrumentation.ts` or `onRequestError`, and the Edge Functions only use `console.error`.
- **M-O2 · Nothing in CI lints or scans.** No ESLint, no `npm audit`, no Dependabot, no CodeQL and no secret scanning. Actions are pinned by tag, not SHA.
- **M-O3 · CI runs on Node 20, which reached end of life in April 2026.** There is no `engines` field and no `.nvmrc`.
- **M-O4 · Browser tests don't gate merges.**
  - e2e runs only when secrets are set.
  - The 7 integration journeys have never run.
  - None of the `tests/fixtures` checks runs in CI.
- **M-O5 · There are no unit tests for `src/lib`,** including money, dates and timezones, CSV (which also allows formula injection), `safeNotice`, brand contrast and the CSP builder.
- **M-O6 · Runbooks are out of date.** `RESTORE_RUNBOOK.md` lists 3 Edge Functions, 6 cron jobs and 2 Vault secrets. The real numbers are 9, 10 and 5. The HTTP cron jobs quietly do nothing without their secrets, so a restore done by the book silently loses partner webhooks, text extraction and the storage manifest. `.env.example` is missing three webhook secrets.
- **M-O7 · Preview and production are not separated.** No staging Supabase project exists, and migrations are applied by hand after Vercel has deployed. That is how migrations 34–49 drifted once already.
- **M-O8 · Monitoring is thin.** `live-schema-drift` fails every day until a secret is set. Nothing watches `cron.job_run_details`, and there are no alert rules.

---

## 4. Low findings (abbreviated)

- **Security**
  - `rate_limit_hit` can be called by `anon` with keys it chooses, so anyone can poison or bloat the limits.
  - The partner-webhook cron secret is compared with `!==`.
  - Anyone can plant files in any firm's intake folder.
  - `audit_log` is not protected from `service_role`.
  - Any party can set a message's `read_at`.
  - Registry contact details are public.
  - Invite and representation tokens are stored in plain text.
  - `siteOrigin()` trusts `x-forwarded-host`.
  - The `firm-assets` bucket accepts SVG.
  - Signed URLs are served inline.
- **Backend**
  - Invoices, payments, VAT and slot length have no CHECK constraints. `slot_min = 0` makes the anon-callable `available_slots` loop.
  - The `max_per_day` cap has a race.
  - Possible deadlock between `record_payment` and `release_expired_holds`.
  - `due_at` uses UTC `current_date`.
  - `create_invoice` accepts any profile.
  - Reminders ignore `deleted_at`.
- **Frontend**
  - The console loads Archivo and never uses it. The registry layout declares fonts it never loads.
  - The booking wizard imports the 1,077-line sign-in form eagerly.
  - The module-level tenant cache in `tenant.ts` has no size bound.
  - `start_url` is `/app` for staff installs too.
  - `firmMatters` passes the search string to `or()` unsanitised.
  - Dead code: `matter-search.tsx`, the UI barrel, `database.types.ts`, the messaging and video provider modules, `codemod-classes.mjs`.
- **Accessibility**
  - ✓ glyphs whose meaning is carried by colour alone (`before-card.tsx:51`, `checkin-panel.tsx:69`).
  - About 28 `rounded-full` status or filter chips.
  - Sign-in tabs have no tab-panel semantics.
  - 12 targets are under 44px.
  - Text in the video room fails contrast at 3.9:1.
  - Admin, registry and public pages have no skip links.
  - 7 raw `<table>` elements lack a caption, and some headers lack `scope`.
- **Privacy**
  - Firm sites and the portal carry no non-affiliation disclaimer.
  - There is no accessibility statement.
  - The IP digest used for rate limiting is unkeyed SHA-256.
  - Google Fonts leaks the portal origin to Google.
  - The client guide's "edit your address" is untrue.
  - The documented 120-second signed-URL lifetime is 600 seconds in `sign-dialog.tsx`.
  - Lawyers' SCNs are published.
  - Advertising rules (RPC rr. 39–40) have not been reviewed by counsel.
- **Operations**
  - `RPC_REFERENCE.md` covers 149 of 220 functions, and 21 functions the app calls are undocumented.
  - `seed.sql` creates a real firm as `active` and verified.
  - The production project ref appears in three files.
  - The blueprint documents still name Stripe.

---

## 5. What is solid

- **Tenant isolation.** RLS is enabled on every table, and `check_row_firm` triggers prevent cross-firm child rows. Matter walls are applied consistently through `matter_row_r/w`, including inside delegation.
- **Definer functions and views.** Every SECURITY DEFINER function pins `search_path`. Internal helpers are revoked from `anon` and `authenticated`, and definer views list their columns explicitly.
- **Money path.** Money is stored as integer minor units, with totals kept per currency. Payments are idempotent on `provider_ref`, the invoice row is locked while a payment is recorded, and subaccount settlement is enforced and mismatches are reported. Every webhook delivery is logged.
- **Webhooks.** Paystack uses a constant-time HMAC check and server-side verification. Delivery receipts are properly signed (Svix, Twilio HMAC, Termii digest).
- **Booking and the court diary.** The exclusion constraint prevents double-booking. Deadlines store their calculation and rule version and are superseded rather than edited. `post_court_update` is idempotent.
- **Calendar feed.** Tokens are 256-bit and stored hashed, with revocation, rotation and a rate limit.
- **Headers and secrets.** The CSP uses a per-request nonce, and HSTS and a strict Permissions-Policy are set. No secrets reach the browser, and the service role is never used in Next.js.
- **Accessibility primitives.** The shared components are sound, reduced motion is honoured globally, and nearly every control has a label.
- **CI.** It builds the real app, runs all 31 SQL suites with minimum assertion counts, runs main's suite against the branch schema, and runs the PDF, calendar and extraction writers.
- **Honest documentation.** `COMPLIANCE_PACK.md` and the runbooks are candid about what is missing.

---

## 6. Remediation plan

**Week 1: security blockers.** All small changes, each with a SQL or unit test.

1. Add an admin assertion before any provider call in `app/admin/actions.ts` (C1).
2. Harden `safeNext` and add its unit test (H3).
3. Make the prompt-cancel paths return early (H10).
4. Identity binding:
   - revoke direct `matter_parties` and `appointments` INSERT;
   - require an existing relationship in `open_matter` and `create_invoice`;
   - resolve identities in `auth.users`;
   - lock `profiles.email` and `profiles.phone` (H1, H2, M-S5).
5. Enforce the `document_versions.storage_path` shape and hard-code the bucket in `extract-text` (M-S1).
6. Add `mfa_ok()` to the staff and platform read helpers (M-S2).

**Week 2: money and records.**

7. Make reference prefixes unique (H5).
8. Refuse checkout for cancelled or expired bookings, add `needs_refund`, and flag overpayments. Reuse one Paystack reference per invoice (H6, H7).
9. Return 5xx when Paystack verify fails transiently, and add a reconciliation job (H8).
10. Revoke hard DELETE and add `retire_matter` (H9).
11. Show VAT in the booking wizard (M-P2).
12. Fix court reminders to use Lagos calendar dates (M-B1).

**Week 3: confidentiality and privacy.**

13. Add the `client_matters` view and message scoping (H4).
14. Make notification copy content-free by default (H11).
15. Remove matter type from analytics, gate the visitor cookie, and pin the Vercel region (H13, M-P3).
16. Draft the platform privacy notice, terms, DPA and cookie notice with counsel (H12).
17. Clear saved offline pages at sign-out (M-F6).

**Week 4: reliability and operations.**

18. Stop treating query errors as empty results, and add segment `error.tsx` files (M-F2, M-F4).
19. Wrap the context helpers in `cache()` and remove the waterfalls (M-F1, M-F5).
20. Route action errors through `userError()`, and add `instrumentation.ts` (M-O1, M-A2).
21. Add Vitest with the top-10 unit tests; add ESLint, Dependabot and CodeQL; move to Node 22 (M-O2, M-O3, M-O5).
22. Regenerate the database types in CI and type the Supabase clients (M-F7).
23. Update the restore runbook and `.env.example`, and add cron health checks (M-O6, M-O8).

Items marked **[Counsel]** need review by a Nigerian data-protection and professional-conduct
practitioner before launch. `COMPLIANCE_PACK.md` recommends the same.
