# Klinique master prompt ↔ Docket — reconciliation

The [master prompt](Attorneys_Klinique_Partner_Platform_Prompt.md) is the source
requirements document from Attorneys Klinique (7 partners, one pooled firm).
`Docket_Build_Blueprint_v0.2.md` is the architecture derived from it, and
slice 0 (this repo) implements the blueprint's foundation. This note records,
section by section, what is already covered, what the blueprint **deliberately
changed** and why, and what was genuinely missing and has now been added or
scheduled.

**TL;DR** — about 80% of the master prompt maps directly onto the slice plan.
Two provider choices diverge on purpose (Daily instead of Google Meet, Supabase
Storage instead of Google Drive — see "Open decisions"). The partnership-pooling
requirements were the real gap: originating/handling attribution is now in the
schema (migration 5), and the Firm Overview, partner-to-partner messaging and
per-partner reporting are slotted into slices 4–5.

## Already covered by slice 0 + the slice plan

| Master prompt | Where it lives |
|---|---|
| §3 roles (visitor/client/partner/admin) | `firm_role` (`owner/admin/lawyer/staff`) + `matter_parties`; partners are `lawyer` members, admins hold `admin`/`owner` on top |
| §3C "every partner sees the whole firm" | RLS is pooled by design: any active firm member reads **all** firm matters, clients, documents, payments — no per-partner silos |
| §3C partner 2FA / §29 | Stronger than asked: TOTP is *enforced* — staff writes are rejected below `aal2` at the database (RLS), not just at login |
| §6 admin-configurable services | `services` table (name, price, duration, modes, active); seeded, never hard-coded |
| §7 registration, consent | `profiles`, `consent_records` with versions from `firms.policies` |
| §9 booking, statuses, double-booking | `book_appointment()` + `available_slots()`; GiST exclusion constraint makes double-booking impossible even in a race; "any available partner" is a frontend union over `available_slots` per lawyer |
| §10 Paystack, server-side verification only | `paystack-webhook` (HMAC + API re-verification) → `record_payment()`; the callback page never writes; adapter interface ready for Flutterwave |
| §12 waiting experience | Slice 2: waiting room with knocking — client literally cannot enter until the lawyer admits |
| §13 notes (client-visible vs internal) | `consultation_notes` + `consultation_internal_notes`; internal has **no client policy at all** |
| §14–15 matters, custom statuses, timeline | `matters`, `matter_statuses` (per-firm, admin-editable), `updates` timeline with `visibility` |
| §17 messaging | `messages` (matter-linked, attachments, read receipts, Realtime) — partner↔partner DMs are the one gap (below) |
| §18–19 notifications & reminder cadence | Outbox + `dispatch-notifications` (in-app/email/SMS/push, preferences, quiet hours); reminders at exactly 24h/1h/10m/now |
| §21 availability | `availability_rules` (days, hours, breaks, duration, caps) + exceptions; UTC storage, per-viewer rendering |
| §23 invoicing | `invoices`/`invoice_items` (statuses incl. `partially_paid`), VAT, PDF in slice 1 |
| §24 intake with conditional questions | `intake_forms.schema` with `show_if`; file uploads |
| §25–26 conflict checks, global search | Phase 2 in both documents — no drift |
| §27 audit log | Append-only `audit_log`, enforced against every role including `service_role` |
| §28, §30, §31, §48–50 security, NDPA, data architecture, env, backups | RLS everywhere, UUIDs, FK+indexes, soft-delete on matters, `.env.example`, PITR + runbooks in slice 5 |
| §34 mobile | Mobile-first PWA, bottom nav Home·Appointments·Matters·Messages·Profile — verbatim in slice 3 |
| §56 Phase 1 / Phase 2 split | Matches the 90-day slice order almost 1:1 |

## Deliberate divergences (blueprint decisions, revisit if wanted)

**Video — Daily, not Google Meet (§11, §43).** The master prompt itself
concedes "or opens Meet directly if embedding is restricted by Google's
policies" — and it is: Google Meet cannot be iframed, so a Meet build means
leaving the portal for meet.google.com in every consultation, and §12's
"waiting for your lawyer" room and §43's per-user access control can't be
fully honoured (Meet guests are managed by Google's own knock UI under
Google's account rules, and links require a Workspace + Calendar service
account). Daily delivers exactly what §§11–12, 43–44 ask for *inside* the
portal: unique private room per appointment, per-user expiring tokens,
knocking, no recording, rooms die after expiry. The `VideoProvider` adapter
means a Meet implementation could still be swapped in later, at the cost of
the embedded experience.

**Documents — Supabase Storage, not Google Drive (§16).** Drive would make
Drive ACLs a second authorization system that must be kept in sync with the
database on every party change — breaking the platform's core rule that *the
database is the single source of truth for access*, and putting client files
under a Google Workspace account outside the audit log. Supabase Storage
policies derive from the *same* RLS as everything else (a file is visible iff
its `document_versions` row is), paths carry the tenant, previews use short
signed URLs, and `document_versions` gives uploader/timestamp/versioning that
§16 asks the portal to track anyway. Folder-categories, previews and the
upload UX arrive in slices 3–4.

**One firm vs multi-tenant.** The master prompt describes a Klinique-only
system; Docket is multi-tenant with Klinique as tenant #1. Multi-tenancy is a
strict superset — Klinique gets its own branded site, portal and console, and
nothing in the master prompt is lost. (It also makes "7 partners" a
configuration, not a constant: partners are simply the firm's `lawyer`/`admin`
members, so partner #8 is an insert, not a migration.)

**Payments.** Master prompt: Paystack, NGN, multi-currency later. Blueprint
adds Stripe for USD now. Superset; nothing to reconcile.

## Gaps found — now closed or scheduled

1. **Originating vs handling partner (§10, §14, §22) — closed.** Migration
   `20260909000005_partner_attribution.sql` adds
   `matters.originating_lawyer_id` and `matters.handling_lawyer_id`
   (backfilled from the lead lawyer) and the `partner_attribution` view: one
   row per succeeded payment with both attributions resolved — matter
   invoices from the matter, consultation invoices to the consulting lawyer —
   under the caller's own RLS. Profit-sharing numbers come straight out of
   `select … from partner_attribution group by originating_lawyer_id`.
   The 52-check suite still passes.
2. **Firm Overview (§4, §20) — scheduled into slice 4.** The data layer needs
   nothing new (pooled RLS already exposes it all); the staff console gets:
   the side-by-side firm calendar, the firm activity feed (a Realtime query
   over `updates`/`payments`/`appointments`), firm-wide totals, and the
   originated-vs-handling column on the matter list. Treat §4 as an addendum
   to the slice 4 prompt in `BUILD_PROMPTS.md`.
3. **Partner-to-partner messaging (§17) — scheduled into slice 4.** Current
   messaging is matter-threaded with clients. Internal partner DMs need a
   small addition (a thread type without a client party) — schema room
   exists; decide in slice 4 whether internal matter notes (`updates` with
   `visibility = 'internal'`) already cover the need.
4. **Per-partner admin analytics (§22) — scheduled into slice 5** on top of
   `partner_attribution` and PostHog.
5. **Seven partner profiles (§3C: Ola, Benjamin, Mikrabel, Meke, Mcking, Ada,
   +1) — onboarding data, not schema.** Partner accounts need real
   emails/phones for auth + TOTP, so they are created at Klinique onboarding
   (slice 5 gate), not seeded as fake users — the no-placeholder-auth rule.

## Open decisions (for Precious / the partners)

- **Confirm Daily over Google Meet**, or accept the out-of-portal Meet
  experience. This gates slice 2.
- ~~Confirm Supabase Storage over Google Drive~~ — **DECIDED**: Supabase
  Storage is the system of record; the optional one-way Drive mirror is
  specced as a Phase 2 add-on, off by default. See
  [decision 0001](decisions/0001-document-storage.md). Slice 3 is unblocked.
- The blueprint §14 list still stands: domain, entities, VAT, prices.
