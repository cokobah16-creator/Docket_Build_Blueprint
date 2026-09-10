# Docket — Build Blueprint v0.2

*One app, every matter, any firm. Attorneys Klinique Law Consultancy is tenant #1.*
*v0.2 — 9 September 2026 — supersedes Docket v0.1 and the Attorneys Klinique master prompt. Prepared for Emeke and Precious.*

> **Platform note (10 September 2026).** Decision 0003 and `docs/DOCKET_PLATFORM_MODEL.md` reframe this document: Docket is the platform, and Attorneys Klinique is its first tenant, not its purpose. Where this blueprint says "Klinique's …" read "the firm's …". Self-serve firm onboarding (§6, listed as Phase 2) is built (migration 9, `/firm/start`), as are the Nigerian court directory (migration 10) and service of process between firms (migrations 11–13); the §12 gates apply to any firm. The schema in §7 is superseded by `supabase/migrations/`.

---

## 0. What changed from v0.1

- **Merged the Attorneys Klinique master prompt.** Klinique is the first firm on Docket. Its brand, public website, services, lawyers, policies and booking flow live in tenant configuration, never in code.
- **Added the acquisition funnel.** v0.1 was retention-only (court updates). v0.2 adds: public site → service → intake → booking → payment → waiting room → face-to-face video consultation → matter opened.
- **Schema grew.** New: services, intake forms and responses, availability rules and exceptions, appointments, consultation sessions and notes, per-firm matter statuses, document versions, invoice items, tasks, consent records, notification preferences, content, conflict checks. Roles gain `admin`.
- **Phase 1 trimmed** to the client journey in §52 of the master prompt. CMS, conflict checks, tasks, reports and charts, testimonials, WhatsApp, e-signature and native apps move to Phase 2.
- **Provider decisions made:** Daily.co for video, Paystack (NGN) + Stripe (USD) for payments, Termii + Resend for messaging, Supabase + Vercel for the platform — each behind an adapter so it can be swapped.

## 1. Thesis and the three loops

Clients don't choose legal apps; firms do. Docket launches as Attorneys Klinique's digital front door and client portal, built multi-tenant from day one so every firm invited later brings its own clients while each client keeps one app and one merged feed.

- **Acquisition loop (from the Klinique spec):** "I need legal help" → book → pay → meet the lawyer face to face → matter opened.
- **Retention loop (from Docket v0.1):** an update in the app within 24 hours of every court sitting or filing → the client stays, pays faster, refers.
- **Network loop:** every firm invited brings its clients; every client keeps one app. The diaspora client — in Atlanta while the matter runs in Abuja or Asaba — is the wedge for all three.

## 2. Product principles

- The client experience is five words: **Tell us → Book → Pay → Meet → Track.** It must never feel like practice-management software.
- The firm runs its whole digital client workflow from one console. Nothing is copied between systems.
- Premium, discreet, spacious, mobile-first. Tenant-branded, not template-branded.
- Nothing fake: real authentication, payments verified server-side, real video, authorization enforced in the database.
- Legal posture is explicit: general information, consultation, formal advice and representation are distinguished on every relevant screen; an inquiry never creates a lawyer-client relationship; disclaimers and engagement terms are configurable per firm.

## 3. Tenancy model

- **Firm = tenant.** Config holds name, legal name, RC number, logo, colours, fonts, contact details, custom domain, timezone, default currency, VAT setting, cancellation policy, terms, privacy notice, disclaimers, email and SMS templates.
- **Public site per firm** at `{slug}.docket.app` and on a custom domain (Klinique's own domain mapped through Vercel). Middleware resolves host → firm.
- **Global client identity** (phone or email). A client is linked to firms through matters and appointments; the home feed merges everything they have across firms. Firms never see each other's data.
- **Staff belong to firms** with roles `owner`, `admin`, `lawyer`, `staff`. Platform administration (you) is a separate surface.
- **Isolation** is row-level security keyed on `firm_id` for staff and on matter/appointment party membership for clients. There is no cross-firm read path except the client's own merged view.

## 4. Roles

| Role | Can |
|---|---|
| Visitor | Browse the firm site, services, lawyers, contact; start a booking (account created inside the flow). |
| Client | Register, profile, consent, book, pay, join waiting room and video, upload/download documents, message the firm, track matters and timeline, view and pay invoices, download receipts, manage notification and security settings. |
| Lawyer | Today's schedule, assigned clients and matters, availability, conduct consultations, consultation notes (client-visible and internal), post matter updates, upload and review documents, messages, invoices and payment status. |
| Firm admin | Everything a lawyer can, plus firm settings, services, intake forms, users, all appointments and matters, payments, invoices, audit log, content. |
| Platform admin | Firms, onboarding, domains, health, billing to firms. No access to matter content. |

## 5. Product spec — Phase 1

### 5.1 Public site (per firm)
Home (hero, "Book a Consultation" as the persistent primary CTA, services overview, why this firm, how it works, virtual consultation explainer, lawyer profiles, contact, footer), services list and detail, lawyer profiles, about, contact, booking wizard, terms and privacy. Semantic HTML, metadata, Open Graph, structured data, sitemap, clean URLs. FAQs, articles and testimonials are Phase 2 (testimonials only after the RPC review in §10).

### 5.2 Accounts
Clients sign in with phone OTP (Nigerian lines) or email (diaspora); password optional. Account verification, consent capture (terms, privacy) and profile completion happen inside the booking flow, not before it. Staff sign in with email + password and **mandatory TOTP two-factor** for admin and lawyer roles; staff-side writes are refused by the database unless the session is MFA-verified.

### 5.3 Services
Firm-configurable, never hard-coded: name, description, price, currency, duration, lawyer category, active flag, prepayment required, virtual available. Klinique's starting catalogue is the fourteen services in the master prompt, priced by Precious.

### 5.4 Intake
A questionnaire per service, defined as JSON: text, multiple-choice, file upload, with conditional branches (Business → company questions; Property → property questions). Collect only what the consultation needs.

### 5.5 Booking
Service → mode (virtual, in person, phone) → lawyer (if the service allows choice) → date → slot → fee → review (lawyer, date, time in the client's zone, duration, price, cancellation policy) → pay → confirmed. Human-readable reference (`AK-2026-000123`). Statuses: pending, awaiting payment, confirmed, rescheduled, completed, cancelled, no-show. A slot is held for 15 minutes while payment completes; a database exclusion constraint makes double-booking impossible, not merely unlikely.

### 5.6 Payments
Paystack for NGN (cards, bank transfer, USSD) on the Nigerian entity; Stripe for USD on the US entity (Stripe does not onboard Nigerian merchants). Flow: invoice created → transaction initialised with the invoice number as reference → client pays → webhook signature verified → transaction re-verified against the provider API → payment recorded → invoice paid → appointment confirmed → notifications. **Frontend callbacks never mark anything paid.** Idempotent on provider reference. Card details are never stored. Funds settle directly to the firm; the platform never holds client money.

### 5.7 Availability
Per lawyer: working days and hours, breaks, slot length, days off, holidays, maximum consultations per day, timezone. Slots are computed server-side. All timestamps are stored in UTC and rendered in the viewer's zone — Nigeria is UTC+1 with no daylight saving, Atlanta shifts twice a year.

### 5.8 Virtual consultation
Daily.co behind a `VideoProvider` adapter. On confirmation a private room is created with knocking enabled and an expiry one hour after the appointment ends. "Join" activates ten minutes before start. Client flow: open appointment → join → waiting room (lawyer name, time, duration, service, camera and microphone test, "Waiting for your lawyer…") → lawyer admits → face-to-face room. Controls: microphone, camera, screen share, chat, leave; connection status and a consultation timer. Tokens are unique, expiring, bound to the appointment and the user; there are no permanent meeting URLs. **No recording.** If recording is ever introduced it requires explicit consent, a visible indicator, retention rules and access logging.

### 5.9 Consultation notes
After the session the lawyer records a client-visible summary (what was discussed, advice given, follow-up actions) and internal notes that never leave the firm. Saving notes posts a `consultation` entry to the matter timeline and marks the appointment completed.

### 5.10 Matters
Reference, title, practice area, client(s), assigned lawyers, description, status, opening and closing dates, next action, important dates, court details where litigated. Statuses are a per-firm list; Klinique's defaults are the ten in the master prompt plus litigation stages. Everything hangs off the matter: appointments, timeline, documents, messages, invoices, tasks.

### 5.11 Timeline — the retention engine
Chronological, client-facing, every entry timestamped and attributed. Kinds: court sitting, consultation, appointment, filing, correspondence, milestone, fee, document, note, status change. The **Post court update** form is kept exactly as v0.1 specified — date, court, outcome (hearing held / adjourned at whose instance / ruling / judgment / struck out / stood down / mention / court did not sit), next date and purpose, note to client, internal note, attachment — thirty seconds on a phone, client notified within sixty. The lawyer dashboard lists **sittings without an update**.

### 5.12 Documents
Upload, download, preview (PDF and images), rename, categorise, associate with a matter or appointment, version history, timestamp and uploader. Private buckets, signed URLs of ten minutes or less, client-visible toggle. Limits: 25 MB per file; PDF, DOCX, JPG, PNG, HEIC. Soft delete only; malware scanning in Phase 2.

### 5.13 Messaging
Matter-linked (or appointment-linked) threads with attachments, timestamps, read state and a lawyer response-time indicator. A ticket, not a live chat. Admin access is role- and matter-scoped.

### 5.14 Notifications
Channels in Phase 1: in-app, push (installed PWA), email, SMS. WhatsApp in Phase 2. Events: appointment confirmed, reminder, payment confirmed, invoice issued, document uploaded, document requested, new message, matter update, consultation starting, cancellation, reschedule. Reminders at 24 hours, 1 hour, 10 minutes and at start; court dates at T-3 and T-1. Per-client preferences; quiet hours; de-duplication so nobody gets six pings for one event.

### 5.15 Client portal
Dashboard: welcome, quick actions (Book, Join, Upload, Message, Pay), next appointment with Join button when live, my matters (reference, lawyer, status, last update, next action), recent documents, outstanding balance and last payment, recent notifications. Bottom navigation: **Home · Appointments · Matters · Messages · Profile.** Installable PWA; low-data mode; large tap targets.

### 5.16 Lawyer console
Today's schedule with join buttons, sittings without an update, my matters (active, awaiting client, deadlines), unread messages, documents awaiting review, outstanding invoices, availability editor, consultation notes, post-update form.

### 5.17 Firm admin
Settings (brand, policies, domain, templates), services, intake forms, lawyers and users, appointments, matters, documents, payments, invoices, audit log, basic counts (clients, active matters, upcoming and completed consultations, revenue, outstanding). Charts and reports are Phase 2.

### 5.18 Invoicing
Per-firm numbering, client, matter or appointment, line items, VAT line where applicable, due date, statuses (draft, issued, partially paid, paid, overdue, cancelled), payment history, PDF invoice and receipt. Billing models supported by the data model: consultation fee now; fixed fee, hourly, retainer and quotation in Phase 2.

### 5.19 Audit log
Immutable (no update or delete grants). Records login and logout, account and security changes, document upload, download and deletion, matter, appointment, invoice and payment changes, permission changes, admin actions — with actor, timestamp, resource and IP/device metadata where lawful.

### 5.20 Cross-cutting
Empty states with a CTA ("No upcoming consultations" → Book). Status colours always paired with a label or icon. Friendly error copy; technical detail logged privately. WCAG 2.2 AA: keyboard navigation, contrast, labels, focus states, accessible validation. Performance: fast first load, lazy images, pagination, indexes, CDN — usable on a mid-range phone on mobile data.

## 6. Phase 2 (after day 90)

Conflict check (flags potential matches for review, never declares a conflict), tasks and deadlines, global permission-aware search, CMS (articles, FAQs, announcements, testimonials), WhatsApp channel and WhatsApp-in court updates, AI plain-English explainer of court outcomes (lawyer-approved), e-signature, analytics charts and reports, hourly/retainer/quotation billing, malware scanning, data-subject request tooling, self-serve firm onboarding, Flutterwave adapter, native wrappers (Capacitor or Expo).

## 7. Data model (Supabase / Postgres)

```sql
create extension if not exists btree_gist;

create type firm_role          as enum ('owner','admin','lawyer','staff');
create type party_role         as enum ('client','contact','co_counsel');
create type client_type        as enum ('individual','business');
create type matter_type        as enum ('litigation','property','corporate','estate','family','employment',
                                        'debt_recovery','ip','regulatory','immigration','advisory','other');
create type update_kind        as enum ('court_sitting','consultation','appointment','filing','correspondence',
                                        'milestone','fee','document','note','status_change');
create type visibility         as enum ('client','internal');
create type currency           as enum ('NGN','USD');
create type appointment_status as enum ('pending','awaiting_payment','confirmed','rescheduled','completed','cancelled','no_show');
create type appointment_mode   as enum ('virtual','in_person','phone');
create type invoice_status     as enum ('draft','issued','partially_paid','paid','overdue','cancelled');
create type payment_status     as enum ('initiated','succeeded','failed','refunded');
create type channel            as enum ('in_app','push','email','sms','whatsapp');
create type consent_kind       as enum ('terms','privacy','engagement','recording','marketing');
create type content_kind       as enum ('page','faq','article','announcement','testimonial');

-- identity and tenancy
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text, phone text unique, email text unique, country text, state text, address text,
  client_type client_type default 'individual', company_name text,
  timezone text default 'Africa/Lagos', locale text default 'en', preferred_channel channel default 'sms',
  created_at timestamptz default now()
);

create table firms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null, name text not null, legal_name text, rc_number text,
  custom_domain text unique, timezone text default 'Africa/Lagos',
  default_currency currency default 'NGN', vat_rate numeric(5,2) default 0,
  brand jsonb default '{}',     -- logo, colours, fonts, contact, social
  policies jsonb default '{}',  -- cancellation, terms, privacy, disclaimers (versioned)
  paystack_subaccount text, stripe_account text,
  created_at timestamptz default now()
);

create table firm_members (
  firm_id uuid references firms on delete cascade, user_id uuid references profiles on delete cascade,
  role firm_role not null, primary key (firm_id, user_id)
);

create table lawyer_profiles (
  firm_id uuid references firms, user_id uuid references profiles,
  slug text, title text, bio text, photo_path text, practice_areas text[], category text,
  is_public bool default true, primary key (firm_id, user_id), unique (firm_id, slug)
);

-- catalogue and intake
create table services (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms,
  slug text not null, name text not null, description text,
  price_minor bigint not null, currency currency default 'NGN', duration_min int not null,
  lawyer_category text, requires_prepayment bool default true, virtual_available bool default true,
  is_active bool default true, sort int default 0, unique (firm_id, slug)
);

create table intake_forms (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms,
  service_id uuid references services, name text, schema jsonb not null,   -- questions, types, conditions
  is_active bool default true
);

create table intake_responses (
  id uuid primary key default gen_random_uuid(), form_id uuid references intake_forms,
  appointment_id uuid, client_id uuid references profiles, answers jsonb not null,
  created_at timestamptz default now()
);

-- availability and appointments
create table availability_rules (
  id uuid primary key default gen_random_uuid(), firm_id uuid references firms, lawyer_id uuid references profiles,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null, end_time time not null, break_start time, break_end time,
  slot_min int default 45, max_per_day int default 6
);

create table availability_exceptions (
  id uuid primary key default gen_random_uuid(), lawyer_id uuid references profiles,
  on_date date not null, is_available bool default false, start_time time, end_time time, reason text
);

create table appointments (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms,
  reference text unique not null,                                  -- AK-2026-000123
  client_id uuid not null references profiles, lawyer_id uuid references profiles,
  service_id uuid references services, matter_id uuid,
  mode appointment_mode default 'virtual', status appointment_status default 'pending',
  starts_at timestamptz not null, ends_at timestamptz not null, client_timezone text,
  fee_minor bigint, currency currency, invoice_id uuid, hold_expires_at timestamptz,
  cancellation_reason text, created_at timestamptz default now(),
  exclude using gist (lawyer_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status in ('pending','awaiting_payment','confirmed','rescheduled'))
);

create table consultation_sessions (
  id uuid primary key default gen_random_uuid(), appointment_id uuid not null references appointments,
  provider text default 'daily', room_name text unique, room_expires_at timestamptz,
  client_admitted_at timestamptz, started_at timestamptz, ended_at timestamptz, events jsonb default '[]'
);

create table consultation_notes (
  id uuid primary key default gen_random_uuid(), appointment_id uuid references appointments,
  matter_id uuid, lawyer_id uuid references profiles,
  client_summary text, advice_given text, follow_up text, internal_notes text,
  created_at timestamptz default now()
);

-- matters
create table matter_statuses (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms,
  key text not null, label text not null, colour text, sort int default 0, is_terminal bool default false,
  unique (firm_id, key)
);

create table matters (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms,
  reference text unique not null, title text not null, type matter_type not null,
  status_id uuid references matter_statuses, description text, next_action text,
  court_name text, suit_number text, judge text, opposing_party text,
  next_event_at timestamptz, next_event_note text,
  opened_at date default current_date, closed_at date, deleted_at timestamptz,
  created_by uuid references profiles, created_at timestamptz default now()
);
alter table appointments       add foreign key (matter_id) references matters;
alter table consultation_notes add foreign key (matter_id) references matters;

create table matter_parties (          -- client-side access to a matter
  matter_id uuid references matters, user_id uuid references profiles,
  role party_role not null, can_view_docs bool default true, can_pay bool default true,
  invited_by uuid references profiles, primary key (matter_id, user_id)
);

create table matter_lawyers (
  matter_id uuid references matters, user_id uuid references profiles,
  is_lead bool default false, primary key (matter_id, user_id)
);

create table updates (                 -- the timeline
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references matters, firm_id uuid not null references firms,
  kind update_kind not null, visibility visibility default 'client',
  title text not null, body text,
  payload jsonb default '{}',          -- court_sitting: {outcome, adjourned_at_instance_of, next_date, next_purpose}
  occurred_at timestamptz default now(), posted_by uuid references profiles, created_at timestamptz default now()
);

create table court_events (
  id uuid primary key default gen_random_uuid(), matter_id uuid not null references matters,
  scheduled_at timestamptz not null, court_name text, purpose text,
  outcome_update_id uuid references updates, reminded_t3 bool default false, reminded_t1 bool default false
);

create table tasks (                   -- Phase 2 UI, Phase 1 schema
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms,
  matter_id uuid references matters, assignee_id uuid references profiles,
  title text not null, due_at timestamptz, status text default 'open', created_at timestamptz default now()
);

-- documents and messages
create table documents (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms,
  matter_id uuid references matters, appointment_id uuid references appointments,
  name text not null, category text, client_visible bool default false,
  current_version_id uuid, uploaded_by uuid references profiles,
  deleted_at timestamptz, created_at timestamptz default now()
);

create table document_versions (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references documents,
  storage_path text not null, mime text, size_bytes bigint, checksum text,
  uploaded_by uuid references profiles, created_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms,
  matter_id uuid references matters, appointment_id uuid references appointments,
  sender_id uuid references profiles, body text, attachments jsonb default '[]',
  read_at timestamptz, created_at timestamptz default now()
);

-- money
create table invoices (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms,
  number text unique not null, client_id uuid not null references profiles,
  matter_id uuid references matters, appointment_id uuid references appointments,
  currency currency not null, subtotal_minor bigint not null, vat_minor bigint default 0,
  total_minor bigint not null, paid_minor bigint default 0,
  status invoice_status default 'draft', issued_at timestamptz, due_at date, created_at timestamptz default now()
);
alter table appointments add foreign key (invoice_id) references invoices;

create table invoice_items (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references invoices,
  description text not null, quantity numeric default 1, unit_minor bigint not null
);

create table payments (
  id uuid primary key default gen_random_uuid(), invoice_id uuid not null references invoices,
  provider text not null, provider_ref text unique not null, status payment_status default 'initiated',
  amount_minor bigint not null, currency currency not null, paid_at timestamptz, raw jsonb
);

-- notifications, consent, content, operations
create table notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles,
  firm_id uuid references firms, channel channel not null, event text not null, payload jsonb,
  status text default 'queued', send_after timestamptz default now(), sent_at timestamptz, error text
);

create table notification_preferences (
  user_id uuid references profiles, event text, channel channel, enabled bool default true,
  primary key (user_id, event, channel)
);

create table consent_records (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles,
  firm_id uuid references firms, kind consent_kind not null, version text not null,
  accepted_at timestamptz default now(), ip inet, user_agent text
);

create table content (
  id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms,
  kind content_kind not null, slug text, title text, body text, status text default 'draft',
  published_at timestamptz, unique (firm_id, kind, slug)
);

create table invites (
  id uuid primary key default gen_random_uuid(), firm_id uuid references firms, matter_id uuid references matters,
  phone text, email text, role party_role default 'client', token text unique not null,
  expires_at timestamptz, accepted_by uuid references profiles
);

create table conflict_checks (         -- Phase 2
  id uuid primary key default gen_random_uuid(), firm_id uuid references firms, matter_id uuid references matters,
  query jsonb, matches jsonb, outcome text, reviewed_by uuid references profiles, reviewed_at timestamptz
);

create table audit_log (
  id bigserial primary key, firm_id uuid, actor_id uuid, action text not null,
  entity text not null, entity_id uuid, meta jsonb, ip inet, at timestamptz default now()
);
revoke update, delete on audit_log from authenticated, anon;
```

**Row-level security.** Three helpers, one pattern everywhere: staff see their firm's rows (writes require an MFA-verified session); clients see their own appointments and client-visible rows on matters they are party to; users see themselves. Clients never insert appointments or payments directly — the booking and payment flows run through server actions and Edge Functions.

```sql
create function is_firm_member(f uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from firm_members where firm_id = f and user_id = auth.uid()) $$;

create function has_firm_role(f uuid, roles firm_role[]) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from firm_members where firm_id = f and user_id = auth.uid() and role = any(roles)) $$;

create function is_matter_party(m uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from matter_parties where matter_id = m and user_id = auth.uid()) $$;

alter table appointments enable row level security;
create policy client_reads_own_appointments on appointments for select using (client_id = auth.uid());
create policy firm_reads_appointments       on appointments for select using (is_firm_member(firm_id));
create policy firm_writes_appointments      on appointments for all
  using (is_firm_member(firm_id) and (auth.jwt()->>'aal') = 'aal2');

alter table updates enable row level security;
create policy firm_reads_updates   on updates for select using (is_firm_member(firm_id));
create policy client_reads_updates on updates for select using (visibility = 'client' and is_matter_party(matter_id));
create policy firm_writes_updates  on updates for insert with check (is_firm_member(firm_id) and (auth.jwt()->>'aal') = 'aal2');
```

**Indexes:** `matters (firm_id, status_id)`, `updates (matter_id, occurred_at desc)`, `appointments (lawyer_id, starts_at)`, `appointments (client_id, starts_at)`, `documents (matter_id)`, `messages (matter_id, created_at)`, `invoices (firm_id, status)`, `notifications (status, send_after)`.

**Storage buckets:** `firm-assets` (public: logos, lawyer photos), `documents` (private), `intake-uploads` (private).

**Triggers and jobs:** insert into `updates` with client visibility → rows queued in `notifications` → Edge Function fans out. `pg_cron` every minute: appointment reminders, expired holds released, rooms created ten minutes before start; daily: court-date reminders, overdue invoices, no-show marking, "sittings without an update" digest.

## 8. Architecture

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind on Vercel. One repo, four surfaces: tenant public sites (multi-domain via middleware), `/app` client PWA, `/firm` lawyer and admin console, `/admin` platform. Web push via VAPID.
- **Backend:** Supabase — Auth (phone OTP through a Send-SMS hook to Termii on DND-compliant routes, Twilio for US numbers; email; TOTP MFA), Postgres + RLS, Storage (private buckets, signed URLs), Realtime (feed, messages, waiting room), Edge Functions (Paystack, Stripe and Daily webhooks; notification worker; PDF generation), pg_cron.
- **Provider adapters:** `PaymentProvider` (Paystack, Stripe; Flutterwave later), `VideoProvider` (Daily; Zoom SDK or LiveKit later), `EmailProvider` (Resend), `SmsProvider` (Termii, Twilio), `WhatsAppProvider` (Phase 2), `StorageProvider` (Supabase Storage). Core business logic never imports a vendor SDK directly.
- **Authorization:** RLS is the source of truth. Server actions run with the user's session; the service key exists only inside Edge Functions; the frontend never decides access.
- **Booking engine:** slots = availability rules − exceptions − existing appointments, computed in the lawyer's zone; hold on selection; exclusion constraint as the last line of defence; expiry releases the hold.
- **Payments:** webhook signature check → provider-side re-verification → idempotent write keyed on provider reference → status cascade (payment → invoice → appointment) inside one transaction.
- **Video:** private Daily room per appointment, knocking enabled, owner token for the lawyer, expiring participant token for the client, room deleted after expiry. Session events (joined, admitted, left) written to `consultation_sessions`.
- **Time:** UTC in the database; `Africa/Lagos` and `America/New_York` are the two zones that matter first; every timestamp rendered per viewer; ICS export.
- **Domains:** firm custom domains added through the Vercel Domains API; middleware maps host → firm slug; Klinique's domain is the first.
- **Security:** HTTPS and HSTS, CSP and secure headers, rate limiting on auth, booking and webhooks, schema validation on every input, origin checks on server actions, private storage, MFA, immutable audit log, secrets only in environment variables with a committed `.env.example`, encryption in transit and at rest. Backups: Supabase daily backups plus point-in-time recovery on Pro; storage replicated; recovery drill in week 9 with written RPO (minutes) and RTO (four hours).
- **Observability:** Sentry, PostHog, Vercel analytics, Supabase logs. Friendly errors to clients, full traces to developers.
- **Hosting region:** Supabase London or Frankfurt (no Nigerian region); cross-border transfer disclosed in the DPA and privacy notice.
- **Environment variables:** `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DAILY_API_KEY`, `RESEND_API_KEY`, `TERMII_API_KEY`, `TWILIO_*`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SENTRY_DSN`, `POSTHOG_KEY`.
- **Running cost at launch:** roughly $100–150 per month for Supabase Pro, Vercel Pro, Sentry and PostHog, plus usage — Daily per participant-minute, Termii per message, Paystack and Stripe processing fees.

## 9. Design system and Phase 1 screens

Design first, then build: tokens and components in Figma → wireframes → high-fidelity for the twelve core screens (home, booking wizard, payment, client dashboard, appointment detail, waiting room, video room, matter detail with timeline, documents, messages, lawyer today view, post-update form) → implementation. Tenant tokens: primary and accent colours, logo, font pairing. Base system: buttons, forms, cards, modals, tables, navigation, alerts, notifications, badges and status indicators, appointment card, document row, video controls. Status colours always carry a label or icon. Klinique's visual direction: sophisticated legal/corporate, clean and spacious, nothing that reads as a startup template.

| Area | Phase 1 screens |
|---|---|
| Public (per firm) | Home · About · Services · Service detail · Lawyers · Lawyer profile · Contact · Book (wizard) · Terms · Privacy |
| Auth | Register · Login · Verify · Forgot password · Two-factor |
| Client `/app` | Dashboard · Appointments · Appointment detail · Waiting room · Video room · Matters · Matter detail (timeline, documents, messages, invoices) · Documents · Messages · Payments and invoices · Notifications · Profile · Settings |
| Lawyer `/firm` | Today · Calendar · Appointments · Appointment detail and notes · Clients · Client detail · Matters · Matter detail · Post update · Documents · Messages · Availability |
| Firm admin `/firm/admin` | Settings · Services · Intake forms · Users and lawyers · Appointments · Matters · Payments · Invoices · Audit log |
| Platform `/admin` | Firms · Onboarding · Domains · Health |

Phase 2 adds FAQs, Articles, Testimonials, Tasks, Reports, Content management and Conflict checks.

## 10. Compliance and professional rules

- **RPC (advertising and touting):** firm sites present services and lawyer profiles factually and in a dignified manner; no comparative or superlative claims, no incentives for referrals, no lawyer marketplace. Testimonials and "why choose us" copy go live only after Precious clears them against the currently operative Rules.
- **Engagement:** an inquiry or booking creates no lawyer-client relationship; a paid consultation is a consultation, not retention; engagement terms are accepted, versioned and recorded in `consent_records` when a matter is opened.
- **Fee-sharing and monetisation:** firms pay SaaS subscriptions and processing margin — never a percentage of legal fees — so the platform entity stays clear of fee-sharing with non-lawyers if outside investors ever come in.
- **Client money:** direct settlement to the firm; the platform never holds funds.
- **NDPA 2023 and the NDPC's GAID:** each firm is the data controller and Docket the processor. Standard DPA signed at firm onboarding; per-firm privacy notice and consent at client onboarding; data minimisation in intake; retention configurable per firm (default six years after closure) with soft deletion and an authorised destruction workflow; data-subject access and deletion requests handled manually in Phase 1, tooled in Phase 2; breach-response runbook with NDPC notification timelines; registration with the NDPC once past the data-subject thresholds (Precious confirms current numbers); cross-border hosting and diaspora clients disclosed.
- **Recording:** off by default; if ever enabled — explicit consent, visible indicator, secure storage, retention limits, access logging.
- **VAT:** invoices carry a VAT line at the prevailing rate where applicable; Precious confirms the treatment of consultation and consultancy fees.
- **Privilege and confidentiality:** internal notes never leave the firm; access is matter- and appointment-scoped; full audit trail; search never returns what a user cannot open.
- **Compliance features are not compliance.** Nigerian legal and privacy review of the implementation and policies before launch — Precious, with an external data-protection specialist if the NDPC designation requires one.

## 11. Growth engine

1. **Every active Klinique matter onboarded** and the 24-hour update promise written into engagement letters and the public site.
2. **Funnel instrumented end to end:** site visit → booking started → paid → attended → matter opened. Fix the biggest drop first.
3. **Diaspora channel:** Atlanta-Nigerian associations, churches, NIDO chapters, and the family real-estate pipeline (buyers need searches, Governor's Consent, deeds). Pitch: *your Abuja lawyer, face to face from Atlanta — and your matter in your pocket after.*
4. **Fee velocity:** USD in-app payment removes the wire-transfer excuse; watch days-to-collect.
5. **Referral surface:** clients share a link into the firm's intake form. No incentive attached.
6. **Week 11 — second firm.** One friendly chambers (co-counsel or a classmate's firm in Lagos or Asaba), free. Free forever for firms of three lawyers or fewer; paid tiers above.
7. **Moat:** the client book, the firm network, the update-discipline brand, and the data.

**KPIs:** booking conversion (site → paid); attendance rate; consultation → matter conversion; share of sittings updated within 24h (target 95%); client weekly-active (target 60%); days to collect; NPS; referrals per ten clients; firms onboarded.

## 12. 90-day plan

**Team:** Emeke (product owner). Precious (services and pricing, policies, engagement and consent documents, DPA, RPC review, QA, client onboarding). One full-stack developer (Next.js + Supabase) — or the two of us build with Claude Code. Designer for the first two weeks (design system, twelve core screens) and a polish pass in week 9.

| Weeks | Milestone | Deliverables |
|---|---|---|
| 1–2 | Foundations | Domain and Klinique tenant config; Figma design system and core screens; Supabase, Vercel, repo; schema, RLS and cross-tenant test suite; auth (OTP, email, TOTP MFA). Precious: terms, privacy notice, engagement terms, cancellation policy, DPA, disclaimers, service catalogue with prices. |
| 3–4 | Funnel | Klinique public site; services and intake; availability; booking engine with holds and exclusion constraint; Paystack with webhook verification; invoices and receipts. **Gate: first real paid booking.** |
| 5–6 | Consultation | Daily adapter, waiting room, video room, tokens and expiry; reminders (email, SMS, push); consultation notes; client dashboard and bottom nav. **Gate: first real virtual consultation.** |
| 7–8 | Matters and money | Matters with per-firm statuses; timeline and post-court-update form; documents with versions; messaging; Stripe USD; lawyer console with sittings-without-an-update. Migrate all active Klinique matters. |
| 9–10 | Hardening | Security review and RLS pen-test; headers, rate limits; backup and recovery drill; accessibility pass; low-data and iOS install flow; audit log review; NDPA pack; admin and client user guides; API and environment docs; deployment runbook. **Gate: all active clients onboarded.** |
| 11–12 | Second firm | Second tenant onboarded; isolation and merged-feed tests; admin counts; metrics dashboard; Phase 2 scoping. **Gate: one external firm live.** |

**Definition of done at day 90:** a Nigerian client can go from "I need legal help" on the Klinique site to a face-to-face consultation with a Klinique lawyer without human intervention; every active client is on Docket; at least 90% of sittings updated within 24 hours; fees collected in-app in NGN and USD; one external firm live; test suite green on auth, booking, payments, permissions, documents and video.

## 13. Deliverables (mapped from the master prompt §60)

Responsive web application · client portal · lawyer portal · admin portal · secure authentication with MFA · booking · Paystack and Stripe integration · virtual consultation with waiting room · messaging · document management with versions · matter management with timeline · notifications · invoicing with PDF · immutable audit log · privacy and security controls · database schema and migrations · API and adapter documentation · environment documentation and `.env.example` · deployment runbook · test suite · admin guide · client guide.

## 14. Decisions needed this week

1. **Domain:** the Klinique domain to map, and the Docket platform domain.
2. **Platform entity:** a separate company owns Docket and licenses it to Attorneys Klinique — cleaner for later firms, investors and IP.
3. **Payment entities:** which Nigerian entity holds Paystack and which US entity holds Stripe.
4. **Design route:** Figma first (recommended) or straight to code with the design system built in Tailwind.
5. **Build resourcing:** hired developer, or the two of us with Claude Code — I can scaffold the schema, RLS, adapters and booking engine next.
6. **First friendly firm** for week 11.
7. **VAT and pricing:** Precious sets the consultation fee schedule and confirms VAT treatment.
