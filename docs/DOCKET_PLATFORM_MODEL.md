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
| **The courts** | Matters recorded with proper suit numbers against a shared directory of courts and divisions; sittings and adjournments captured structurally (outcome, at whose instance, next date, purpose); processes served with a timestamped acknowledgement; hearing dates that respect public holidays and published vacations. Phase 2: cause-list ingestion and e-filing where a judiciary offers it. | `courts`, `court_events`, `post_court_update()`, `is_non_sitting_day()` |
| **Other firms / counsel** | Recorded as counsel of record on the other side; served through the platform instead of by bailiff; acknowledge in one tap; see only what was served on them. | `matter_counsel`, `service_inbox`, `acknowledge_service()` |
| **The platform operator** | Firm lifecycle (create, suspend, plans, domains, health) with **no** access to any matter content — enforced by the absence of policies, not by policy. | `/admin`, `platform_admins`, `is_platform_admin()` |

## 2. What makes it Nigerian (built)

- **Courts as data.** `court_level` covers the hierarchy from the Supreme Court
  through the Court of Appeal divisions, the Federal High Court and State High
  Courts, the High Court of the FCT, the National Industrial Court, the Sharia
  and Customary Courts of Appeal, magistrates', district, customary, area and
  sharia courts, statutory tribunals and the multi-door courthouses. The
  platform seeds the shared directory; a firm adds the specific magistrate
  court or panel it appears before as a private row. Each court carries a
  suit-number hint in that registry's format (`FHC/L/CS/123/2026`,
  `CA/L/123/2026`, `LD/1234GCM/2026`, `NICN/LA/123/2026`).
- **The court-update vocabulary** is the one lawyers use: hearing held,
  adjourned *at the instance of* the claimant / defendant / prosecution /
  court, ruling, judgment, struck out, stood down, mention, court did not sit.
- **Legal-year awareness.** `public_holidays` (Public Holidays Act, fixed
  dates seeded; Eid dates added when the Federal Government declares them) and
  `court_vacations` (each court's annual, Christmas and Easter vacation, from
  its practice direction — nothing invented). `is_non_sitting_day()` lets the
  update form warn when a next date falls on a weekend, holiday or vacation.
- **The practitioner.** Supreme Court enrolment number, year of call and NBA
  branch on the lawyer profile; year of call is the one fact shown publicly.
  RC/BN number, TIN and state of principal office on the firm.
- **36 states + FCT** with ISO codes and geopolitical zones, for addresses,
  jurisdiction and the public site.
- **Money and identity.** Naira in kobo, Paystack (cards, bank transfer,
  USSD) settling to the firm; phone-OTP sign-in for Nigerian lines and
  email for the diaspora; `+234` normalisation in `src/lib/nigeria.ts`.
- **Practice areas that match the work:** property (C of O, Governor's
  Consent, deeds), CAC incorporation, debt recovery, immigration-related
  advisory, and now criminal and arbitration matter types.
- **Compliance posture:** NDPA 2023 consent records per firm, the operative
  Rules of Professional Conduct on advertising (factual profiles, no
  superlatives), no fee-sharing (firms pay SaaS, never a share of fees),
  client money never held by the platform.

## 3. How any firm gets on Docket

1. **Register** at `/firm/start`: account (email + password), then firm name,
   web address (`{slug}.docket.app`), registered name, RC number, state,
   primary colour → `create_firm()` makes you owner and seeds defaults.
2. **Two-factor** (authenticator app) — required before the console opens and
   before the database accepts any staff write.
3. **Settings** (`/firm/admin`, slice 5): brand, policies (terms, privacy,
   cancellation, disclaimer — versioned; clients consent to the versions),
   VAT rate, custom domain.
4. **Services and availability**: price the consultation (it is seeded
   inactive at ₦0 so nothing fake goes live), add services, set each lawyer's
   working hours, breaks and daily cap.
5. **Lawyers and clients**: invite staff; open matters, invite clients by
   phone or email (`invites`), or let the booking funnel create them.

Klinique followed the same path with its data supplied by `supabase/seed.sql`
instead of typed into forms. A second firm needs no SQL.

## 4. Built now vs scheduled

| Capability | Status | Where |
|---|---|---|
| Self-serve firm registration, defaults, owner role | **Built** (migration 9, `/firm/start`) | slice 0/1 |
| Platform admin: list, create for owner, suspend | **Built** (`/admin`) | health & domains in slice 5 |
| Court directory, states, holidays, vacations | **Built** (migration 10) | court picker UI in slice 4 |
| Counsel roster, service of process, acknowledgement, inbox | **Built** in the database (migration 11) | UI in slice 4 |
| Post-court-update form with non-sitting-day warning | RPC built; form in slice 4 | slice 4 |
| Hearing notices as documents; affidavit of service as `proof_document_id` | schema ready | slice 4 |
| Cause-list ingestion; judiciary e-filing (Lagos, FHC) | Phase 2 — no public APIs today; build on `courts` + `court_events` | Phase 2 |
| Firm-to-firm messaging beyond service | Phase 2 | Phase 2 |
| Eid dates, per-state Sharia/Customary Courts of Appeal, per-court vacation calendars | platform data entry as published | ongoing |

## 5. What is Klinique-specific

Only data: its slug, brand, policies text, fourteen services and its own
intake questions in `supabase/seed.sql`; its requirements document and the
reconciliation in `docs/`. Its partnership needs (originating vs handling
partner, firm overview) were generalised into migration 5 and the slice 4
console because every partnership has them.
