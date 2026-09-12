# Server functions — the complete reference

*For anyone writing against Docket's database: every security-definer function, who may call it,
and the exact words it refuses with. This supersedes the short table in `README.md`.*

Signatures below were read out of `supabase/migrations/`, not remembered. Where a function was
redefined more than once, the version documented is the LAST one — the one that is actually in
the database after every migration has run.

---

## How to read this

**The database is the authorization layer.** No rule below is re-implemented in TypeScript. A
screen may decline to *offer* a button the database would certainly refuse, but the refusal
itself always comes from Postgres, and the app shows its sentence word for word — the words carry
the reason, and a reworded refusal loses it.

**`42501` means "not permitted".** A refusal raised `using errcode = '42501'`
(`insufficient_privilege`) is an authorization refusal. Everything else is a business rule and
arrives as a plain error whose message is the whole explanation.

**Four gates decide nearly everything.** They are composed, not repeated:

| Gate | True when |
|---|---|
| `mfa_ok()` | the session's JWT claim `aal` is exactly `aal2` — a second factor was used |
| `is_firm_member(f)` | the caller has a `firm_members` row in firm `f`, any role |
| `staff_w(f)` | `is_firm_member(f)` **and** `mfa_ok()` **and** the firm is not suspended |
| `can_see_matter(m)` | the wall (migration 29): `is_firm_member` of the matter's firm **and** (the matter is `access = 'firm'` **or** the caller is on `matter_lawyers`). Every matter-content policy and every matter-scoped definer function asks it |
| `open_document_version(v)` | the one door to a document's bytes (migration 30): checks `can_access_document_version(v)`, records a `document_reads` row and a `document.opened` audit line, returns `storage_path`/`mime`/`size_bytes`/`name`. The Storage read policy then requires that record — `recorded_read(v)`, five minutes — before a signed URL is minted |
| `matter_row_r(f, m)` / `matter_row_w(f, m)` | a row that may or may not hang off a matter: `can_see_matter(m)` when it does (write: **and** `staff_w(f)`), the firm-wide test when `m` is null |
| `admin_w(f)` | the caller is `owner` or `admin` in `f` **and** `mfa_ok()` **and** not suspended |

So "staff (MFA)" below always means `staff_w`, and a **suspended firm cannot write anything** —
every `staff_w` and `admin_w` is false for it while reads carry on working.

**A platform admin is a row in `platform_admins`.** There is no email pattern and no environment
allow-list. `is_platform_admin()` reads that table; the app never decides it.

**Argument names.** Every parameter is `p_`-prefixed in the database. PostgREST takes them by
name, so a call is `{ p_firm: …, p_service: … }`. Parameters with a default may be omitted.

---

## 1. Predicates — the gates themselves

These are plain boolean functions. They are reachable on the API surface (`/rest/v1/rpc/<name>`)
because they keep Postgres' default `EXECUTE` grant, and that is harmless: each one answers a
question about the **caller** and returns nothing but true or false. None of them refuses; a
caller who is not permitted simply gets `false`.

| Function | Answers |
|---|---|
| `mfa_ok()` | is this session two-factor verified (`aal2`) |
| `is_firm_member(f uuid)` | am I a member of this firm |
| `has_firm_role(f uuid, roles firm_role[])` | am I a member of this firm in one of these roles |
| `staff_w(f uuid)` | may I write as staff here — member, MFA, firm not suspended |
| `admin_w(f uuid)` | may I write as owner/admin here — role, MFA, firm not suspended |
| `firm_not_suspended(f uuid)` | is this firm's status anything other than `suspended` |
| `firm_is_active(f uuid)` | is this firm's status `active` (granted to `anon` too) |
| `is_platform_admin()` | am I a Docket operator (granted to `anon` too, so a logged-out visitor gets `false` rather than an error) |
| `is_matter_party(m uuid)` | am I a party to this matter |
| `is_appointment_client(a uuid)` | am I the client of this appointment |
| `is_client_of_firm(f uuid)` | do I have an appointment with, or a matter at, this firm |
| `can_see_profile(p uuid)` | myself, a colleague, or somebody I share a matter or appointment with |
| `can_access_document(d uuid)` | firm member, or a client on a `client_visible`, undeleted document |
| `can_access_document_version(v uuid)` | the same, for one version — this is what the storage policy calls, and what limits a served firm to the exact version served |
| `can_upload_document(d uuid)` | may I add a version to this document |
| `can_access_invoice(i uuid)` | firm member, or the client of an invoice that is not a draft |
| `is_served_firm(p_service uuid)` | am I a member of the firm this process was served on, through Docket, not withdrawn |
| `firm_policies_published(f uuid)` | are this firm's terms **and** privacy versions both present and not starting `0-` |
| `is_valid_firm_slug(p_slug text)` | is this a legal, unreserved slug — `immutable`, and also a check constraint on `firms.slug` |
| `is_public_holiday(p_date date, p_country text = 'NG', p_state text = null)` | national or state-declared holiday, counting observed dates |
| `is_non_sitting_day(p_date date, p_level court_level = null, p_state text = null)` | weekend, public holiday, or a published court vacation for that level |
| `try_uuid(p text) → uuid` | the text as a uuid, or null — never an error. The storage policies parse object paths with it |

**Not granted to anybody:** `practitioner_label(p_user, p_firm) → text`. It composes
`"Name (SCN)"` for audit entries and notifications; `revoke … from public, anon, authenticated`.

**`is_served_firm_member(uuid)` no longer exists.** Migration 13 dropped it and replaced it with
`is_served_firm(uuid)`, which checks the `process_service` row rather than the counsel row.

> `is_non_sitting_day()` is only as good as its data. It always refuses weekends and refuses any
> date in `public_holidays`, which is seeded with the fixed federal dates for 2026 and 2027.
> `court_vacations` is **empty in every environment** until an operator types a court's
> practice-direction dates into `/admin/reference`. Until then a date in the middle of the Long
> Vacation is treated as an ordinary sitting day. `reference_data_coverage` reports how far the
> data reaches.

---

## 2. The anonymous surface

Granted to `anon` as well as `authenticated`. Everything else in this document requires a
session.

### `available_slots(p_firm uuid, p_lawyer uuid, p_service uuid, p_date date, p_ignore uuid = null)`
Returns `table (starts_at timestamptz, ends_at timestamptz)`.

The booking engine. Works in the **lawyer's** timezone (falling back to the firm's), reads
`availability_rules` for that weekday, subtracts the break, subtracts `availability_exceptions`,
subtracts live appointments, stops at `max_per_day`, and never offers anything less than two
hours away.

Refuses nothing — it returns **no rows**. An empty result is not an error and has several
ordinary causes: the firm is not `active`, the service is not this firm's or is not `is_active`,
the lawyer has no rule for that weekday, the day is fully booked, or the day is in the past.
`p_ignore` excludes one appointment from the clash check, which is what makes rescheduling to an
adjacent slot possible.

### `rate_limit_hit(p_bucket text, p_limit int, p_window interval = '1 minute', p_key text = null)`
Returns `boolean` — **true means allowed**, false means the allowance is spent.

The only rate limiter in the stack, because the three runtimes that need one (the browser, Next.js
server actions and a Deno Edge Function) share nothing but this database. A signed-in caller is
keyed on `auth.uid()` **inside** the function, so `p_key` cannot be used to borrow somebody else's
allowance; an anonymous caller is keyed on whatever the calling runtime passes, which in
`src/lib/rate-limit.ts` is a SHA-256 digest of the client address, never the address itself.

Refuses:
- `a limit must be at least 1`
- `unknown bucket` — `p_bucket` must match `^[a-z][a-z0-9_]{1,40}$`

The Next.js buckets and their allowances live in `LIMITS` in `src/lib/rate-limit.ts`: `slots`
120/min, `booking` 10/hour, `checkout` 20/hour, `invite` 20/hour, `firm_start` 5/hour,
`webhook_bad` 60/min. The Paystack webhook repeats `webhook_bad`'s numbers in its own file,
because a Deno function cannot import a Next.js module — change one and change the other.

---

## 3. What a client may call

### `book_appointment(p_firm uuid, p_service uuid, p_lawyer uuid, p_starts_at timestamptz, p_mode appointment_mode = 'virtual', p_client_timezone text = 'Africa/Lagos', p_intake jsonb = null, p_intake_form uuid = null)`
Returns `jsonb`: `appointment_id`, `reference`, `status`, `invoice_id`, `invoice_number`,
`amount_minor`, `currency`, `paystack_subaccount`, `hold_expires_at`.

**Who:** any signed-in person. `anon` is revoked.

Re-validates the slot through `available_slots()` — the app's list is a suggestion, this is the
decision — creates the appointment, and where the service has a price raises an **issued** invoice
with the firm's VAT applied to the minor units. A prepaid booking is created `awaiting_payment`
with a **15-minute hold**; a free one is `confirmed` immediately and the client is notified.
Clients never insert an appointment row: this function is the only way in.

Refuses:
- `not authenticated` *(42501)*
- `this firm is not taking bookings` — the firm is missing or its status is not `active`
- `this firm has not published its terms and privacy notice yet` — `firm_policies_published()` is false
- `service unavailable` — not this firm's service, or not `is_active`
- `service not available virtually`
- `this firm is not yet set up to receive payments` — a prepaid, priced service at a firm with no `paystack_subaccount`
- `slot unavailable` — raised twice: once when the time is not in `available_slots()`, and again if the lawyer's overlap exclusion constraint fires in the race between the two

### `cancel_appointment(p_appointment uuid, p_reason text = null)`
Returns `void`. **Who:** the appointment's own client, or `staff_w(firm)`.

Cancels, voids an unpaid invoice, and audits.

Refuses:
- `appointment not found`
- `not permitted` *(42501)*
- `appointment already <status>`
- `appointment already started`

### `accept_invite(p_token text)`
Returns `jsonb`. **Who:** any signed-in person holding the token.

Joins the matter a staff member invited them to, as the invited `party_role`. A member of the firm
can never accept an invitation into that firm's own matter (migration 33): the invitation is for
the client, and a colleague outside a wall must not walk in through it.

Refuses:
- `not authenticated` *(42501)* · `a member of the firm cannot join its own matter as a party — the invitation is for the client` *(42501)*
- `invite invalid or expired` — one sentence for a wrong token, a used token and an expired one, on purpose

### `appointment_readiness(p_appointment uuid)`
Returns `jsonb` — `held`, `checkin_required`, `ready`, and `items` (`payment`, `intake` with the
required questions still unanswered, `documents` with the open requests, `consent` against the
firm's current terms and privacy versions, and `conflict` only where the firm requires clearance
before taking a client on). **Who:** the client of the consultation, or a member of the firm.
Computed from real rows every time (migration 35); nothing is stored as done. A client sees the
conflict item only as "the firm's own checks", never its substance. A required question shown on
a condition (`show_if`) is not counted, nor is a file question.

Three things it is careful about, each because the obvious reading is wrong:
- **Whose answers.** Only the appointment's own client's `intake_responses` rows count. The insert
  policy asks no more than that a row names the caller as its client, so without this any
  signed-in person who learned an appointment id could write the answers the firm reads. A trigger
  on `intake_responses` now refuses such a row outright as well.
- **Which form.** Only a form belonging to this firm. `form_id` is a bare foreign key, so a
  response could otherwise name another firm's form — one with nothing required — and answer
  nothing while reading as answered.
- **Whose fee.** The payment item appears only where `services.requires_prepayment` is true. A
  service the firm is paid for later is not turned into a pay-first one by switching the check-in
  on, which would hold the booking for a fee the firm never asked for and release it unpaid at its
  hour.

Refuses: `not permitted` *(42501)*

### `amend_intake_response(p_appointment uuid, p_answers jsonb)`
Returns `jsonb` (`response_id`, `readiness`). **Who:** the client of a live consultation. Inserts a
new `intake_responses` row carrying the earlier answers plus these — answers stay insert-once, and
the latest row is the one that counts. Audits `intake.amended`.

Refuses: `not permitted` *(42501)* · `this consultation is <status>` · `answers must be an object`

The earlier answers it carries forward are the client's own, on a form of this firm's — the same
two filters `appointment_checkin()` applies, so an amendment never carries a stranger's text or
another firm's form into the row that counts.

#### The guard on going live
`guard_appointment_confirm` fires **after insert or update of status**, and asks about the state
reached rather than about one column being set to one value: entering `confirmed` **or**
`rescheduled` from anything else, by either route, is the confirmation the rule is about. Both are
live everywhere else in Docket — reminders go out for either, the console opens the room for
either, `release_expired_holds()` releases neither — so guarding only the word "confirmed" on an
update left staff able to make a held booking live by calling it rescheduled, or by inserting one
live outright. AFTER rather than BEFORE because `appointment_checkin()` reads the appointment back
out of the table and can only see a row that is already there.

### `invoice_settlement(p_invoice uuid)`
Returns `jsonb` — the Paystack subaccount the checkout must route to, and the invoice's state.

**Who:** the invoice's own client, or any member of the firm.

Refuses:
- `not permitted` *(42501)* — also what a missing invoice returns, so an id cannot be probed

### `fulfil_document_request(p_request uuid, p_document uuid)`
Returns `void`. **Who:** a party to the matter, or firm staff who can see it (the wall applies).

Requests themselves carry an optional `client_ref` (migration 36), unique per firm: a request form
whose reply was lost is sent again with the same reference, the duplicate is refused, and the client
is asked once rather than twice. Insert is narrowed to the columns the forms write, so
`fulfilled_document_id` and `fulfilled_at` stay this function's to set.

Answers a request the firm made (`document_requests`, migration 31) with an uploaded document:
marks it fulfilled once, audits `document_request.fulfilled`, and tells the lawyer who asked
(`document_received`). Staff create requests by plain insert and withdraw them by setting
`cancelled_at`; nobody can delete one. The API's update grant covers only `title`, `why`, `due_on`
and `cancelled_at` (migration 33), so fulfilment and who-asked-when are the function's alone, and
`guard_document_request()` keeps a withdrawal withdrawn.

Refuses:
- `not authenticated` · `not permitted` *(42501)* — also what an unknown request returns
- `this request was withdrawn` · `this request has already been answered`
- `that document has no file yet — finish the upload first` (migration 36) — a `documents` row whose
  bytes never arrived answers nothing

### `retire_empty_document(p_document uuid)`
Returns `void`. **Who:** whoever made the row, or firm staff who can write the matter (the wall applies).

An upload that stopped between the `documents` row and the bytes leaves a row with no version.
The screens offer to finish the upload; this retires the row instead (soft-delete, audited
`document.retired`). A row that has a file is never retired this way — a document with bytes is
removed only by the firm's ordinary delete, which keeps the versions.

Refuses: `not authenticated` · `not permitted` *(42501)* · `document not found` ·
`this document has a file and stays`
- `that document is not on this matter` — a document on another matter, or a deleted one

---

## 4. What firm staff may call

Every one of these needs `staff_w(firm)`: membership, an `aal2` session, and a firm that is not
suspended. They all refuse with the bare sentence `not permitted` *(42501)* when that is false —
the same sentence whether the caller is at another firm, has no second factor, or belongs to a
suspended one. That is deliberate: a more specific refusal would tell a stranger which firm owns
a row.

### `open_matter(p_firm uuid, p_title text, p_type matter_type, p_client uuid = null, p_cause_title text = null, p_description text = null, p_court_id uuid = null, p_suit_number text = null, p_judicial_division text = null, p_originating_lawyer uuid = null, p_handling_lawyer uuid = null, p_status_key text = 'new_inquiry', p_note_to_client text = null, p_conflict_check uuid = null, p_adverse_parties jsonb = null)`
Migration 39: `p_status_key`'s default, `new_inquiry`, means the firm's **entry stage** — that key
where the firm has it, else its first open stage that fits the matter's type, else none for a
firm with no stages yet. Any other key the firm does not have is refused (it used to open the
matter with no stage), a stage offered only for other matter types is refused, the stage's
suggested next action is written, and the stage's task templates from the firm's installed packs
are started; the result carries `tasks_created`, and `matter.opened` is audited.
Returns `jsonb`. Issues the reference from the firm's counter, adds the client as a party and the
lead lawyer, records court and suit number, and posts the first client-visible timeline entry.
Since migration 32 it also records the other side (`p_adverse_parties`, an array of
`{name, kind, aliases}`) and attaches a conflict check run before the matter existed
(`p_conflict_check`, decided, this firm's, not yet on a matter) — so the clearance guard on the
client link can find it in the same call.

Refuses: `not permitted` *(42501)* · `matter title is required` · `client account not found` ·
`a member of the firm cannot be its client on a matter` · `handling lawyer is not a member of the firm` ·
`originating lawyer is not a member of the firm` · `conflict check not found` ·
`that conflict check belongs to another matter` · `decide the conflict check before opening the matter on it` ·
`the conflict check did not search for <names>: run it again` (migration 33 — the check's keys must cover the client's name and company and every name on the other side) ·
`this firm requires a cleared conflict check before a client joins a matter` (the trigger, with the switch on)

### `post_court_update(p_matter uuid, p_outcome text, p_occurred_at timestamptz = now(), p_court_name text = null, p_adjourned_at_instance_of text = null, p_next_date timestamptz = null, p_next_purpose text = null, p_note_to_client text = null, p_internal_note text = null, p_court_id uuid = null, p_judicial_division text = null, p_allow_non_sitting bool = false, p_judge text = null, p_courtroom text = null, p_purpose_kind text = null, p_meaning text = null, p_next_step text = null, p_client_action text = null, p_action_required bool = null, p_next_update_by date = null, p_client_ref uuid = null)`
Returns `uuid` (the client-visible update). The thirty-second form after a sitting: composes the
title, posts the client entry and the internal note separately, closes the day's court event
matched **in court time**, and opens the next one. The five shaped fields (migration 27) are what
the client reads by name: what it means, what happens next, what they must do, whether anything is
required of them, and when to expect the next update.

`p_client_ref` (migration 36) is a reference the form mints once per posting. A second call with
the same reference on the same matter returns the update already made and makes nothing — so a
form that lost the reply can send again without a second timeline entry, court event or
notification. Without a reference, every call is a posting, as before.

Outcomes: `hearing_held`, `adjourned`, `ruling_delivered`, `judgment_delivered`, `struck_out`,
`stood_down`, `mention`, `court_did_not_sit`, `hearing_notice`, `adjourned_sine_die`.

Refuses: `not permitted` *(42501)* · `matter not found` · `unknown outcome <outcome>` ·
`a hearing notice fixes a date` · `court <id> is not available to this firm` ·
`next date <DD Mon YYYY> is a weekend, public holiday or court vacation — confirm the vacation judge will sit (p_allow_non_sitting)`

### `vacate_court_event(p_event uuid, p_reason text, p_new_date timestamptz = null, p_new_purpose text = null)`
Returns `uuid`. The registry vacated a date: reminders and the sittings digest skip it, a refixed
date opens a new event, and the client is told.

Refuses: `not permitted` *(42501)* · `court event not found` · `already vacated` ·
`refixed date <DD Mon YYYY> is a weekend, public holiday or court vacation`

### `save_consultation_notes(p_appointment uuid, p_client_summary text, p_advice_given text = null, p_follow_up text = null, p_internal_notes text = null, p_mark_completed bool = true)`
Returns `uuid`. Writes the client-visible note and the internal note to **two different tables**,
which is how RLS keeps them apart; echoes the consultation to the matter timeline and can mark the
appointment completed.

Refuses: `appointment not found` · `not permitted` *(42501)*

### `confirm_appointment(p_appointment uuid)`
Returns `jsonb`. **Who:** `staff_w`. Moves a **held** booking (`status = 'pending'`, migration 35)
to `confirmed`, audits `appointment.confirmed`, tells the client. With `firms.checkin_before_confirm`
on it refuses until `appointment_readiness()` says ready — and so does `guard_appointment_confirm()`
on any direct update, whoever writes.

Refuses: `not permitted` *(42501)* · `this consultation is <status>, not held` · `not ready: <items>`

### `reschedule_appointment(p_appointment uuid, p_starts_at timestamptz, p_reason text = null)`
Returns `jsonb`. Re-validates the new time through `available_slots()` (ignoring this
appointment), resets the reminder flags, notifies the client, audits.

Refuses: `appointment not found` · `not permitted` *(42501)* ·
`only confirmed appointments can be rescheduled (this one is <status>)` ·
`the new time must be in the future` · `that time is not available`

### `mark_no_show(p_appointment uuid)`
Returns `void`.

Refuses: `appointment not found` · `not permitted` *(42501)* · `appointment is <status>` ·
`the appointment has not started yet`

### `create_invoice(p_firm uuid, p_client uuid, p_items jsonb, p_matter uuid = null, p_currency currency = null, p_due_on date = null, p_issue boolean = false, p_note text = null)`
Returns `jsonb`. Numbers from the firm's counter, applies `firms.vat_rate` to the minor units,
writes the items. `p_issue` issues it in the same call, which notifies the client and echoes a
fee entry onto the matter's timeline.

Refuses: `firm not found` · `not permitted` *(42501)* · `an invoice needs at least one item` ·
`too many items` · `client account not found` · `matter not found in this firm` ·
`the client billed must be a party to that matter — invite them to it first, or raise the invoice without a matter` ·
`each item needs a unit amount of zero or more` · `each item needs a quantity above zero` ·
`each item needs a description` · `an invoice must come to more than zero`

### `issue_invoice(p_invoice uuid, p_due_on date = null)`
Returns `jsonb`. Draft → issued. A client can only ever see an issued invoice.

Refuses: `invoice not found` · `not permitted` *(42501)* · `invoice <number> is already <status>` ·
`the client billed is no longer a party to that matter — put them back on it, or cancel this draft and raise it without a matter`

**Who may write an invoice at all (migration 42).** These four functions, and nothing else. The
`insert`, `update` and `delete` grants on `invoices` and `invoice_items` are revoked from every API
role, along with their policies: a member of the firm with a second factor and access to the matter
could otherwise `PATCH` `paid_minor` to the total, `status` to `paid`, `currency` to another one or
`client_id` to somebody else, and `DELETE` an unpaid invoice — past every refusal these functions
make. Nothing in Docket ever used that grant. `supabase/tests/80_doors.sql` §6 holds it closed, for
`invoices`, `invoice_items`, `payments`, `audit_log`, `firm_baselines` and `document_signatures`
together.

### `cancel_invoice(p_invoice uuid, p_reason text = null)`
Returns `void`. **Who: `admin_w` — owner or admin, not every staff member.**

Refuses: `invoice not found` · `not permitted` *(42501)* ·
`a part-paid or paid invoice cannot be cancelled — raise a credit note` ·
`cancel the appointment instead; its invoice follows`

### `invite_matter_party(p_matter uuid, p_phone text = null, p_email text = null, p_role party_role = 'client', p_expires_days int = 14)`
Returns `jsonb` including the **token**, so the console can build a WhatsApp or SMS link. Docket
does not send this invitation itself — there is no account to send it to yet.

Refuses: `matter not found` · `not permitted` *(42501)* ·
`only a client or a contact can be invited to a matter` ·
`this firm requires a cleared conflict check before a client is invited to a matter` (the switch on, `p_role = 'client'`) ·
`give a phone number or an email address to send the invitation to` ·
`an invitation lasts between 1 and 60 days` · `that person is already on this matter`

### `run_conflict_check(p_firm uuid, p_matter uuid = null, p_names text[] = null, p_appointment uuid = null)`
Returns `jsonb` — `check_id`, the normalised `keys` searched, `matches` and `match_count`. **Who:**
`staff_w(firm)`; with `p_matter`, also `can_see_matter`.

Searches **this firm's own register** — clients on its matters (profile name and company), the
adverse-party register with aliases, free-text opposing parties, and cause titles (which can only
contain a name) — for the names given plus everyone `p_matter` itself names, across every other
matter of the firm, closed ones included. Strengths: `exact`, `contains` (a whole run of words),
`similar` (trigram ≥ 0.5); keys under four characters match only exactly. A match on a restricted
matter the caller is not on comes back with `restricted: true`, no `matter_id`, and the lead
lawyer's id. Records the search as a `conflict_checks` row (undecided) and audits
`conflict_check.run`. Never another firm's register; never a decision. With `p_appointment` (migration
35) the search includes the person who booked, and the check is recorded on the consultation, where
`appointment_readiness()` reads it. Only a check naming the consultation clears its readiness item,
so that is what the consultation's check-in panel runs — *Run the check*, then the decision — and
a check run from the matter screens never satisfies it.

Refuses: `not permitted` *(42501)* — a matter of another firm, or one behind a wall ·
`nothing to check: give at least one name`

### `decide_conflict_check(p_check uuid, p_outcome text, p_note text = null)`
Returns `void`. The lawyer's decision — `clear`, `conflict` or `waived` — with who and when; a
waiver carries its reason. Once: a changed mind is a new check. Audits `conflict_check.decided`.
With `firms.conflict_checks_required` on, the latest decided check on a matter being `clear` or
`waived` is what lets a client be joined to it (`guard_conflict_clearance()` on `matter_parties`).

Refuses: `not permitted` *(42501)* · `the outcome is clear, conflict or waived` ·
`this check has already been decided — run a new one` · `a waiver records why: give the note`

### `revoke_matter_invite(p_invite uuid)`
Returns `void`. Expires an invitation that has not been accepted.

Refuses: `invitation not found` · `not permitted` *(42501)* ·
`that invitation has already been accepted`

### Service of process

#### `serve_process(p_matter uuid, p_counsel uuid, p_document uuid, p_process_title text, p_method service_method, p_served_at timestamptz = now(), p_note text = null, p_is_originating bool = false, p_substituted_by_order bool = false, p_authority_document uuid = null, p_served_on_name text = null, p_served_on_capacity text = null, p_served_at_address text = null, p_server_name text = null, p_outside_issuing_state bool = false, p_deemed_served_on date = null)`
Returns `uuid`. Records service pinned to the document **version and its checksum**, snapshots the
cause title and suit number, posts a client-visible timeline entry, and notifies the served firm's
owners, admins and service contact.

Methods: `platform`, `counsel_address`, `email`, `whatsapp`, `personal`, `bailiff`, `courier`,
`registered_post`, `publication`, `pasting`.

Refuses: `matter not found` · `not permitted` *(42501)* ·
`your firm must be active on Docket to serve processes` · `counsel is not on this matter` ·
`document is not on this matter` · `document has no uploaded version to serve` ·
`process title is required` · `counsel is not on Docket — choose another method of service` ·
`that firm has not undertaken to accept service through Docket — serve at its address for service` ·
`service date cannot be in the future` · `service date is more than 90 days ago — record it with a note` ·
`an originating process may only be served on counsel who has undertaken to accept service, or under an order for substituted service` ·
`substituted service needs the court's order attached` ·
`the order for substituted service must be a document on this matter`

#### `acknowledge_service(p_service uuid, p_note text = null)`
Returns `void`. **Who:** the **served** firm's `owner`, `admin` or `lawyer`, with MFA, at a firm
that is not suspended — a `staff` member cannot acknowledge, because acknowledgement is a
practitioner's act.

Refuses: `service record not found` · `not permitted` *(42501)* ·
`service was withdrawn by the serving firm` · `already acknowledged`

#### `link_service_to_matter(p_service uuid, p_matter uuid, p_response_due_on date = null, p_note text = null)`
Returns `void`. **Who:** `staff_w` of the **served** firm. Files what was received against that
firm's own matter with a response date.

Refuses: `service record not found` · `not permitted` *(42501)* ·
`service was withdrawn by the serving firm` · `matter not found in your firm`

#### `revoke_service(p_service uuid, p_reason text)`
Returns `void`. **Who:** the **serving** firm's `admin_w`, **or** a platform admin with MFA.
Withdraws a wrongly served process; the served firm's access ends immediately.

Refuses: `service record not found` · `not permitted` *(42501)*

---

### The pilot baseline (migration 41)

#### `firm_metrics(p_firm uuid, p_from timestamptz, p_to timestamptz = now())`
Returns `jsonb`. **Who:** any member of the firm. Computes, from the firm's own rows and nothing
else: bookings made and paid in the window with the median hours to pay; attendance over
consultations whose time has passed, split **attended / missed / unrecorded**; consultations
followed by a matter for the same client within sixty days, with the median days; sittings that
came and went, how many carry an update and how many within a day; messages from clients, how many
were answered and how long the first reply took, and how long the oldest unanswered one has waited;
documents asked for and sent in; invoiced and collected **per currency** with the median days to
collect; open matters, matters opened, overdue next actions judged in the firm's own timezone, and
client updates posted; and clients who did something the rows can see.

Every answer carries a `caveats` array written by the function itself, and the screens print it
rather than summarising it away. Three of them matter:
- **Unrecorded attendance is its own bucket.** Docket marks a consultation completed when its notes
  are saved, so one held in chambers and never written up stays `confirmed` for ever. Folding those
  into either "attended" or "missed" would invent the firm's attendance rate.
- **Consultation to matter is an inference.** No column joins the two; it means the same client had
  a matter opened within sixty days.
- **The PostHog funnel is not part of this.** Its key is optional, two of its five steps are never
  emitted, and a client who signs in by phone is never joined to their earlier visits — so it cannot
  carry a claim, and the baseline is database-derived instead.

Refuses: `not permitted` *(42501)* · `firm not found` · `give a window: from, then to`

#### `record_firm_baseline(p_firm uuid, p_from timestamptz, p_to timestamptz = now(), p_note text = null, p_stated jsonb = '{}')`
Returns `uuid`. **Who:** `admin_w` — an owner or administrator with a second factor. Calls
`firm_metrics()` and stores the answer as a row in `firm_baselines` with the window, the note, and
who took it. `p_stated` is what the **firm says** about the work before Docket — short text, at most
500 characters an entry — kept in its own column and never merged into the metrics, because Docket
cannot measure it and must not present it as though it had. Audits `baseline.recorded`.

`firm_baselines` is append-only in the same way `audit_log` is: `select` for members of the firm,
and no insert, update or delete granted to any API role. A number that could be edited afterwards
is not a baseline.

Refuses: `not permitted` *(42501)* · `what the firm states is an object of short answers` ·
`a stated figure is text of at most 500 characters (…)` · and every refusal of `firm_metrics()`

### Templates and execution (migration 40)

#### `prepare_generated_document(p_matter uuid, p_template uuid, p_name text = null, p_client uuid = null, p_extra jsonb = '{}')`
Returns `jsonb` — `document_id`, `version_id`, `storage_path`, `name`, `text`, `facts`,
`template_version`, `execution`, `client_id`. **Who:** staff who can write the matter. Fills the
template from the matter's own facts and opens the `documents` row (category `generated`, staff-only)
with no version yet. Every `{placeholder}` is resolved from the matter, its client, the handling
lawyer, the firm or today — the list is `document_template_placeholders()` — or from `p_extra` for
`{extra.<name>}`, and **a fact the matter has no value for stops the whole generation and is named**.
Nothing is guessed and nothing is left blank. The returned `facts` carries the value AND its source
for every placeholder used, which `finalize_generated_version()` stores on the version.

Refuses: `not permitted` *(42501)* · `template not found` · `the template "…" is retired` ·
`the template "…" is for property matters` · `nothing is guessed: the matter has no value for matter.court, matter.suit_number` ·
`extra.fee is text of at most 2,000 characters` · `that person is not a client on this matter`

#### `finalize_generated_version(p_document uuid, p_version uuid, p_storage_path text, p_size_bytes bigint, p_checksum text, p_template uuid, p_facts jsonb)`
Returns `void`. **Who:** staff who can write the matter. Records the version the server action just
rendered and stored: kind `generated`, the template and the template's version at the time, the facts
it was filled from, and the sha256 of the bytes. The path must be exactly
`{firm}/{document}/{version}.pdf` — the version's own path, so a row can never point at another
document's bytes. One version only: a second call on the same document is refused. Audits
`document.generated`. A render or an upload that fails leaves the document with no file, which both
document screens show as such and `retire_empty_document()` removes.

Refuses: `not permitted` *(42501)* · `only a generated document is finalised here` ·
`this document already has its version` · `a generated version carries the sha256 of its bytes` ·
`the storage path is not this version's`

#### `request_signature(p_document uuid)`
Returns `void`. **Who:** staff who can write the matter. Shares the document with the matter's
clients and asks them to sign it: `client_visible` becomes true, the ask is stamped with who and
when, and every client on the matter is told (`document_ready_to_sign`). Audits
`document.signature_requested` with the version and its checksum, so the record says what was asked
to be signed, not merely that something was.

Refuses: `not permitted` *(42501)* · `this document has no file yet` ·
`this version has no checksum, so a signature over it would be evidence of nothing — upload it again` ·
`this instrument is executed on paper: print it, sign before a witness, and upload the signed copy` ·
`this document is already executed`

#### `record_signature(p_version uuid, p_typed_name text)`
Returns `uuid` (the signature). **Who:** anyone who may see the version — the client the firm asked,
or a member of the firm countersigning. What it records is evidence, so each part is checked rather
than accepted: the signer must have **opened this version in the last thirty minutes**
(`document_reads`, the same record the storage policy needs before it mints a URL), the typed name
must match `profiles.full_name` exactly once case and spacing are normalised, and the version must
carry a checksum — which is stored on the signature, so what was signed is nameable bytes. A staff
signature also stores the practitioner's enrolment number. The signature locks the document on that
version: no further version, no move of the pointer, no deletion. The firm is told
(`document_signed`), and a client signature posts a client-visible `document` entry on the timeline.
`document_signed` is the one event in Docket with **two audiences** — the client hears that the firm
countersigned, the firm that the client signed — so its payload carries `audience` (`client` or
`firm`) and both renderers read it. Without that a client's row would link into `/firm/…`, a page
they cannot open.
One signature per signer per version (`23505` on a second). Audits `document.signed`.

Refuses: `not permitted` *(42501)* · `the firm has not asked for a signature on this document` ·
`open the document first: a signature is over bytes the signer has seen` ·
`type your name exactly as it is on your profile: Adaeze Okafor` ·
`your profile has no name to sign with — add it first` ·
`this instrument is executed on paper, not signed here` · `this document is executed on another version`

#### `record_paper_execution(p_document uuid, p_version uuid, p_executed_on date, p_witness_name text = null, p_attested_by text = null, p_stamp_ref text = null, p_registration_ref text = null)`
Returns `void`. **Who:** staff who can write the matter. For an instrument the law executes on paper —
a deed, anything needing a witness, attestation, stamping or registration. The executed copy is
uploaded as a version in the ordinary way and this records what happened to it off-screen: the day on
the instrument (a calendar day, never shifted, and never in the future), the witness, who attested it,
the stamp duty and registration references. It locks the document on that version and posts a
client-visible timeline entry. Audits `document.executed_on_paper`. Docket does not claim the
signature happened here; it records that it happened.

Refuses: `not permitted` *(42501)* · `this document is already executed` ·
`that version is not this document's` · `this version has no checksum — upload the signed copy again` ·
`give the day it was executed` · `the day of execution is not in the future`

#### Templates themselves
`document_templates` is written through the ordinary policies (`admin_w` — an owner or administrator
with a second factor), not an RPC. A trigger checks every placeholder against
`document_template_placeholders()` before the row is stored, so a template that names a fact Docket
cannot fill is refused at the door rather than at generation. Changing the words or the execution
mode bumps `version`; a document already generated keeps the version it was made from. Retiring a
template stops new generations and changes nothing already made from it.

### Workflow packs (migration 39)

#### `set_matter_status(p_matter uuid, p_status_key text, p_note_to_client text = null)`
Returns `jsonb` — `status_id`, `tasks_created`, `next_action_set`, `closed`. **Who:** staff who
can write the matter. A change of stage as one act: the matter moves to the firm's stage with that
key (an unknown key is refused; a stage the firm's pack offers only for other matter types is
refused), a `status_change` entry the client reads is posted with the note (none when the stage
is unchanged), a terminal stage sets `closed_at` to today in the firm's calendar and leaving one
clears it, the stage's `default_next_action` is written where the next-action slot is empty, and
every task template the firm's installed packs start on that stage is materialised — once per
matter (`tasks.template_key` is unique per matter), due at five in the afternoon firm time after
the template's offset, assigned to the lead lawyer where the template says so. Audits
`matter.status_changed`. The edit panel's stage select calls this; a bare write of
`matters.status_id` is still allowed by the policy and does none of it.

Refuses: `not permitted` *(42501)* · `unknown status "…" — use one of the firm's status keys` ·
`the stage "…" is for … matters, and this is a … matter`

#### `install_workflow_pack(p_firm uuid, p_key text, p_version int = null)`
Returns `jsonb` — `version`, `statuses_added`, `statuses_recognised`. **Who:** `admin_w`. Installs
a version of a published pack (the latest when none is given): a stage the firm lacks is added
with the pack's label, colour, order, matter types and suggested next action; a stage the firm
already has is **recognised** — stamped with the pack and version and left exactly as it reads,
so a pack never rewrites the label a client sees or moves a matter. Installing again with a newer
version adds only; an older version is refused. The firm's ledger (`firm_workflow_packs`) says
which version it is on. Audits `workflow_pack.installed`.

Refuses: `not permitted` *(42501)* · `no such pack` / `no such pack version` · `this firm is already on version N of "…"`

#### `publish_workflow_pack(p_key text, p_name text, p_matter_types matter_type[], p_definition jsonb, p_note text = null)`
Returns `int` (the new version). **Who:** a platform admin with MFA. Publishes the next version of
a pack — `definition` is `{statuses: [{key, label, colour, sort, is_terminal, next_action}],
task_templates: [{key, title, on_status_key, due_offset_days, assignee: lead|none}]}`, checked
by `workflow_pack_definition_check()` before anything is written. A version is immutable: the
table has no update or delete grant. Audits `workflow_pack.published`, which the platform reads.
Docket ships two packs as data in the migration — `litigation` v1 (the fifteen stages every firm
starts with, so an existing firm is recognised, not duplicated) and `conveyancing` v1 for
`property` matters — labelled as defaults and supersedable.

Refuses: `not permitted` *(42501)* · `a pack has at least one stage under "statuses"` ·
`stage key "…" appears twice` · `template "…" starts on stage "…", which the pack does not have` · the other shape errors, each naming the stage or template

### The legal diary (migration 38)

#### `attach_court_event_source(p_event uuid, p_document uuid = null, p_ref text = null, p_source text = null)`
Returns `void`. **Who:** staff who can write the matter (the wall applies). Attaches the notice or
cause-list page a court date came from — a document on the same matter — and/or a reference on
it, marks the date `hearing_notice` (or `cause_list`), and records the caller as the lawyer who
confirmed it. `firm_cause_list.evidenced` is true only for a court-originated date with a document
or a reference behind it: a chip is a claim, a document is evidence. Every court date now records
`created_by` and `created_at` (a trigger; rows older than 38 carry null, not a guess) and is
audited on creation, movement, vacation, closure and evidence.

Refuses: `not permitted` *(42501)* · `attach a document, a reference, or both` ·
`the source document must be a document on this matter` · `a source is hearing_notice or cause_list`

#### `count_deadline(p_from date, p_period int, p_unit text, p_mode text, p_level court_level = null, p_state text = null, p_excludes_vacation bool = false, p_rolls_forward bool = true)`
Returns `jsonb`. **Who:** any signed-in person (it reads only world-readable reference data). The
count, day by day: `calendar` days from the event, `clear` days (the act on the day after the
last), `working` days (only days the court sits), or calendar `months`; days inside a vacation
where time does not run (`court_vacations.time_runs = false`, read here for the first time) are
skipped when the provision says so; a last day the court does not sit rolls forward. The result
carries `due_on`, `counted_days`, every `skipped` and `rolled` day with its reason, and
`coverage` — how many vacation windows and holidays were consulted, whether ANY vacation calendar
exists for the court, and whether holidays are entered for the year — so an empty calendar is
said, never assumed. The preview on the screen and the saved row are the same call.

Refuses: `a period is between 1 and 3660` · `the unit is days or months` · `the count is calendar, clear or working`

#### `compute_deadline(p_matter uuid, p_trigger_kind text, p_trigger_on date, p_provision uuid = null, p_due_on date = null, p_title text = null, p_trigger_ref jsonb = '{}', p_supersedes uuid = null, p_note text = null)`
Returns `uuid`. **Who:** staff who can write the matter. With `p_provision`, counts the deadline
under that provision of the rules (`court_rules`, `rule_provisions`) — refusing a provision that
counts from a different event, rules not in force on the day, or rules for another court level or
state than the matter's — and writes a `proposed` row carrying the jurisdiction as of now, the
rule, provision and version **as they read** (a later correction to the rule never changes it),
the whole calculation, and the day due. Without a provision, `p_due_on` and `p_title` are the
firm's own date, and the row says so (`calculation.count_mode = 'manual'`). `p_supersedes` marks
an earlier proposed or confirmed deadline on the matter `superseded` by this one. Audits
`deadline.computed`. `p_note` is internal; no client ever reads a deadline.

Refuses: `not permitted` *(42501)* · `unknown triggering event` · `the provision "…" counts from …, not from …` ·
`the rules "…" (version …) were not in force on …` · `the rules "…" are for the … and this matter's court is …` ·
`without a rule, give the day the deadline falls` · `a deadline entered without a rule needs a title` ·
`a deadline does not fall before its triggering event` · `that deadline is already superseded|discharged`

#### `confirm_deadline(p_deadline uuid)` / `discharge_deadline(p_deadline uuid, p_note text = null)`
Return `void`. **Who:** confirming is an owner's, admin's or lawyer's act *(42501 otherwise:
`a deadline is confirmed by a lawyer of the firm`)* and happens once; discharging (with a note) is
any staff who can write the matter. Both audited (`deadline.confirmed`, `deadline.discharged`).
The table has no insert, update or delete grant for the API: these three functions and
`compute_deadline()` are the only doors, and a deadline is never edited.

## 5. Firm administration

### `firm_readiness(p_firm uuid)`
Returns `jsonb`. **Who:** any member of the firm. Where the firm stands, from one place
(migration 34): `book_appointment()`'s gates in its order — `status`, `policies_published`,
`active_services` (and `payable_services`: the active ones the settlement state lets a client
book), `availability_rules`, `public_lawyers`, `public_lawyers_with_hours` (public
profiles whose owner has hours of their own: the booking page lists public profiles and
`available_slots()` reads the chosen lawyer's rules, so hours on one lawyer and a profile on
another offer nobody a time), `settlement_account` against `needs_settlement` (any priced service
switched on — every priced booking raises an invoice, and an invoice is paid through Docket only
into the account) — the setup facts (`members`, `owners`, `lawyers`, `intake_forms`,
`all_intake_forms`, `brand_colours`, `brand_logo`, `address_for_service`, `reference_prefix`,
`reference_issued`, `matters`, `clients`, `pending_invites`, `imports_processed`, `custom_domain`,
`domain_request`),
the `skipped` steps, and three `gates`: `site_open`, `bookable` (active, published, a public
lawyer with hours, a payable service), `payment_ready`. The admin overview and the services page
both read it, so they cannot disagree.

Migration 34 also re-creates `normalise_scn()` (migration 14) so the verified-duplicate check on
an enrolment number runs when the number is set or changed, not on every save of the row: the
practitioner's own editor on Me updates `lawyer_profiles` by hand, and a bio must not be refused
for a number the form never touched.

Refuses: `not permitted` *(42501)*

### `skip_onboarding_step(p_firm uuid, p_step text, p_note text = null)` / `resume_onboarding_step(p_firm uuid, p_step text)`
Return `void`. **Who:** `admin_w`. Records that the firm chose to set a checklist step aside, with
who, when and why (`firm_onboarding_steps`), or puts it back. A fact is never stored: `done` is
always computed. Audits `onboarding.step_skipped` / `onboarding.step_resumed`.

Refuses: `not permitted` *(42501)* · an unknown step *(23514, the check constraint)*

### `process_import_batch(p_batch uuid, p_limit int = 25)`
Returns `jsonb` — `processed`, `created`, `skipped`, `failed`, `remaining`. **Who:** `admin_w` of
the batch's firm. Files up to `p_limit` (1–200) unprocessed rows of a staged import
(`import_batches`, `import_rows`, migration 34), each in its own block, so a failing row records
its reason and the rest go on; call it until `remaining` is 0. Per row: an unticked row is
skipped; a `legacy_reference` already on the firm's books is skipped as `already on Docket as
<reference>`; the title, type and status must be readable (an unknown status key or type fails
the row — nothing is filed without one); the lawyers are matched by email or exact name among
members; the court by exact name in the directory, otherwise kept as text; `opened_on` and
`closed_on` are calendar days (`import_day()`: ISO or day/month/year); the reference is minted
by `next_reference()`; the other side goes onto `matter_adverse_parties`, one name per semicolon;
an internal `Brought onto Docket` note is posted and nothing client-visible is invented; the
client is **never linked** by the file's phone or email (both unverified: a person the firm can see
could claim another's file by changing their own number) — an `invites` row is created for the
matter (30 days, `import_phone_key()` E.164 phone or email), readable by the firm like any
invitation, unless the number belongs to a member of the firm or the firm requires conflict
clearance and the matter is not cleared, in which cases the row says so and no invitation is
made; a phone the helper cannot read is said in the row's note (`client not invited: the phone
"…" is not readable`) rather than dropped. Two calls on one batch are serialised on the batch row.
A batch with fewer `import_rows` than its `row_count` — the screen stages in chunks, and a chunk
that never arrived — is refused whole: nothing is filed from it, and a retry cannot file the file
twice. Audits `matter.imported`.

Refuses: `not permitted` *(42501)* · `process between 1 and 200 rows at a time` ·
`this import is not fully staged: <n> of <m> rows arrived — open the file again to import it, and discard this batch`

### `preview_import_duplicates(p_firm uuid, p_legacy text[] = null, p_suits text[] = null, p_causes text[] = null)`
Returns rows `(kind, matched, reference)` — `legacy`, `suit` or `cause`, the value matched, the
Docket reference. **Who:** `admin_w`. Before a file is staged: which of its old file numbers, suit
numbers (lower-cased) and cause titles (lower-cased) already name a matter on the books. Invoker
rights: the comparison is what this admin can see, so a matter behind a wall is not named. The
values travel as parameters, never in a URL. At most 15,000 values in one call.

Refuses: `not permitted` *(42501)* · `compare at most 15,000 values at a time`

### `discard_import_batch(p_batch uuid)`
Returns `void`. **Who:** `admin_w` of the batch's firm. Removes a batch whose staging never
finished — it has filed nothing, so there is no reconciliation to keep. A batch that has begun
filing is the record and stays. Audits `import.discarded` with the source name, `row_count` and
how many rows had arrived.

Refuses: `not permitted` *(42501)* · `this import has already begun filing and stays as the record`

Owner or administrator, with MFA, at a firm that is not suspended.

### `set_member_role(p_firm uuid, p_user uuid, p_role firm_role)`
Returns `void`. **Who:** `admin_w(p_firm)`.

`firm_members_write_*` on its own would let an administrator promote themselves to owner or delete
the last one. The console never writes that table; it calls this, which holds the rules.

Refuses:
- `not permitted` *(42501)*
- `that person is not a member of this firm`
- `you cannot change your own role — ask another owner to do it`
- `only an owner can appoint or stand down another owner` *(42501)* — checked in **both**
  directions, so an admin cannot make an owner and cannot unmake one either
- `this is the firm's last owner — appoint another owner first`

Setting the role somebody already has returns quietly and writes no audit line.

### `remove_member(p_firm uuid, p_user uuid)`
Returns `jsonb`: `removed`, `was_role`, `availability_rules_cleared`.

Taking somebody off the firm takes them off the **front** of it too: `lawyer_public` is built from
`lawyer_profiles` and availability keys on the profile, not on membership, so a removed lawyer
would otherwise keep a public page and bookable slots forever. This deletes their availability
rules and exceptions, sets `lawyer_profiles.is_public = false`, then removes the membership.

Refuses:
- `not permitted` *(42501)*
- `that person is not a member of this firm`
- `you cannot remove yourself — ask another owner to do it`
- `only an owner can remove another owner` *(42501)*
- `this is the firm's last owner — appoint another owner first`
- `that lawyer has N consultation(s) still to come — reassign or cancel them first` — counted over
  `pending`, `awaiting_payment`, `confirmed` and `rescheduled` appointments from now on

### `request_firm_domain(p_firm uuid, p_hostname text, p_note text = null)`
Returns `jsonb`: `request_id`, `hostname`, `status` (always `requested`).

A firm cannot write `firms.custom_domain` and should not be able to. It asks; only Docket decides.

Refuses:
- `not permitted` *(42501)*
- `give the bare hostname you want, for example chambers.example.ng — no https://, no trailing slash`
- `that domain is already in use on Docket`
- `that domain has already been asked for and is being worked on`

### `withdraw_firm_domain_request(p_request uuid)`
Returns `void`. The only status a firm may set on its own request.

Refuses: `request not found` · `not permitted` *(42501)* · `that request is already <status>`

### `accept_staff_invite(p_token text)`
Returns `jsonb`: `firm_id`, `role`. **Who:** any signed-in person holding the token.

Joins the firm in the invited role and, for `lawyer`, `admin` and `owner`, opens a private
practitioner profile to complete. The email is matched against the **identity provider's** email
on the profile, never a typed one.

Refuses:
- `not authenticated` *(42501)*
- `invite invalid or expired`
- `this invite was sent to a different email address` *(42501)*

### `create_firm(p_name text, p_slug text, p_legal_name text = null, p_rc_number text = null, p_timezone text = 'Africa/Lagos', p_default_currency currency = 'NGN', p_reference_prefix text = null, p_state_code text = null, p_brand jsonb = '{}', p_owner_email text = null, p_owner_scn text = null)`
Returns `jsonb`. **Who:** any signed-in person for **themselves**. Passing `p_owner_email` — making
somebody else the owner — needs a platform admin with MFA.

Opens the firm as `pending`, makes the owner, opens their private practitioner profile with the
enrolment number, seeds the defaults through `seed_firm_defaults()`, and audits.

Refuses:
- `not authenticated` *(42501)*
- `only platform admins (with two-factor) can create a firm for someone else` *(42501)*
- `no account with that email yet — the owner must sign up first`
- `firm name is required`
- `invalid or reserved slug <slug>`
- `slug <slug> is already taken`
- `unknown timezone <tz>`
- `unknown state <code>`
- `this account already owns the maximum number of firms` — three

---

## 6. What a Docket operator may call

Every one requires `is_platform_admin() and mfa_ok()`, and every one audits.

A platform admin has **no row read** of `firms`, `notifications`, `payments`, matters, documents,
messages or updates. Migration 13 removed the last of it. Everything the operator sees comes from
`firm_admin`, `domain_requests`, `platform_notification_health`, `platform_settlement_health` and
`webhook_events` — see §9.

### `set_firm_status(p_firm uuid, p_status text, p_note text = null)`
Returns `void`. `pending` → `active` stamps `verified_at` and notifies the firm; `suspended` stops
every write at that firm at once, because `admin_w` and `staff_w` both consult
`firm_not_suspended()`.

Refuses: `not permitted` *(42501)* · `unknown status <status>` · `firm not found`

### `set_firm_plan(p_firm uuid, p_plan text, p_note text = null)`
Returns `void`. `free`, `standard` or `enterprise`.

Refuses: `not permitted` *(42501)* · `unknown plan <plan>` · `firm not found`

### `set_firm_domain(p_firm uuid, p_domain text, p_note text = null)`
Returns `void`. Passing `null` **unmaps** the firm's domain.

The hostname is validated against the same shape the middleware matches on — the incoming `Host`
lowercased with the port stripped — so a value that could never resolve is refused rather than
stored.

Refuses:
- `not permitted` *(42501)*
- `a custom domain is a bare hostname: no scheme, no port, no path, no trailing dot`
- `that hostname is too long` — over 255 characters
- `that domain is already mapped to another firm`
- `firm not found`

> This writes the database only. Postgres cannot make an outbound request, so it has no way to
> know whether the edge will answer for that hostname. Vercel must be told **first** — see
> `src/lib/providers/domains/vercel.ts` and `DEPLOYMENT_RUNBOOK.md`.

### `retry_notification(p_notification uuid)`
Returns `void`. Puts one failed message back in the queue with `send_after = now()` and
`attempts + 1`, and (migration 37) resets `send_attempts` and `failure_kind`, so the dispatcher's
own bounded retry cycle starts again. `attempts` is the operator's counter; `send_attempts` is the
dispatcher's.

Refuses:
- `not permitted` *(42501)*
- `notification not found`
- `only a failed notification can be sent again`
- `this notification has already been tried N times` — the ceiling is five attempts

### `set_provider_rate(p_provider text, p_channel channel, p_currency currency, p_unit_minor bigint, p_effective_from date = current_date, p_per_segment boolean = true, p_note text = null)`
Returns `void`. **Who:** a platform admin with MFA. Records what a provider (`resend`, `termii`,
`twilio`, `webpush`) charges per message — or per SMS segment — from the day given
(`provider_rates`, migration 37); the same provider, channel and day is replaced. Every message
accepted from then on carries `cost_minor` and `cost_currency` at the rate in force; a message
accepted with no rate is **unpriced**, never free. Audits `provider_rate.set`, which the platform
can read.

Refuses: `not permitted` *(42501)* · `unknown provider <p>` · `a rate is zero or more, in minor units`

### Reference data
There is no RPC. A platform admin with MFA writes `courts` (only rows with `firm_id is null`),
`court_rules` and `rule_provisions` (migration 38: the Rules of Court as entered — name, citation,
version, in force from and retired on; and each period under them — days or months, calendar,
clear or working, whether time stops in vacation, whether a last day rolls forward; audited,
readable by anyone),
`public_holidays` and `court_vacations` **directly**, under the policies migration 21 split.
`public_holidays` is keyed by its unique index on `(country, on_date, coalesce(state_code, ''))`,
not by its id — an upsert must target that, not the primary key.

---

## 7. Internal — no grant to anybody

These run inside other functions and triggers. `EXECUTE` is revoked from `public`, `anon` **and**
`authenticated`; they are not reachable over the API. They are documented because they are what
writes the audit trail and the notification queue.

| Function | Does |
|---|---|
| `audit(p_action, p_entity, p_entity_id, p_firm, p_meta = '{}')` | the only writer of `audit_log`, which is otherwise append-only by grant |
| `next_reference(p_firm uuid, p_kind text) → text` | the per-firm, per-year counter behind `AK-2026-000123`. Reads `firms.reference_prefix` **live**, which is why changing the prefix mid-year splits one year's numbering across two prefixes |
| `enqueue_notification(p_user, p_firm, p_event, p_payload, p_send_after = now())` | one row per channel in `notifications`, honouring the recipient's channel preferences and quiet hours. Migration 37: the row carries `dedupe_key` (person, channel, event, the payload, the UTC day) under a unique index, so the same message to the same person is one row a day — a producer that fires twice, or a cron that runs twice, makes one |
| `notification_dedupe_key(p_user, p_channel, p_event, p_payload)` | that key |
| `claim_notifications(p_limit = 50)` | **the dispatcher's, as the service role only** (no API role may execute it, and a caller with a session is refused): marks up to `p_limit` due rows `sending` under `FOR UPDATE SKIP LOCKED` — two runs never take the same row — counting a `send_attempt`, and returns each with its recipient and firm. A claim older than ten minutes is put back first; a `whatsapp` row is skipped |
| `finish_notification(p_id, p_outcome, p_provider, p_provider_ref, p_error, p_failure_kind, p_segments, p_cost_minor, p_cost_currency)` | the dispatcher's, as above. `sent`: the provider took it — `accepted_at`, `delivery_status = 'accepted'`, its message id, the segments and the cost. `failed` + `transient`: back in the queue after 2, 4, 8, 16 minutes, then failed for good; `failed` + `permanent`: failed now. `skipped`: not sent, with the reason |
| `record_delivery_receipt(p_provider, p_provider_ref, p_status, p_at = now(), p_note)` | the receipts function's, as the service role only: finds the notification by the provider's message id and writes `delivered` (with `delivered_at`), `bounced`, `undelivered`, or a `note` that decides nothing. Returns the notification id, or null when no message carries that id |
| `current_provider_rate(p_provider, p_channel)` | the rate in force today, for the dispatcher |
| `enqueue_firm_notification(p_firm, p_event, p_payload, p_roles = {owner,admin})` | the same, to every member of a firm in those roles |
| `seed_firm_defaults(p_firm uuid)` | matter statuses, one inactive unpriced consultation, a consultation intake form, and a `0-draft` policies skeleton. Idempotent |
| `record_payment(p_provider, p_provider_ref, p_invoice_number, p_amount_minor, p_currency, p_status, p_raw = '{}', p_subaccount = null)` | **service role only** — the Paystack webhook. See below |

### `record_payment` in detail
Idempotent on `provider_ref`: a repeated delivery returns `{"duplicate": true, …}` and changes
nothing. A `succeeded` charge reported against a subaccount that is **not** the firm's own — or
against a firm that has none — is recorded as a `failed` payment carrying
`settlement_mismatch`, `reported_subaccount` and `expected_subaccount`, audited as
`payment.settlement_mismatch`, and reported to the firm. **It confirms nothing**: no invoice is
paid and no appointment is confirmed. Otherwise a succeeded payment increases `paid_minor`, moves
the invoice to `partially_paid` or `paid`, confirms the held appointment and notifies the client.

Refuses: `unknown invoice <number>` · `currency mismatch on invoice <number>`

---

## 8. Scheduled jobs

`EXECUTE` revoked from every API role. `pg_cron` runs them as the database owner. Each returns the
number of rows it touched.

| Function | Schedule | Does |
|---|---|---|
| `release_expired_holds()` | every minute | frees a 15-minute booking hold that was never paid |
| `enqueue_appointment_reminders()` | every minute | the reminder ladder before a consultation |
| `enqueue_court_reminders()` | 07:00 daily | reminders for upcoming court dates |
| `enqueue_deadline_reminders()` | 06:00 daily | `deadline_due_t7` / `_t1` / `_t0` to the matter's lawyers for a **confirmed** deadline, each once (migration 38) |
| `mark_overdue_invoices()` | 00:15 daily | `issued` past its due date becomes `overdue` |
| `digest_sittings_without_update()` | 07:30 daily | the chase list: a court date whose day has passed with no update posted |

A sixth job, `docket-dispatch-notifications`, is scheduled by migration 9 and is not a function in
this schema: it is `net.http_post` to the dispatcher Edge Function, reading `dispatch_url` and
`cron_secret` out of Vault. **Until both Vault secrets exist the job runs every minute and posts
nothing**, so no message is ever sent and nothing says so.

---

## 9. Views

Views are read-only for API roles: `insert`, `update`, `delete` and `truncate` are revoked on every
one of them.

| View | Who sees rows | Holds |
|---|---|---|
| `firm_public` | anyone, including `anon` | **active** firms only: id, slug, name, legal name, brand, policies, custom domain, timezone, currency, `verified`. A `pending` firm is absent — read `firms` directly for a firm setting itself up |
| `lawyer_public` | anyone | published practitioner profiles |
| `firm_service_directory` | firm staff | active firms' addresses for service and whether they accept platform service |
| `firm_admin` | platform admins | the platform's **whole** read of firms: lifecycle, plan, RC number, state, `has_settlement_account`, member count, owners with their enrolment numbers, `policies_published` |
| `firm_overview` | firm members | the console's one-round-trip summary. Money is kept **per currency** in a jsonb object; minor units of two currencies are never added |
| `firm_sittings_due` | firm members | court dates whose day has passed with no update posted. Clears when `post_court_update()` runs |
| `firm_cause_list` | firm members | today's sittings by court — and (38) where each came from: `source_document_id`, `source_ref`, `created_by`, `confirmed_by`, `evidenced` |
| `firm_deadlines` | staff who can see the matter | every deadline with its matter beside it (reference, cause title, court). No client policy exists on `deadlines`: a client reads none of it |
| `service_inbox` | the served firm | the served firm's **only** read path — never the `process_service` row, the serving firm's note, its proof, or its `documents` row |
| `partner_attribution` | firm members | originating and handling partner attribution |
| `reference_data_coverage` | any signed-in user | how far the reference data reaches: holidays through which year, upcoming vacations, vacations through which date, platform court count |
| `platform_notification_health` | platform admins | the queue **grouped** by firm, status, channel and event: counts, oldest and newest, how many are overdue, most attempts, one representative error, and (migration 37) how many are accepted, delivered, bounced and undelivered, and the most dispatcher sends. **Never the payload and never the recipient** |
| `platform_failed_notifications` | platform admins | one row per failed message, so it can be retried: id, firm, channel, event, attempts, error, when — and (37) `failure_kind`, `send_attempts`, `provider`. No payload, no recipient |
| `platform_notification_cost` | platform admins | what went out, per firm and month, by provider, channel and **currency**: messages, segments, `cost_minor` at the rates entered, and how many were unpriced. Naira and dollars are never summed |
| `platform_firm_active_matters` | platform admins | each firm's count of open matters — the denominator for cost per active matter, and the one new per-firm number the platform reads (a count, stated as a disclosure in migration 37's header) |
| `platform_settlement_health` | platform admins | payments that are not `succeeded`: invoice number, amount, currency, both Paystack subaccount codes, `settlement_mismatch`. A deliberate narrowing of "platform admins never see matter content" — reconciling a mis-settled charge is impossible without it. No line items, no matter, no client |
| `webhook_events` (table) | platform admins | what a provider sent, whether the signature verified, what Docket did. Written only by the Edge Function with the service role; `insert`, `update` and `delete` are revoked from `anon` and `authenticated`, so it is append-only exactly like `audit_log` |

---

## 10. Trigger functions

Every function in `public` returning `trigger` had `EXECUTE` revoked from `public`, `anon` and
`authenticated` by migration 21. Postgres refuses to run a trigger function outside a trigger
anyway, so nothing could ever be done with them — but they had no business being on the API
surface. The triggers themselves are unaffected: they run as the table owner and do not consult
`EXECUTE` grants.

They are listed because their refusals reach a user, and look like they came from the statement
that fired them:

| Trigger function | On | Refuses with |
|---|---|---|
| `guard_firm_lifecycle_columns()` | `firms` | `status, plan, verification, slug and custom domain are set by the platform` *(42501)* |
| `firms_validate_brand()` → `validate_brand(jsonb)` | `firms.brand` | **nothing.** It silently keeps only `tagline`, `cta`, `logo_path`, `colours.primary/accent/surface` as six-digit hex, `fonts.heading/body` (letters, digits and spaces, 40 characters) and `contact.email/phone/address/whatsapp`. Everything else is dropped with no error — re-read the row after writing to find out what survived |
| `validate_policies()` | `firms.policies` | **nothing.** Keeps `privacy`, `terms`, `engagement` and `cancellation`, each with its **own** `version`, plus `title`, `text`, an `https://` `url` and a numeric `free_cancel_hours`; strips `<` and `>`; drops any other document. A top-level `version` is kept but is read by nothing |
| `validate_notification_templates()` | `firms.notification_templates` | **nothing.** Keeps `{subject, text}` per event key, strips angle brackets, and drops any entry whose `text` is empty |
| `check_staff_invite_role()` | `staff_invites` | `only an owner may invite another owner` *(42501)* |
| `guard_appointment_confirm()` | `appointments` | `this firm confirms a consultation only once what it asked for is in — <items>` — only with `firms.checkin_before_confirm` on |
| `guard_conflict_clearance()` | `matter_parties` | `this firm requires a cleared conflict check before a client joins a matter` — only with `firms.conflict_checks_required` on, only for `role = 'client'`, on insert and on any update that moves the row (migration 33) |
| `check_row_firm()` on `import_rows` | `import_rows` | `row does not belong to the firm that owns the matter` |
| `guard_document_request()` | `document_requests` | `a withdrawn request stays withdrawn — ask again with a new request` · `an answered request cannot be withdrawn` |
| `guard_matter_team()` | `matter_lawyers` | `this is the last member of a restricted matter's team — set the matter to firm-wide first, or add someone else` *(42501)* — on delete, and on an update that moves the row off the matter |
| `check_row_firm()` | every matter-linked table | `row does not belong to the firm that owns the matter` · `row does not belong to the firm that owns the appointment` |
| `check_matter_court()` | `matters` | `court <id> is not available to this firm` |
| `check_court_visible()` | court-bearing rows | `court <id> is not available to this firm` |
| `check_matter_counsel()` | `matter_counsel` | `counsel rows belong to the firm that owns the matter` · `this counsel has been served through Docket — record new counsel as a new row` |
| `check_process_service_refs()` | `process_service` | `proof of service must be one of your firm's documents` · `the order for substituted service must be one of your firm's documents` |
| `normalise_scn()` | `lawyer_profiles` | `this enrolment number cannot be registered — contact Docket support` · `SCN verification is recorded by the platform` *(42501)* |
| `audit_row_change()` | several tables | never refuses; writes `audit_log` |
| `handle_new_user()` | `auth.users` | never refuses; opens the `profiles` row |
| `document_version_set_current()` | `document_versions` | never refuses; points `documents.current_version_id` at the newest version |
| `notify_matter_update()`, `notify_appointment_status()`, `notify_message()`, `notify_document_request()` | their tables | never refuse; enqueue notifications (`document_requested` goes to every party on the matter) |

**The three silent rewrites are the ones that bite.** `brand`, `policies` and
`notification_templates` are all stored differently from how they were sent, with no error. Any
screen that writes one of them must re-read the row afterwards and tell the person what was
dropped — `src/lib/actions/firm-settings.ts` does exactly that.

---

## 11. Writes with no RPC

Not everything needs a function. These are plain table writes, guarded by policy:

| Table | Policy | Note |
|---|---|---|
| `services` | `admin_w(firm_id)` | insert, update and delete are three separate policies since migration 21 |
| `intake_forms` | `admin_w(firm_id)` | **`schema` has no database validation at all.** A malformed shape is accepted and the booking wizard then shows the client nothing. Validate it in the action |
| `staff_invites` | `admin_w(firm_id)` **and** `created_by = auth.uid()` | plus `check_staff_invite_role()` for the owner rule |
| `firms` | `admin_w(id)` | but never `status`, `plan`, `verified_at`, `slug` or `custom_domain` — `guard_firm_lifecycle_columns()` raises 42501 |
| `matter_statuses`, `content` | `admin_w(firm_id)` | |
| `matters`, `tasks`, `updates`, `documents`, `messages`, `invoices`, `invoice_items`, `court_events`, `matter_parties`, `matter_lawyers`, `matter_court_numbers`, `conflict_checks`, `invites`, `consultation_notes`, `consultation_internal_notes` | `staff_w(firm_id)` | |
| `availability_rules`, `availability_exceptions`, `lawyer_profiles` | own row with `staff_w`, or `admin_w` | a lawyer keeps their own diary; an administrator may edit anybody's |
| `domain_requests` | update only, `is_platform_admin() and mfa_ok()` | a firm inserts through `request_firm_domain()` and can only reach `withdrawn` |
| `consent_records` | insert where `user_id = auth.uid()` | append-only in practice: there is no update or delete policy |
| `notification_preferences`, `push_subscriptions` | `user_id = auth.uid()` | |
| `rate_limits`, `firm_counters` | **no policy at all** | only definer functions touch them |
| `audit_log` | select only | `insert`, `update` and `delete` are revoked from every API role; `audit()` is the only writer |
| `ng_states` | select, `true` | RLS enabled with a permissive read since migration 21; writes revoked |

**An `INSERT` with `.select()` fails** wherever the SELECT policy reads the same table — PostgREST
asks for the row back and the policy has not been satisfied yet. Generate the uuid client-side
with `crypto.randomUUID()` and insert without returning; read it back in a second query.

---

## The README edit this file replaces

`docs/RPC_REFERENCE.md` is now the reference. `README.md` still carries a 30-row
"## Server functions (RPC)" table that duplicates it and is already out of date — it has no
`set_firm_domain`, `set_firm_plan`, `request_firm_domain`, `withdraw_firm_domain_request`,
`set_member_role`, `remove_member`, `retry_notification` or `rate_limit_hit`.

**Replace the whole of `## Server functions (RPC)` in `README.md` — the heading, the table and
every row of it, from the line `## Server functions (RPC)` down to the blank line before
`## Decisions still open before launch (blueprint §14)` — with these four lines:**

```markdown
## Server functions (RPC)

Every security-definer function — its signature, who may call it, and the exact words it refuses
with — is in **[docs/RPC_REFERENCE.md](docs/RPC_REFERENCE.md)**, together with the views, the
scheduled jobs, the trigger functions and the writes that need no RPC.
```
