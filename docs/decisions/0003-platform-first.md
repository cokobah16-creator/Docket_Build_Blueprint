# Decision 0003 — Docket is the platform; every firm, Klinique included, is a tenant

**Status:** Decided · **Date:** 2026-09-10 · **Gates:** everything from here on
**Supersedes:** the framing in blueprint §1 ("Docket launches as Attorneys Klinique's
digital front door") and README ("Klinique is tenant #1" as a build target)

## Decision

Docket is a multi-tenant platform for Nigerian law firms, their clients, the
courts they appear before and the counsel they appear against. Attorneys
Klinique is the **first customer** of that platform — the way a clinic is the
first customer of an electronic-health-records platform — and must never be a
special case in code, schema, policy or documentation.

Concretely:

1. **Firm creation is a product feature.** Any firm registers itself at
   `/firm/start` through `create_firm()`; a platform admin can open a firm for
   an existing owner from `/admin`. Both paths call the same
   `seed_firm_defaults()`. `supabase/seed.sql` is Klinique's *data* run through
   that same function — a convenience for the first migration, not a privilege.
2. **Nothing in `app/` or `src/` names a firm.** Brand, copy, services,
   policies, lawyers, courts and statuses are rows. The only place the string
   "attorneys-klinique" appears outside `seed.sql` and docs is the default
   `E2E_FIRM_SLUG` in the smoke test, which any firm's slug can replace.
3. **The Nigerian dispensation is reference data every tenant shares:**
   states, the court hierarchy, suit-number formats, public holidays, court
   vacations, practitioner identity (SCN, year of call, NBA branch). Firms add
   their own courts privately; the platform maintains the shared directory.
4. **Between-firm and firm-to-court communication are platform primitives**,
   not firm features: counsel of record on a matter, service of court
   processes with acknowledgement, and (Phase 2) cause-list and e-filing
   integrations where a judiciary offers one.
5. **Platform administration never reaches matter content.** Platform admins
   see firm lifecycle rows only; the database enforces it (there is no
   platform policy on matters, documents, messages, updates or invoices).
6. **A firm is public only after the platform has verified it**, and its fees
   settle only to its own Paystack subaccount. Both are enforced in the
   database, not in the app.

## Why

- The value of Docket compounds with the number of firms: a client keeps one
  app across firms; a process served on a firm that is already on Docket is
  acknowledged in the app; a court that sees consistent suit numbers and
  timely adjournment records has a reason to integrate. None of that exists
  if only one firm can be created by hand.
- Klinique benefits *more* from a platform that other firms also use than
  from a bespoke build: opposing counsel on Docket means proof of service
  without a bailiff, and referrals arrive with the client already onboarded.
- Separating the platform entity from the firm (blueprint §14.2) needs the
  software to be separable first.

## Consequences

- `BUILD_PROMPTS.md` slice 5 loses "create firm via a service-role server
  action guarded by a platform-admin allowlist" — it is done, in the database.
  Slice 6 ("second firm") starts at `/firm/start`, not at a SQL prompt.
- Slice 4 (staff console) gains: court picker on matters, counsel roster,
  "serve process" and the service inbox with acknowledgement.
- Migration 5's `partner_attribution` (originating/handling partner) stays: it
  is a firm-generic concept every partnership needs, not a Klinique one.
- Docs describe Docket first and Klinique as the worked example. The Klinique
  master prompt remains the source requirements for tenant #1.
