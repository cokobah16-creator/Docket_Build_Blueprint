-- Docket v0.2 — schema
-- Multi-tenant: every firm-owned row carries firm_id. Attorneys Klinique is tenant #1 (see seed.sql).

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- types
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

-- ---------------------------------------------------------------- identity and tenancy
create table profiles (
  id                uuid primary key references auth.users on delete cascade,
  full_name         text,
  phone             text unique,
  email             text unique,
  country           text,
  state             text,
  address           text,
  client_type       client_type default 'individual',
  company_name      text,
  timezone          text not null default 'Africa/Lagos',
  locale            text not null default 'en',
  preferred_channel channel not null default 'sms',
  created_at        timestamptz not null default now()
);

create table firms (
  id                 uuid primary key default gen_random_uuid(),
  slug               text unique not null,
  name               text not null,
  legal_name         text,
  rc_number          text,
  reference_prefix   text not null default 'DK',
  custom_domain      text unique,
  timezone           text not null default 'Africa/Lagos',
  default_currency   currency not null default 'NGN',
  vat_rate           numeric(5,2) not null default 0,
  brand              jsonb not null default '{}',   -- logo, colours, fonts, contact, social
  policies           jsonb not null default '{}',   -- cancellation, terms, privacy, disclaimers (versioned)
  paystack_subaccount text,
  stripe_account     text,
  created_at         timestamptz not null default now()
);

create table firm_members (
  firm_id  uuid not null references firms on delete cascade,
  user_id  uuid not null references profiles on delete cascade,
  role     firm_role not null,
  primary key (firm_id, user_id)
);

create table firm_counters (               -- per-firm, per-year reference numbering
  firm_id uuid not null references firms on delete cascade,
  kind    text not null,
  year    int  not null,
  value   int  not null default 0,
  primary key (firm_id, kind, year)
);

create table lawyer_profiles (
  firm_id        uuid not null references firms on delete cascade,
  user_id        uuid not null references profiles on delete cascade,
  slug           text,
  title          text,
  bio            text,
  photo_path     text,
  practice_areas text[] not null default '{}',
  category       text,
  is_public      bool not null default true,
  primary key (firm_id, user_id),
  unique (firm_id, slug)
);

-- ---------------------------------------------------------------- catalogue and intake
create table services (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references firms on delete cascade,
  slug                text not null,
  name                text not null,
  description         text,
  price_minor         bigint not null check (price_minor >= 0),
  currency            currency not null default 'NGN',
  duration_min        int not null check (duration_min > 0),
  lawyer_category     text,
  requires_prepayment bool not null default true,
  virtual_available   bool not null default true,
  is_active           bool not null default true,
  sort                int not null default 0,
  unique (firm_id, slug)
);

create table intake_forms (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references firms on delete cascade,
  service_id uuid references services on delete set null,
  name       text,
  schema     jsonb not null,                -- {questions:[{key,type,label,options,required,show_if}]}
  is_active  bool not null default true
);

create table intake_responses (
  id             uuid primary key default gen_random_uuid(),
  form_id        uuid references intake_forms on delete set null,
  firm_id        uuid not null references firms on delete cascade,
  appointment_id uuid,
  client_id      uuid not null references profiles on delete cascade,
  answers        jsonb not null,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- availability and appointments
create table availability_rules (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms on delete cascade,
  lawyer_id   uuid not null references profiles on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time  time not null,
  end_time    time not null,
  break_start time,
  break_end   time,
  slot_min    int not null default 45,
  max_per_day int not null default 6,
  check (end_time > start_time)
);

create table availability_exceptions (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references firms on delete cascade,
  lawyer_id    uuid not null references profiles on delete cascade,
  on_date      date not null,
  is_available bool not null default false,   -- false = blocked (whole day if no times)
  start_time   time,
  end_time     time,
  reason       text
);

create table appointments (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references firms on delete cascade,
  reference           text unique not null,                       -- AK-2026-000123
  client_id           uuid not null references profiles,
  lawyer_id           uuid references profiles,
  service_id          uuid references services,
  matter_id           uuid,
  mode                appointment_mode not null default 'virtual',
  status              appointment_status not null default 'pending',
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  client_timezone     text,
  fee_minor           bigint,
  currency            currency,
  invoice_id          uuid,
  hold_expires_at     timestamptz,
  reminders_sent      text[] not null default '{}',
  cancellation_reason text,
  created_at          timestamptz not null default now(),
  check (ends_at > starts_at),
  -- a lawyer can never hold two live appointments that overlap
  exclude using gist (lawyer_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status in ('pending','awaiting_payment','confirmed','rescheduled'))
);
alter table intake_responses add foreign key (appointment_id) references appointments on delete set null;

create table consultation_sessions (
  id                 uuid primary key default gen_random_uuid(),
  firm_id            uuid not null references firms on delete cascade,
  appointment_id     uuid not null unique references appointments on delete cascade,
  provider           text not null default 'daily',
  room_name          text unique,
  room_expires_at    timestamptz,
  client_admitted_at timestamptz,
  started_at         timestamptz,
  ended_at           timestamptz,
  events             jsonb not null default '[]'
);

-- client-visible notes and internal notes are separate tables so row-level security can keep them apart
create table consultation_notes (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references firms on delete cascade,
  appointment_id uuid not null unique references appointments on delete cascade,
  matter_id      uuid,
  lawyer_id      uuid references profiles,
  client_summary text,
  advice_given   text,
  follow_up      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table consultation_internal_notes (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references firms on delete cascade,
  appointment_id uuid not null unique references appointments on delete cascade,
  body           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------- matters
create table matter_statuses (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms on delete cascade,
  key         text not null,
  label       text not null,
  colour      text,
  sort        int not null default 0,
  is_terminal bool not null default false,
  unique (firm_id, key)
);

create table matters (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references firms on delete cascade,
  reference       text unique not null,
  title           text not null,
  type            matter_type not null,
  status_id       uuid references matter_statuses,
  description     text,
  next_action     text,
  court_name      text,
  suit_number     text,
  judge           text,
  opposing_party  text,
  next_event_at   timestamptz,
  next_event_note text,
  opened_at       date not null default current_date,
  closed_at       date,
  deleted_at      timestamptz,
  created_by      uuid references profiles,
  created_at      timestamptz not null default now()
);
alter table appointments       add foreign key (matter_id) references matters on delete set null;
alter table consultation_notes add foreign key (matter_id) references matters on delete set null;

create table matter_parties (              -- client-side access to a matter
  matter_id     uuid not null references matters on delete cascade,
  firm_id       uuid not null references firms on delete cascade,
  user_id       uuid not null references profiles on delete cascade,
  role          party_role not null,
  can_view_docs bool not null default true,
  can_pay       bool not null default true,
  invited_by    uuid references profiles,
  primary key (matter_id, user_id)
);

create table matter_lawyers (
  matter_id uuid not null references matters on delete cascade,
  firm_id   uuid not null references firms on delete cascade,
  user_id   uuid not null references profiles on delete cascade,
  is_lead   bool not null default false,
  primary key (matter_id, user_id)
);

create table updates (                     -- the timeline
  id          uuid primary key default gen_random_uuid(),
  matter_id   uuid not null references matters on delete cascade,
  firm_id     uuid not null references firms on delete cascade,
  kind        update_kind not null,
  visibility  visibility not null default 'client',
  title       text not null,
  body        text,
  payload     jsonb not null default '{}',   -- court_sitting: {outcome, adjourned_at_instance_of, next_date, next_purpose}
  occurred_at timestamptz not null default now(),
  posted_by   uuid references profiles,
  created_at  timestamptz not null default now()
);

create table court_events (
  id                uuid primary key default gen_random_uuid(),
  matter_id         uuid not null references matters on delete cascade,
  firm_id           uuid not null references firms on delete cascade,
  scheduled_at      timestamptz not null,
  court_name        text,
  purpose           text,
  outcome_update_id uuid references updates on delete set null,
  reminders_sent    text[] not null default '{}'
);

create table tasks (                       -- Phase 2 UI, Phase 1 schema
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms on delete cascade,
  matter_id   uuid references matters on delete cascade,
  assignee_id uuid references profiles,
  title       text not null,
  due_at      timestamptz,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- documents and messages
create table documents (
  id                 uuid primary key default gen_random_uuid(),
  firm_id            uuid not null references firms on delete cascade,
  matter_id          uuid references matters on delete cascade,
  appointment_id     uuid references appointments on delete cascade,
  name               text not null,
  category           text,
  client_visible     bool not null default false,
  current_version_id uuid,
  uploaded_by        uuid references profiles,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  check (matter_id is not null or appointment_id is not null)
);

create table document_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents on delete cascade,
  storage_path text not null,
  mime         text,
  size_bytes   bigint,
  checksum     text,
  uploaded_by  uuid references profiles,
  created_at   timestamptz not null default now()
);
alter table documents add foreign key (current_version_id) references document_versions on delete set null;

create table messages (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references firms on delete cascade,
  matter_id      uuid references matters on delete cascade,
  appointment_id uuid references appointments on delete cascade,
  sender_id      uuid references profiles,
  body           text,
  attachments    jsonb not null default '[]',
  read_at        timestamptz,
  created_at     timestamptz not null default now(),
  check (matter_id is not null or appointment_id is not null)
);

-- ---------------------------------------------------------------- money
create table invoices (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references firms on delete cascade,
  number         text unique not null,
  client_id      uuid not null references profiles,
  matter_id      uuid references matters on delete set null,
  appointment_id uuid references appointments on delete set null,
  currency       currency not null,
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  vat_minor      bigint not null default 0,
  total_minor    bigint not null,
  paid_minor     bigint not null default 0,
  status         invoice_status not null default 'draft',
  issued_at      timestamptz,
  due_at         date,
  created_at     timestamptz not null default now()
);
alter table appointments add foreign key (invoice_id) references invoices on delete set null;

create table invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices on delete cascade,
  description text not null,
  quantity    numeric not null default 1,
  unit_minor  bigint not null
);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices,
  provider     text not null,
  provider_ref text unique not null,
  status       payment_status not null default 'initiated',
  amount_minor bigint not null,
  currency     currency not null,
  paid_at      timestamptz,
  raw          jsonb
);

-- ---------------------------------------------------------------- notifications, consent, content, operations
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,
  firm_id    uuid references firms on delete cascade,
  channel    channel not null,
  event      text not null,
  payload    jsonb not null default '{}',
  status     text not null default 'queued',       -- queued | sent | failed | skipped
  send_after timestamptz not null default now(),
  sent_at    timestamptz,
  read_at    timestamptz,
  error      text,
  created_at timestamptz not null default now()
);

create table notification_preferences (
  user_id uuid not null references profiles on delete cascade,
  event   text not null,
  channel channel not null,
  enabled bool not null default true,
  primary key (user_id, event, channel)
);

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,
  endpoint   text unique not null,
  keys       jsonb not null,
  user_agent text,
  created_at timestamptz not null default now()
);

create table consent_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles on delete cascade,
  firm_id     uuid references firms on delete cascade,
  kind        consent_kind not null,
  version     text not null,
  accepted_at timestamptz not null default now(),
  ip          inet,
  user_agent  text
);

create table content (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references firms on delete cascade,
  kind         content_kind not null,
  slug         text,
  title        text,
  body         text,
  status       text not null default 'draft',
  published_at timestamptz,
  unique (firm_id, kind, slug)
);

create table invites (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms on delete cascade,
  matter_id   uuid references matters on delete cascade,
  phone       text,
  email       text,
  role        party_role not null default 'client',
  token       text unique not null default encode(gen_random_bytes(24), 'hex'),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_by uuid references profiles,
  created_by  uuid references profiles,
  created_at  timestamptz not null default now()
);

create table conflict_checks (             -- Phase 2
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms on delete cascade,
  matter_id   uuid references matters on delete cascade,
  query       jsonb,
  matches     jsonb,
  outcome     text,
  reviewed_by uuid references profiles,
  reviewed_at timestamptz
);

create table audit_log (
  id        bigserial primary key,
  firm_id   uuid,
  actor_id  uuid,
  action    text not null,
  entity    text not null,
  entity_id uuid,
  meta      jsonb not null default '{}',
  ip        inet,
  at        timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes
create index on firm_members (user_id);
create index on services (firm_id) where is_active;
create index on appointments (firm_id, starts_at);
create index on appointments (lawyer_id, starts_at);
create index on appointments (client_id, starts_at);
create index on appointments (status, hold_expires_at) where status = 'awaiting_payment';
create index on matters (firm_id, status_id) where deleted_at is null;
create index on matter_parties (user_id);
create index on updates (matter_id, occurred_at desc);
create index on court_events (matter_id, scheduled_at);
create index on court_events (scheduled_at) where outcome_update_id is null;
create index on documents (matter_id) where deleted_at is null;
create index on documents (appointment_id) where deleted_at is null;
create index on messages (matter_id, created_at);
create index on messages (appointment_id, created_at);
create index on invoices (firm_id, status);
create index on invoices (client_id);
create index on notifications (status, send_after) where status = 'queued';
create index on notifications (user_id, created_at desc);
create index on audit_log (firm_id, at desc);

-- ---------------------------------------------------------------- hard grants (belt and braces under RLS)
revoke all on audit_log     from anon, authenticated;
revoke all on firm_counters from anon, authenticated;
revoke insert, update, delete on payments              from anon, authenticated;
revoke insert, update, delete on consultation_sessions from anon, authenticated;
revoke insert, delete         on notifications         from anon, authenticated;
grant  select on audit_log to authenticated;      -- rows still gated by RLS (owner/admin only)

-- public-safe projection of firms for tenant sites (anon may read this, never the firms table)
create view firm_public with (security_invoker = false) as
  select id, slug, name, brand, custom_domain, timezone, default_currency from firms;
grant select on firm_public to anon, authenticated;
