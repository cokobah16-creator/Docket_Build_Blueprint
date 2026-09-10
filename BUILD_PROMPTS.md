# Docket — build prompts for Claude Code

Six slices, in the order of the 90-day plan. Each prompt is self-contained: paste it into Claude Code from the repo root with `Docket_Build_Blueprint_v0.2.md` and `README.md` present. Do not paste all six at once — finish a slice, run its acceptance checks, commit, then start the next.

Every slice inherits these rules:

- The database is the source of truth for authorization. Never re-implement access rules in the UI; never use the service role outside Edge Functions.
- Nothing fake: no mocked payments, no hard-coded users, no public document URLs, no placeholder auth.
- All timestamps UTC in the database; render in `profiles.timezone`.
- Tenant-branded, mobile-first, WCAG 2.2 AA. Design tokens come from `firms.brand`; nothing firm-specific in code — Docket is the platform, Attorneys Klinique is tenant #1 (decision 0003, `docs/DOCKET_PLATFORM_MODEL.md`). Test every screen with a second firm created at `/firm/start`.
- Nigerian by default: courts from the `courts` directory, suit numbers as the registry writes them, dates checked with `is_non_sitting_day()`, phones normalised to +234, Naira in kobo.
- If a rule in the schema blocks you (e.g. an MFA-gated write), build the missing flow — don't loosen the rule.

---

## Slice 0 — app skeleton, auth, tenancy (weeks 1–2)

> Bootstrap the Docket web app on top of the existing `supabase/` foundation (already migrated; read `README.md` first).
>
> Stack: Next.js 15 App Router, TypeScript, Tailwind, `@supabase/ssr`, `zod`. One repo, four surfaces: tenant public sites at `app/(public)/[firm]/…`, the client PWA at `app/app/…`, the staff console at `app/firm/…`, and platform admin at `app/admin/…`.
>
> Build:
> 1. `middleware.ts` that resolves the request host → firm (`firm_public` by `custom_domain`, else `{slug}.docket.app`, else `?firm=` in dev) and sets `x-firm-id` / `x-firm-slug` headers for server components.
> 2. Supabase server/browser clients, typed with `supabase gen types` output at `src/lib/db/types.ts`.
> 3. Auth: client sign-in by phone OTP or email magic link; staff sign-in by email + password. A TOTP enrolment flow (`/firm/security/mfa`) that staff must complete before any `/firm` route renders — check the session's `aal` and redirect to enrolment/challenge when it is not `aal2`. Read the roles from `firm_members` to route `owner/admin/lawyer/staff`.
> 4. A design-token layer: read `firms.brand.colours` and fonts into CSS variables in the tenant layout; base components (Button, Input, Select, Card, Modal, Table, Badge/StatusPill with icon + label, Alert, Toast, BottomNav) in `src/components/ui`.
> 5. Consent capture: on first login, record `terms` and `privacy` acceptance in `consent_records` with the versions from `firms.policies`.
> 6. `.env.example` is complete; `npm run typecheck` and `npm run db:test:local` pass; Playwright is set up with a smoke test that loads the tenant public home for `E2E_FIRM_SLUG` and the client login.
>
> Acceptance: a staff user without TOTP is forced to enrol; after enrolment `aal2` shows in the session; a client can sign in by phone and lands on an empty dashboard branded with the tenant's colours.

## Slice 1 — tenant public site, booking wizard, Paystack (weeks 3–4)

> Build the acquisition funnel for the tenant resolved by the middleware.
>
> Public pages (server components, SEO metadata, Open Graph, JSON-LD `LegalService`, sitemap, robots): Home (hero + persistent "Book a Consultation"), About, Services, Service detail, Lawyers, Lawyer profile (`lawyer_profiles` where `is_public`), Contact, Terms, Privacy. Copy comes from `firms.brand`, `firms.policies` and `content` rows; no Klinique text in code.
>
> Booking wizard at `/book` (works on a mid-range phone on mobile data): service → mode → lawyer (only if the service allows a choice) → date → slot (call `available_slots` via RPC; show times in the visitor's zone and the lawyer's zone) → intake questionnaire rendered from `intake_forms.schema` (support `text`, `longtext`, `choice`, `multiple`, `file` to `intake-uploads/{firm}/{client}/…`, and `show_if`) → sign in / create account inline → review (lawyer, date, time in both zones, duration, price, cancellation policy from `firms.policies`, disclaimer) → `book_appointment` RPC → payment.
>
> Payment: a server action that reads the appointment's invoice, picks `paymentProviderFor(currency)` from `src/lib/providers/payments`, calls `initialize()` and redirects to the checkout URL. The callback page `/app/appointments/[id]/payment-result` polls the appointment status (Realtime on `appointments`) and shows "confirmed" only when the webhook has done its job; it never writes. Show the 15-minute hold countdown; on expiry the job cancels the hold and the UI offers to rebook.
>
> Invoice and receipt: `/app/payments/[invoice]` with a PDF download rendered server-side (react-pdf or Playwright PDF) — number, firm details, items, VAT line, payments.
>
> Acceptance: a visitor books and pays a real Paystack test transaction end to end; the appointment turns `confirmed` only after the webhook; a second visitor cannot take the same slot; the intake answers appear on the staff side; Lighthouse mobile ≥ 90 on Home and Book.

## Slice 2 — virtual consultation and reminders (weeks 5–6)

> Build the consultation experience on Daily via `src/lib/providers/video`.
>
> 1. Server action `getOrCreateRoom(appointmentId)`: only for `confirmed/rescheduled` appointments, only from 10 minutes before `starts_at`; creates the private room with knocking (`appt-${id}`, exp = `ends_at` + 1h) if `consultation_sessions` has none, issues a token (owner for the lawyer, participant for the client, exp = room exp), records the session row, audits.
> 2. Client waiting room `/app/appointments/[id]/waiting-room`: lawyer name, time in the client's zone, duration, service, camera and microphone test, "Waiting for your lawyer…"; joins the Daily room in knocking mode.
> 3. Lawyer side `/firm/appointments/[id]`: join as owner, see the knock, admit; consultation timer, connection status; "End and write notes".
> 4. Consultation room using Daily Prebuilt with our controls (mic, camera, screen share, chat, leave). Recording is not exposed anywhere.
> 5. Notes form after the call → `save_consultation_notes` RPC (client summary, advice, follow-up, internal notes, mark completed). Client sees the summary on the appointment page; internal notes only on `/firm`.
> 6. Reminders: deploy `dispatch-notifications`, register web push (`push_subscriptions`), service worker with notification click → URL. Verify the 24h / 1h / 10m / now reminders arrive by push, SMS and email using the existing `enqueue_appointment_reminders` job.
> 7. Rescheduling: staff can move an appointment (status `rescheduled`, reminders reset) through a server action that re-validates the slot.
>
> Acceptance: a real face-to-face consultation happens between a client account and a lawyer account on two phones; the client cannot join before the lawyer admits; the room dies after expiry; the notes flow marks the appointment completed and the client sees only the summary.

## Slice 3 — client portal (weeks 7–8, part 1)

> Build the client PWA at `/app` with bottom navigation Home · Appointments · Matters · Messages · Profile.
>
> - Home: welcome, quick actions (Book, Join, Upload, Message, Pay), next appointment with Join when live, my matters (reference, lawyer, status label from `matter_statuses`, last update, next action), recent documents, outstanding balance, recent notifications. Empty states with CTAs.
> - Matters list and matter detail with tabs: Timeline (`updates` where visible, newest first, Realtime), Documents (upload to `documents/{firm}/{doc}/{version}` with a new `documents` + `document_versions` row, preview PDF/images via short signed URLs, versions), Messages (thread on the matter, attachments, read receipts, Realtime), Invoices (pay via the same payment action as slice 1; USD through Paystack multi-currency where the firm's account has it — decision 0002).
> - Court dates: merged calendar across firms with ICS export.
> - Notifications feed (`notifications` where channel `in_app`, mark read) and preferences (`notification_preferences` per event/channel, quiet hours as a profile field).
> - Profile: contact details, timezone, preferred channel, consent history, sign-out everywhere.
> - PWA: manifest, icons from the firm brand, offline shell, low-data mode (no images until tapped), iOS install instructions.
>
> Acceptance: the RLS suite still passes; a client party to two matters at two different firms sees both in one feed and nothing else; document uploads land in the right tenant path; a 2 MB PDF previews on a mid-range Android.

## Slice 4 — staff console (weeks 7–8, part 2)

> Build `/firm` for lawyers and admins (MFA already enforced).
>
> - Today: today's appointments with Join, **sittings without an update** (`court_events` in the past with `outcome_update_id` null), overdue tasks placeholder, unread messages, documents awaiting review.
> - Post court update form → `post_court_update` RPC exactly as blueprint §5.11: date (today), court, outcome chips, "at whose instance" when adjourned, next date + purpose, note to client, internal note, attachment. Must be usable in 30 seconds on a phone; the client is notified within 60.
> - Matters: list with per-firm status filter, create (reference via `next_reference` inside a server action), edit, parties (invite by phone/email → `invites`, link shown for WhatsApp/SMS), lawyers, timeline with internal entries visible, documents (client-visible toggle), messages, invoices (create manual invoices with items and VAT; issue; pay-by-link), tasks (create/close — minimal).
> - Court and counsel (migrations 10–11): a court picker on the matter (platform directory by level/state/division, plus "add our own court" → `courts` with `firm_id`), suit number with the court's hint, originating/handling partner; a counsel roster (`matter_counsel`: party and side, opposing / co-counsel, pick a firm on Docket from `firm_service_directory` or enter an address for service, record counsel's undertaking to accept service); **Serve process** → `serve_process` (document, title, method, date, originating?, order for substituted service, who was served and by whom) and the **Service inbox** at `/firm/inbox` (already a minimal page: acknowledge) gains `link_service_to_matter` with a response date and `revoke_service`; the post-court-update form warns via `is_non_sitting_day()` when the next date is a weekend, public holiday or published vacation, and offers the court's vacation judge note.
> - Firm Overview (master prompt §4): side-by-side firm calendar, activity feed, firm-wide totals, originated-vs-handling column.
> - Clients: list and detail (profile, appointments, matters, invoices, consent records).
> - Availability editor: weekly rules with breaks, exceptions/holidays, slot length, daily cap; preview of the next 14 days of slots.
> - Consultations: appointment list, detail, notes (from slice 2).
> - Receipts in both currencies; manual invoices go through the same `paymentProviderFor()` and settle to the firm's subaccount.
>
> Acceptance: a lawyer posts a court update from a phone in under 30 seconds and the client's phone buzzes; sittings without an update clears when the update is posted; an admin can invite a client to a matter and the client sees it after `accept_invite`.

## Slice 5 — admin, hardening, docs (weeks 9–10)

> Finish Phase 1.
>
> - Firm admin at `/firm/admin`: settings (brand, policies with version bump, domain request, templates), services CRUD, intake form builder (JSON editor with preview), users and roles, appointments, matters, payments, invoices, audit log viewer (owner/admin), basic counts.
> - Platform admin at `/admin` (list, create-for-owner and suspend already exist on `platform_admins`): add custom domain mapping via the Vercel Domains API, plan changes, health (queued/failed notifications, failed webhooks), and data entry for `court_vacations` and movable `public_holidays`.
> - Security: CSP and HSTS headers, rate limiting on auth, booking and webhooks, origin checks on server actions, dependency audit, an RLS regression test in CI (`npm run db:test:local` against a Postgres service), Sentry, PostHog events for the funnel (site → booking started → paid → attended → matter opened).
> - Backups: enable PITR; write and rehearse the restore runbook; document RPO/RTO.
> - Compliance pack: privacy notice and DPA templates wired to `firms.policies`; data-subject request runbook; breach-response runbook; NDPC registration checklist.
> - Docs: admin guide, client guide, API/RPC reference, deployment runbook, `.env.example` audit.
>
> Acceptance: all blueprint §12 week-9/10 gates met; every active client of tenant #1 onboarded; `npm run typecheck`, Playwright and the SQL suite green in CI.

## Slice 6 — second firm and Phase 2 scoping (weeks 11–12)

> Onboard tenant #2 and prove the network loop.
>
> - The second firm registers itself at `/firm/start` (no SQL, no platform admin needed); its owner enrols MFA, sets brand, services and availability, invites its clients. Then record it as opposing counsel on a Klinique matter and serve a process both ways — the acknowledgement is the network loop working.
> - Prove isolation with real accounts (a client who has matters at both firms sees one merged feed; each firm sees only its own).
> - Metrics dashboard from PostHog + SQL: booking conversion, attendance, consultation → matter, sittings updated within 24h, weekly-active clients, days to collect.
> - Scope Phase 2 tickets: conflict checks, tasks, global search, CMS, WhatsApp channel and WhatsApp-in updates, plain-English explainer, e-signature, analytics, hourly/retainer billing, malware scanning, DSAR tooling, cause-list ingestion and judiciary e-filing integrations (Lagos, Federal High Court) on top of `courts`/`court_events`, firm-to-firm messaging beyond service, Flutterwave adapter, native wrappers.
