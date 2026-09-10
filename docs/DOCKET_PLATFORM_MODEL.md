# Docket — the platform model

*Docket is to Nigerian law firms what an electronic-health-records platform is
to clinics: one system the whole profession can run on, where each firm has its
own front door and its own records, and every patient — here, every client —
keeps one chart. Attorneys Klinique is the first firm on it, not the reason the
software exists.*

This document is the platform view that the v0.2 blueprint (written from
Klinique's requirements) lacked. It records who Docket is for, what makes it
Nigerian, how any firm gets on it, and what is built versus scheduled.
Decision [0003](decisions/0003-platform-first.md) is the short form.

## 1. Four parties, one record

| Party | What they get from Docket | Where it lives |
|---|---|---|
| **The client** (in Asaba, Lagos or Atlanta) | "Tell us → Book → Pay → Meet → Track." One app across every firm acting for them: every court sitting explained within 24 hours, every process served on their behalf visible, every invoice payable in-app, receipts and documents in one place. | `/app` client PWA; merged feed via RLS on `matter_parties` |
| **The firm** (any size, any state) | A branded public site and booking funnel, Paystack settlement to its own account, virtual consultations, matters against the real court hierarchy, the 30-second court-update form, documents, messaging, invoicing, audit log — and a network: serve counsel on Docket and get an acknowledgement; receive processes into an inbox. Free for three lawyers or fewer. | `/firm` console; `firms`, `firm_members`, `courts`, `matter_counsel`, `process_service` |
| **The courts** | Matters recorded with proper suit numbers (normalised match key, several numbers over a matter's life) against a shared directory of courts and judicial divisions; sittings captured structurally (outcome, at whose instance, next date, purpose kind, judge, courtroom, source); hearing notices and adjournments sine die; vacated dates refixed without phantom reminders; a firm-side cause list per court and day; processes served with a timestamped, named acknowledgement; hearing dates that respect public holidays and published vacations. Phase 2: cause-list ingestion and e-filing where a judiciary offers it. | `courts`, `court_events`, `matter_court_numbers`, `post_court_update()`, `vacate_court_event()`, `firm_cause_list`, `is_non_sitting_day()` |
| **Other firms / counsel** | Recorded as counsel of record on the other side, with the party they act for and whether they have undertaken to accept service. Firms that opt in are served non-originating processes through the platform; they acknowledge in one tap, file the process against their own matter with a response date, and see exactly the version served — nothing else. Originating processes still go to the party (or to counsel under an undertaking, or by an order for substituted service). The in-app acknowledgement is evidence of receipt: it supports the affidavit of service where the rules require one, and stands as counsel's endorsed acknowledgement where counsel accepts service. | `matter_counsel`, `service_inbox`, `/firm/inbox`, `acknowledge_service()`, `link_service_to_matter()` |
| **The platform operator** | Firm lifecycle (create, suspend, plans, domains, health) with **no** access to any matter content — enforced by the absence of policies, not by policy. | `/admin`, `platform_admins`, `is_platform_admin()` |

## 2. What makes it Nigerian (built)

- **Courts as data.** `court_level` covers the hierarchy from the Supreme Court
  through the Court of Appeal's twenty judicial divisions, the Federal High
  Court and State High Courts (Lagos and the FCT with their own judicial
  divisions and prefixes — LD, ID, IKD, ED, BD; Maitama, Apo, Gudu …), the
  National Industrial Court, the Sharia and Customary Courts of Appeal,
  magistrates', district, customary, area and sharia courts, statutory
  tribunals and the multi-door courthouses. The platform seeds the shared
  directory; a firm adds the specific magistrate court or panel it appears
  before as a private row. Each court carries a suit-number hint in that
  registry's format, in both styles where two are in circulation
  (`FHC/L/CS/123/2026`, `CA/LAG/CV/123/2026` or `CA/L/123/2026`,
  `LD/1234GCM/2026`, `NICN/LA/123/2026`, `FCT/HC/CV/123/2026`). Registry
  numbers reset yearly and are never unique across courts, and a matter
  collects several over its life (trial, appeal, Supreme Court, consolidated)
  — `matter_court_numbers` holds them.
- **The court-update vocabulary** is the one lawyers use: hearing held,
  adjourned *at the instance of* the claimant / defendant / prosecution /
  court, ruling, judgment, struck out, stood down, mention, court did not sit.
- **Legal-year awareness.** `public_holidays` (Public Holidays Act: fixed
  dates and Easter seeded for 2026–2027, `observed_on` when the Federal
  Government shifts one, state-declared holidays scoped to their state, Eid
  dates added when declared) and `court_vacations` (each court's annual,
  Christmas and Easter vacation from its practice direction, with whether
  time runs — nothing invented; the table is empty until the operator enters
  each court's practice-direction dates). `post_court_update()` refuses a next
  date that is not a sitting day unless told the vacation judge will sit — only
  weekends and holidays until vacations are entered.
- **The practitioner.** Supreme Court enrolment number (unique across the
  platform, normalised, verified by the platform), year of call, NBA branch,
  the NBA stamp-and-seal serial for the practising year and the year the
  practising fee was last paid; year of call is the one fact shown publicly.
  RC/BN number, TIN, state of principal office and an address for service on
  the firm.
- **36 states + FCT** with ISO codes and geopolitical zones, for addresses,
  jurisdiction and the public site.
- **Money and identity.** Naira in kobo, Paystack (cards, bank transfer,
  USSD) settling to the firm; phone-OTP sign-in for Nigerian lines and
  email for the diaspora; `+234` normalisation in `src/lib/nigeria.ts`.
- **Practice areas that match the work:** property (C of O, Governor's
  Consent, deeds), CAC incorporation, debt recovery, immigration-related
  advisory, and now criminal and arbitration matter types.
- **Compliance posture:** NDPA 2023 consent records per firm (every firm
  starts with a versioned policies skeleton, and clients are not asked to
  consent to unpublished drafts), the operative Rules of Professional Conduct
  on advertising (factual profiles, no superlatives), no fee-sharing (firms
  pay SaaS, never a share of fees), client money never held by the platform
  (each firm's fees settle to its own Paystack subaccount and the database
  refuses a settlement anywhere else), service of process modelled on what
  the civil procedure rules actually accept.

## 3. How any firm gets on Docket

1. **Register** at `/firm/start`: account (email + password), then firm name,
   web address (`{slug}.docket.app`), registered name, RC number, state,
   primary colour → `create_firm()` makes you owner and seeds defaults. The
   firm is *pending*: the console works, the public site does not yet.
2. **Two-factor** (authenticator app) — required before the console opens and
   before the database accepts any staff write.
2a. **Verification.** A platform admin checks the RC/BN number and the owner's
   enrolment number and activates the firm from `/admin`; it then appears on
   `firm_public` (marked verified) and can take bookings once it has a
   Paystack subaccount.
3. **Settings** (`/firm/admin`, slice 5): brand, policies (terms, privacy,
   cancellation, disclaimer — versioned; clients consent to the versions),
   VAT rate, custom domain.
4. **Services and availability**: price the consultation (it is seeded
   inactive at ₦0 so nothing fake goes live), add services, set each lawyer's
   working hours, breaks and daily cap.
5. **Lawyers and clients**: invite lawyers and staff by email
   (`staff_invites` → `accept_staff_invite()`); open matters, invite clients by
   phone or email (`invites`), or let the booking funnel create them. Opt in to
   receiving service through Docket (`accepts_platform_service`) and record
   the firm's address for service.

Klinique differs in one respect: `supabase/seed.sql` inserts it already active
and verified (the founders are the platform) and then calls the same
`seed_firm_defaults()`; its owners and Paystack subaccount are attached as in
steps 4–5. A second firm needs no SQL.

## 4. Built now vs scheduled

| Capability | Status | Where |
|---|---|---|
| Self-serve firm registration, defaults, owner role | **Built** (migration 9, `/firm/start`) | slice 0/1 |
| Platform admin: list, create for owner, suspend | **Built** (`/admin`) | health & domains in slice 5 |
| Court directory, states, holidays, vacations | **Built** (migration 10) | court picker UI in slice 4 |
| Counsel roster, service of process (version-pinned, opt-in, undertakings, orders, revocation), acknowledgement, inbox, link-to-own-matter | **Built** in the database (migrations 11–12) | UI in slice 4 |
| Fees settle to each firm's Paystack subaccount; platform verification before a firm goes public; staff invites | **Built** (migration 12, adapters, `/admin`) | subaccount creation UI in slice 5 |
| Post-court-update form with non-sitting-day warning | RPC built; form in slice 4 | slice 4 |
| Hearing notices as documents; affidavit of service as `proof_document_id` | schema ready | slice 4 |
| Cause-list ingestion; judiciary e-filing (Lagos, FHC) | Phase 2 — no public APIs today; build on `courts` + `court_events` | Phase 2 |
| Firm-to-firm messaging beyond service | Phase 2 | Phase 2 |
| Eid dates, per-state Sharia/Customary Courts of Appeal, per-court vacation calendars | platform data entry as published | ongoing |

## 4a. The invariants a reviewer should hold us to

- The served firm's only read path is `service_inbox`; its access is keyed on
  `process_service.served_firm_id` (set once, only for platform service) and
  on the exact `document_version_id` served; it can never upload into the
  serving firm's folder (`can_upload_document` has no served branch).
- Platform admins read `firm_admin` and call `set_firm_status()`; there is no
  row-level write on `firms` for them and no policy on any content table.
- `lawyer_profiles` is member-only; the public site reads `lawyer_public`.
- A suspended firm's staff cannot write; a pending firm is invisible to the
  public; an inactive firm can neither serve nor be served.
- Every suit-number hint is a verified registry format or null. Every holiday
  and vacation date is entered from a gazette or practice direction.
- Rows on matter-linked tables belong to the firm that owns the matter; views
  are read-only; API roles cannot TRUNCATE.
- A payment applies only when Paystack reports the firm's own subaccount;
  anything else is recorded as a flagged failure and reported, never retried.

## 5. What is Klinique-specific

Only data: its slug, brand, policies text, fourteen services and its own
intake questions in `supabase/seed.sql`; its requirements document and the
reconciliation in `docs/`. Its partnership needs (originating vs handling
partner, firm overview) were generalised into migration 5 and the slice 4
console because every partnership has them.
