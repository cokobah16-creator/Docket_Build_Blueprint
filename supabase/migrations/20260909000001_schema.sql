-- Docket slice 0 — migration 1: types, tables, indexes, grants, firm_public view.
-- Implements blueprint §5 (data model). All timestamps are UTC (timestamptz);
-- rendering in the viewer's timezone is a frontend concern (profiles.timezone).

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- Internal schema for security helpers and functions that must not be exposed
-- through PostgREST.
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type public.firm_role as enum ('owner', 'admin', 'lawyer', 'staff');

create type public.appointment_status as enum
  ('held', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show');

create type public.appointment_mode as enum ('virtual', 'in_person', 'phone');

create type public.invoice_status as enum ('draft', 'issued', 'paid', 'overdue', 'void');

create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded');

create type public.update_visibility as enum ('client', 'internal');

create type public.court_outcome as enum
  ('hearing_held', 'adjourned', 'mention', 'judgment_delivered',
   'ruling_delivered', 'struck_out', 'settled', 'discontinued', 'other');

create type public.adjourned_instance as enum ('claimant', 'defendant', 'court', 'joint');

create type public.notification_channel as enum ('in_app', 'email', 'sms', 'push', 'whatsapp');

create type public.notification_status as enum ('queued', 'sending', 'sent', 'failed', 'cancelled');

create type public.invite_status as enum ('pending', 'accepted', 'revoked', 'expired');

create type public.task_status as enum ('open', 'done', 'cancelled');

create type public.consent_type as enum ('terms', 'privacy', 'marketing');

create type public.party_role as enum ('client', 'guardian', 'witness', 'opposing', 'other');

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table public.firms (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name              text not null,
  custom_domain     text unique,
  brand             jsonb not null default '{}'::jsonb,
  policies          jsonb not null default '{}'::jsonb,
  vat_rate          numeric(5,2) not null default 0 check (vat_rate >= 0 and vat_rate <= 100),
  currency          text not null default 'NGN' check (currency in ('NGN', 'USD')),
  timezone          text not null default 'Africa/Lagos',
  reference_prefix  text not null default 'DKT',
  matter_counter    integer not null default 0,
  invoice_counter   integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  full_name          text,
  email              text,
  phone              text,
  timezone           text not null default 'Africa/Lagos',
  preferred_channel  public.notification_channel not null default 'sms',
  quiet_hours        jsonb, -- {"start":"22:00","end":"07:00"} in the profile's timezone
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.firm_members (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.firm_role not null default 'staff',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (firm_id, user_id)
);

create table public.consent_records (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid references public.firms (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  consent      public.consent_type not null,
  version      text not null,
  granted      boolean not null default true,
  recorded_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalogue: services, lawyers, availability, intake
-- ---------------------------------------------------------------------------

create table public.services (
  id                    uuid primary key default gen_random_uuid(),
  firm_id               uuid not null references public.firms (id) on delete cascade,
  slug                  text not null,
  name                  text not null,
  description           text,
  duration_minutes      integer not null default 30 check (duration_minutes between 5 and 480),
  price                 numeric(12,2) not null default 0 check (price >= 0),
  currency              text not null default 'NGN' check (currency in ('NGN', 'USD')),
  modes                 public.appointment_mode[] not null default '{virtual}',
  allows_lawyer_choice  boolean not null default true,
  is_active             boolean not null default false,
  position              integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (firm_id, slug)
);

create table public.lawyer_profiles (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  slug        text not null,
  title       text,
  bio         text,
  photo_path  text, -- storage path in firm-assets/{firm_id}/…
  timezone    text not null default 'Africa/Lagos',
  is_public   boolean not null default false,
  is_bookable boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (firm_id, user_id),
  unique (firm_id, slug)
);

create table public.availability_rules (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms (id) on delete cascade,
  lawyer_id     uuid not null references public.lawyer_profiles (id) on delete cascade,
  weekday       integer not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time    time not null,
  end_time      time not null check (end_time > start_time),
  breaks        jsonb not null default '[]'::jsonb, -- [{"start":"13:00","end":"14:00"}]
  slot_minutes  integer not null default 30 check (slot_minutes between 5 and 240),
  daily_cap     integer, -- max appointments per lawyer per day; null = unlimited
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.availability_exceptions (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  lawyer_id   uuid not null references public.lawyer_profiles (id) on delete cascade,
  on_date     date not null,
  is_closed   boolean not null default true,
  start_time  time, -- when not closed: override window for that date
  end_time    time,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (lawyer_id, on_date)
);

create table public.intake_forms (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  service_id  uuid references public.services (id) on delete set null,
  name        text not null,
  version     integer not null default 1,
  schema      jsonb not null default '[]'::jsonb, -- fields: text|longtext|choice|multiple|file, show_if
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Appointments and consultations
-- ---------------------------------------------------------------------------

create table public.appointments (
  id               uuid primary key default gen_random_uuid(),
  firm_id          uuid not null references public.firms (id) on delete cascade,
  client_id        uuid not null references auth.users (id),
  lawyer_id        uuid not null references public.lawyer_profiles (id),
  service_id       uuid not null references public.services (id),
  status           public.appointment_status not null default 'held',
  mode             public.appointment_mode not null default 'virtual',
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  client_timezone  text not null default 'Africa/Lagos',
  price            numeric(12,2) not null,
  currency         text not null check (currency in ('NGN', 'USD')),
  hold_expires_at  timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Hard double-booking guard: one lawyer, one live appointment per time range.
  exclude using gist (
    lawyer_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('held', 'confirmed', 'rescheduled'))
);

create table public.intake_responses (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references public.firms (id) on delete cascade,
  appointment_id  uuid not null references public.appointments (id) on delete cascade,
  form_id         uuid references public.intake_forms (id) on delete set null,
  client_id       uuid not null references auth.users (id),
  answers         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table public.consultation_sessions (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references public.firms (id) on delete cascade,
  appointment_id  uuid not null unique references public.appointments (id) on delete cascade,
  provider        text not null default 'daily',
  room_name       text not null,
  room_url        text not null,
  expires_at      timestamptz not null,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now()
);

create table public.consultation_notes (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references public.firms (id) on delete cascade,
  appointment_id  uuid not null unique references public.appointments (id) on delete cascade,
  summary         text,          -- client-visible
  advice          text,          -- client-visible
  follow_up       text,          -- client-visible
  author_id       uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.consultation_internal_notes (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references public.firms (id) on delete cascade,
  appointment_id  uuid not null references public.appointments (id) on delete cascade,
  body            text not null,
  author_id       uuid references auth.users (id),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------

create table public.matter_statuses (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms (id) on delete cascade,
  key          text not null,
  label        text not null,
  description  text,
  position     integer not null default 0,
  is_terminal  boolean not null default false,
  unique (firm_id, key)
);

create table public.matters (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms (id) on delete cascade,
  reference    text not null,
  title        text not null,
  description  text,
  status_id    uuid references public.matter_statuses (id),
  court        text,
  next_action  text,
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (firm_id, reference)
);

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references public.firms (id) on delete cascade,
  number          text not null,
  client_id       uuid not null references auth.users (id),
  matter_id       uuid references public.matters (id) on delete set null,
  appointment_id  uuid references public.appointments (id) on delete set null,
  status          public.invoice_status not null default 'draft',
  currency        text not null check (currency in ('NGN', 'USD')),
  subtotal        numeric(12,2) not null default 0,
  vat_rate        numeric(5,2) not null default 0,
  vat_amount      numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  amount_paid     numeric(12,2) not null default 0,
  due_at          timestamptz,
  issued_at       timestamptz,
  paid_at         timestamptz,
  voided_at       timestamptz,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (firm_id, number)
);

create table public.invoice_items (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms (id) on delete cascade,
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  description  text not null,
  quantity     numeric(10,2) not null default 1 check (quantity > 0),
  unit_price   numeric(12,2) not null default 0,
  amount       numeric(12,2) not null default 0,
  position     integer not null default 0
);

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms (id) on delete cascade,
  invoice_id    uuid not null references public.invoices (id),
  provider      text not null, -- 'paystack' | 'stripe'
  provider_ref  text not null unique,
  amount        numeric(12,2) not null,
  currency      text not null check (currency in ('NGN', 'USD')),
  status        public.payment_status not null default 'pending',
  paid_at       timestamptz,
  raw           jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table public.webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,
  event_type    text,
  provider_ref  text,
  status        text not null default 'received', -- received | processed | ignored | failed
  error         text,
  payload       jsonb not null default '{}'::jsonb,
  received_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Matters: parties, timeline, court diary, documents, messaging, tasks
-- ---------------------------------------------------------------------------

create table public.matter_parties (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  matter_id   uuid not null references public.matters (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.party_role not null default 'client',
  added_by    uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  unique (matter_id, user_id)
);

create table public.matter_lawyers (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references public.firms (id) on delete cascade,
  matter_id   uuid not null references public.matters (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  is_lead     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (matter_id, user_id)
);

create table public.updates (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms (id) on delete cascade,
  matter_id    uuid not null references public.matters (id) on delete cascade,
  author_id    uuid references auth.users (id),
  visibility   public.update_visibility not null default 'client',
  kind         text not null default 'note', -- note | court_update | document | system
  title        text not null,
  body         text,
  document_id  uuid, -- FK added after documents exists
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create table public.court_events (
  id                 uuid primary key default gen_random_uuid(),
  firm_id            uuid not null references public.firms (id) on delete cascade,
  matter_id          uuid not null references public.matters (id) on delete cascade,
  scheduled_at       timestamptz not null,
  court              text,
  purpose            text,
  outcome            public.court_outcome,
  adjourned_by       public.adjourned_instance,
  outcome_update_id  uuid references public.updates (id) on delete set null,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now()
);

create table public.documents (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references public.firms (id) on delete cascade,
  matter_id           uuid references public.matters (id) on delete cascade,
  appointment_id      uuid references public.appointments (id) on delete set null,
  owner_id            uuid not null references auth.users (id),
  title               text not null,
  is_client_visible   boolean not null default true,
  current_version_id  uuid, -- FK added after document_versions exists
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.document_versions (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms (id) on delete cascade,
  document_id   uuid not null references public.documents (id) on delete cascade,
  version       integer not null default 1,
  storage_path  text not null, -- documents/{firm_id}/{document_id}/{version_id}.{ext}
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  unique (document_id, version)
);

alter table public.updates
  add constraint updates_document_id_fkey
  foreign key (document_id) references public.documents (id) on delete set null;

alter table public.documents
  add constraint documents_current_version_id_fkey
  foreign key (current_version_id) references public.document_versions (id) on delete set null;

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms (id) on delete cascade,
  matter_id    uuid not null references public.matters (id) on delete cascade,
  sender_id    uuid not null references auth.users (id),
  body         text not null,
  document_id  uuid references public.documents (id) on delete set null,
  created_at   timestamptz not null default now()
);

create table public.message_reads (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table public.invites (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms (id) on delete cascade,
  matter_id    uuid references public.matters (id) on delete cascade,
  role         public.party_role not null default 'client',
  phone        text,
  email        text,
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  status       public.invite_status not null default 'pending',
  invited_by   uuid references auth.users (id),
  expires_at   timestamptz not null default now() + interval '14 days',
  accepted_by  uuid references auth.users (id),
  accepted_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (phone is not null or email is not null)
);

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms (id) on delete cascade,
  matter_id     uuid references public.matters (id) on delete cascade,
  title         text not null,
  assignee_id   uuid references auth.users (id),
  due_at        timestamptz,
  status        public.task_status not null default 'open',
  created_by    uuid references auth.users (id),
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notifications (the outbox drained by the dispatch-notifications function)
-- ---------------------------------------------------------------------------

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid references public.firms (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  channel         public.notification_channel not null,
  event           text not null, -- appointment_confirmed | reminder_24h | court_update | …
  title           text not null,
  body            text,
  url             text,
  status          public.notification_status not null default 'queued',
  scheduled_for   timestamptz not null default now(),
  sent_at         timestamptz,
  read_at         timestamptz,
  error           text,
  attempts        integer not null default 0,
  appointment_id  uuid references public.appointments (id) on delete cascade,
  matter_id       uuid references public.matters (id) on delete cascade,
  dedupe_key      text unique,
  created_at      timestamptz not null default now()
);

create table public.notification_preferences (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users (id) on delete cascade,
  event    text not null,
  channel  public.notification_channel not null,
  enabled  boolean not null default true,
  unique (user_id, event, channel)
);

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit and public content
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id          bigint generated always as identity primary key,
  firm_id     uuid,
  actor_id    uuid,
  action      text not null,
  entity      text not null,
  entity_id   text,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create table public.content (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms (id) on delete cascade,
  key           text not null, -- home.hero, about.body, …
  locale        text not null default 'en',
  body          jsonb not null default '{}'::jsonb,
  is_published  boolean not null default false,
  updated_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (firm_id, key, locale)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index firm_members_user_idx on public.firm_members (user_id);
create index consent_records_user_idx on public.consent_records (user_id, consent);
create index services_firm_idx on public.services (firm_id) where is_active;
create index lawyer_profiles_firm_public_idx on public.lawyer_profiles (firm_id) where is_public;
create index availability_rules_lawyer_idx on public.availability_rules (lawyer_id, weekday) where is_active;
create index appointments_firm_starts_idx on public.appointments (firm_id, starts_at);
create index appointments_client_idx on public.appointments (client_id, starts_at);
create index appointments_lawyer_day_idx on public.appointments (lawyer_id, starts_at);
create index appointments_hold_idx on public.appointments (hold_expires_at) where status = 'held';
create index intake_responses_appt_idx on public.intake_responses (appointment_id);
create index invoices_client_idx on public.invoices (client_id);
create index invoices_firm_status_idx on public.invoices (firm_id, status);
create index payments_invoice_idx on public.payments (invoice_id);
create index matters_firm_idx on public.matters (firm_id);
create index matter_parties_user_idx on public.matter_parties (user_id);
create index matter_lawyers_user_idx on public.matter_lawyers (user_id);
create index updates_matter_idx on public.updates (matter_id, created_at desc);
create index court_events_matter_idx on public.court_events (matter_id, scheduled_at);
create index court_events_unreported_idx on public.court_events (firm_id, scheduled_at)
  where outcome_update_id is null;
create index documents_matter_idx on public.documents (matter_id);
create index document_versions_document_idx on public.document_versions (document_id);
create index messages_matter_idx on public.messages (matter_id, created_at);
create index notifications_outbox_idx on public.notifications (status, scheduled_for)
  where status = 'queued';
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index audit_log_firm_idx on public.audit_log (firm_id, created_at desc);
create index content_firm_idx on public.content (firm_id, key) where is_published;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'firms', 'profiles', 'services', 'lawyer_profiles', 'intake_forms',
    'appointments', 'consultation_notes', 'matters', 'invoices',
    'documents', 'content'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function app.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Anonymous tenant resolution: the only firm data the public internet sees.
-- The view runs with its owner's rights, so anon never touches public.firms.
-- ---------------------------------------------------------------------------

create view public.firm_public as
  select id, slug, name, custom_domain, brand, policies, currency, timezone
  from public.firms
  where is_active;

-- ---------------------------------------------------------------------------
-- Grants. Row-level security (migration 2) does the real authorization; these
-- grants only define the widest possible surface per Supabase role.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to authenticated, service_role;

-- service_role: full access (used only by Edge Functions).
grant all on all tables in schema public to service_role;

-- authenticated: RLS-guarded access to everything.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- anon: the public browsing surface only.
grant select on public.firm_public to anon, authenticated;
grant select on public.services, public.lawyer_profiles, public.content,
  public.intake_forms, public.availability_rules, public.availability_exceptions
  to anon;

-- Nobody mutates or reads audit_log directly; app.audit() (security definer,
-- migration 3) is the only writer and the owner/admin policy the only reader.
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated, service_role;
