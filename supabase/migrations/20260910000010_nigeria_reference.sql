-- Docket — migration 10: the Nigerian dispensation as reference data.
--
-- A Nigerian matter lives in a specific court of a specific hierarchy, carries
-- a suit number in that court's format, is argued by a legal practitioner
-- enrolled at the Supreme Court, and moves around the legal year, public
-- holidays and court vacations. Until now all of that was free text
-- (matters.court_name). This migration gives every firm on Docket the same
-- structured vocabulary so court updates, cause lists, reminders and — in
-- Phase 2 — judiciary integrations speak the courts' own language.
--
--   ng_states           36 states + FCT (ISO 3166-2:NG codes), geopolitical zone
--   court_level / courts the hierarchy (Constitution 1999 s.6 courts, magistrate
--                       and customary/area/sharia courts, tribunals, multi-door
--                       courthouses), platform-wide rows plus firm-private ones
--   public_holidays     fixed-date national holidays; movable Islamic holidays
--                       are declared each year by the Federal Government and
--                       added by the platform when gazetted
--   court_vacations     annual/Christmas/Easter vacation windows per court, set
--                       from each court's practice direction (no invented dates)
--   lawyer_profiles     SCN (Supreme Court enrolment number), year of call, NBA branch
--   matters             court_id, judicial_division; matter_type gains criminal, arbitration
--
-- Everything is additive. post_court_update() keeps accepting free-text court
-- names; court_id is the structured companion.

-- ---------------------------------------------------------------- states
create table public.ng_states (
  code    text primary key,                       -- ISO 3166-2:NG suffix: LA, FC, RI …
  name    text not null unique,
  capital text not null,
  zone    text not null check (zone in ('North Central','North East','North West','South East','South South','South West'))
);
insert into public.ng_states (code, name, capital, zone) values
  ('AB','Abia','Umuahia','South East'),        ('AD','Adamawa','Yola','North East'),
  ('AK','Akwa Ibom','Uyo','South South'),      ('AN','Anambra','Awka','South East'),
  ('BA','Bauchi','Bauchi','North East'),       ('BY','Bayelsa','Yenagoa','South South'),
  ('BE','Benue','Makurdi','North Central'),    ('BO','Borno','Maiduguri','North East'),
  ('CR','Cross River','Calabar','South South'),('DE','Delta','Asaba','South South'),
  ('EB','Ebonyi','Abakaliki','South East'),    ('ED','Edo','Benin City','South South'),
  ('EK','Ekiti','Ado-Ekiti','South West'),     ('EN','Enugu','Enugu','South East'),
  ('FC','Federal Capital Territory','Abuja','North Central'),
  ('GO','Gombe','Gombe','North East'),         ('IM','Imo','Owerri','South East'),
  ('JI','Jigawa','Dutse','North West'),        ('KD','Kaduna','Kaduna','North West'),
  ('KN','Kano','Kano','North West'),           ('KT','Katsina','Katsina','North West'),
  ('KE','Kebbi','Birnin Kebbi','North West'),  ('KO','Kogi','Lokoja','North Central'),
  ('KW','Kwara','Ilorin','North Central'),     ('LA','Lagos','Ikeja','South West'),
  ('NA','Nasarawa','Lafia','North Central'),   ('NI','Niger','Minna','North Central'),
  ('OG','Ogun','Abeokuta','South West'),       ('ON','Ondo','Akure','South West'),
  ('OS','Osun','Osogbo','South West'),         ('OY','Oyo','Ibadan','South West'),
  ('PL','Plateau','Jos','North Central'),      ('RI','Rivers','Port Harcourt','South South'),
  ('SO','Sokoto','Sokoto','North West'),       ('TA','Taraba','Jalingo','North East'),
  ('YO','Yobe','Damaturu','North East'),       ('ZA','Zamfara','Gusau','North West');

alter table public.firms add constraint firms_state_code_fkey foreign key (state_code) references public.ng_states;

-- ---------------------------------------------------------------- courts
create type public.court_level as enum (
  'supreme',              -- Supreme Court of Nigeria
  'court_of_appeal',      -- Court of Appeal, by judicial division
  'federal_high',         -- Federal High Court, by judicial division
  'fct_high',             -- High Court of the Federal Capital Territory
  'state_high',           -- High Court of a State
  'national_industrial',  -- National Industrial Court of Nigeria
  'sharia_appeal',        -- Sharia Court of Appeal (FCT and states that have one)
  'customary_appeal',     -- Customary Court of Appeal (FCT and states that have one)
  'magistrate',           -- Magistrates' Courts (states)
  'district',             -- District Courts (FCT and northern states)
  'customary',            -- Customary Courts
  'area',                 -- Area Courts
  'sharia',               -- Sharia Courts
  'tribunal',             -- statutory tribunals (Tax Appeal, Investment & Securities, Code of Conduct …)
  'multi_door'            -- Multi-Door Courthouses (court-connected ADR)
);

create table public.courts (
  id               uuid primary key default gen_random_uuid(),
  firm_id          uuid references public.firms on delete cascade,   -- null = platform-wide; set = private to that firm
  level            public.court_level not null,
  name             text not null,
  short_name       text,
  state_code       text references public.ng_states,
  division         text,                                              -- judicial division / district
  city             text,
  suit_number_hint text,                                              -- the registry's format, e.g. FHC/L/CS/123/2026
  is_active        bool not null default true,
  sort             int  not null default 0,
  created_by       uuid references public.profiles,
  created_at       timestamptz not null default now()
);
comment on table public.courts is
  'Court directory. firm_id null = maintained by the platform for every firm; firm_id set = a firm''s own addition (a particular magistrate court, a tribunal panel) visible only to that firm.';
-- a court's full name is its natural key (within the platform directory, or within one firm's additions)
create unique index courts_platform_key on public.courts (name) where firm_id is null;
create unique index courts_firm_key     on public.courts (firm_id, name) where firm_id is not null;
create index courts_state_idx on public.courts (state_code, level) where is_active;

alter table public.courts enable row level security;
create policy courts_select on public.courts for select using (firm_id is null or is_firm_member(firm_id));
create policy courts_write  on public.courts for all
  using (firm_id is not null and staff_w(firm_id))
  with check (firm_id is not null and staff_w(firm_id) and created_by = auth.uid());
-- platform-wide rows are maintained with the service role / SQL only
grant select on public.ng_states to anon, authenticated;

-- Supreme Court
insert into public.courts (level, name, short_name, state_code, city, suit_number_hint, sort) values
  ('supreme', 'Supreme Court of Nigeria', 'SC', 'FC', 'Abuja', 'SC/CV/123/2026', 10);

-- Court of Appeal judicial divisions
insert into public.courts (level, name, short_name, state_code, division, city, suit_number_hint, sort)
select 'court_of_appeal', 'Court of Appeal, ' || d.division || ' Judicial Division', 'CA ' || d.division,
       d.state_code, d.division, d.city, 'CA/' || d.abbr || '/123/2026', 20
from (values
  ('Abuja','FC','Abuja','ABJ'),        ('Lagos','LA','Lagos','L'),          ('Enugu','EN','Enugu','E'),
  ('Kaduna','KD','Kaduna','K'),        ('Ibadan','OY','Ibadan','IB'),       ('Benin','ED','Benin City','B'),
  ('Jos','PL','Jos','J'),              ('Calabar','CR','Calabar','C'),      ('Ilorin','KW','Ilorin','IL'),
  ('Port Harcourt','RI','Port Harcourt','PH'), ('Owerri','IM','Owerri','OW'), ('Ekiti','EK','Ado-Ekiti','EK'),
  ('Yola','AD','Yola','YL'),           ('Sokoto','SO','Sokoto','S'),        ('Akure','ON','Akure','AK'),
  ('Makurdi','BE','Makurdi','MK'),     ('Gombe','GO','Gombe','G'),          ('Asaba','DE','Asaba','AS'),
  ('Kano','KN','Kano','KN'),           ('Awka','AN','Awka','AW')
) as d(division, state_code, city, abbr);

-- Federal High Court: a judicial division in every state and the FCT
insert into public.courts (level, name, short_name, state_code, division, city, suit_number_hint, sort)
select 'federal_high', 'Federal High Court, ' || s.capital || ' Judicial Division', 'FHC ' || s.capital,
       s.code, s.capital, s.capital,
       'FHC/' || case s.code when 'LA' then 'L' when 'FC' then 'ABJ' when 'RI' then 'PH' when 'OY' then 'IB'
                             when 'ED' then 'B' when 'EN' then 'EN' when 'KD' then 'KD' when 'KN' then 'KN'
                             else s.code end || '/CS/123/2026', 30
from public.ng_states s;

-- High Court of the FCT and of every state
insert into public.courts (level, name, short_name, state_code, city, suit_number_hint, sort) values
  ('fct_high', 'High Court of the Federal Capital Territory', 'FCT High Court', 'FC', 'Abuja', 'FCT/HC/CV/123/2026', 40);
insert into public.courts (level, name, short_name, state_code, city, suit_number_hint, sort)
select 'state_high', 'High Court of ' || s.name || ' State', s.name || ' High Court', s.code, s.capital,
       case s.code when 'LA' then 'LD/1234GCM/2026' else '<division>/123/2026' end, 41
from public.ng_states s where s.code <> 'FC';

-- National Industrial Court of Nigeria (employment and labour), by judicial division
insert into public.courts (level, name, short_name, state_code, division, city, suit_number_hint, sort)
select 'national_industrial', 'National Industrial Court, ' || d.division || ' Judicial Division', 'NICN ' || d.division,
       d.state_code, d.division, d.division, 'NICN/' || d.abbr || '/123/2026', 50
from (values
  ('Abuja','FC','ABJ'), ('Lagos','LA','LA'), ('Kano','KN','KAN'), ('Enugu','EN','EN'), ('Port Harcourt','RI','PHC'),
  ('Ibadan','OY','IB'), ('Calabar','CR','CA'), ('Kaduna','KD','KD'), ('Jos','PL','JOS'), ('Yola','AD','YL'),
  ('Owerri','IM','OW'), ('Akure','ON','AK'), ('Benin','ED','BEN'), ('Sokoto','SO','SK'), ('Gombe','GO','GM'),
  ('Awka','AN','AWK'), ('Asaba','DE','ASB'), ('Uyo','AK','UYO'), ('Bauchi','BA','BAU'), ('Makurdi','BE','MKD'),
  ('Ilorin','KW','IL'), ('Minna','NI','MN'), ('Lokoja','KO','LKJ')
) as d(division, state_code, abbr);

-- Sharia and Customary Courts of Appeal of the FCT (states add their own — see docs)
insert into public.courts (level, name, short_name, state_code, city, suit_number_hint, sort) values
  ('sharia_appeal',    'Sharia Court of Appeal of the Federal Capital Territory',    'FCT Sharia CoA',    'FC', 'Abuja', 'SCA/ABJ/123/2026', 60),
  ('customary_appeal', 'Customary Court of Appeal of the Federal Capital Territory', 'FCT Customary CoA', 'FC', 'Abuja', 'CCA/ABJ/123/2026', 61);

-- Magistrates' Courts (states) and District Courts (FCT) as one row per jurisdiction; firms add specific courts
insert into public.courts (level, name, short_name, state_code, city, suit_number_hint, sort)
select 'magistrate', 'Magistrates'' Court of ' || s.name || ' State', s.name || ' Magistrates', s.code, s.capital, 'MC/<district>/123/2026', 70
from public.ng_states s where s.code <> 'FC';
insert into public.courts (level, name, short_name, state_code, city, suit_number_hint, sort) values
  ('district', 'District Court of the Federal Capital Territory', 'FCT District Court', 'FC', 'Abuja', 'DC/<district>/123/2026', 71);

-- statutory tribunals and multi-door courthouses
insert into public.courts (level, name, short_name, state_code, city, suit_number_hint, sort) values
  ('tribunal',   'Tax Appeal Tribunal',                     'TAT',  'FC', 'Abuja', 'TAT/<zone>/123/2026', 80),
  ('tribunal',   'Investment and Securities Tribunal',      'IST',  'FC', 'Abuja', 'IST/OA/123/2026',     81),
  ('tribunal',   'Code of Conduct Tribunal',                'CCT',  'FC', 'Abuja', 'CCT/ABJ/123/2026',    82),
  ('multi_door', 'Lagos Multi-Door Courthouse',             'LMDC', 'LA', 'Lagos', 'LMDC/123/2026',       90),
  ('multi_door', 'Abuja Multi-Door Courthouse',             'AMDC', 'FC', 'Abuja', 'AMDC/123/2026',       91);

-- ---------------------------------------------------------------- holidays and vacations
create table public.public_holidays (
  country text not null default 'NG',
  on_date date not null,
  name    text not null,
  primary key (country, on_date)
);
comment on table public.public_holidays is
  'Public Holidays Act holidays. Fixed dates are seeded per year; Eid-el-Fitr, Eid-el-Kabir and Eid-el-Maulud are declared annually by the Federal Government and inserted when gazetted (they shift about 11 days a year).';
insert into public.public_holidays (on_date, name) values
  ('2026-01-01', 'New Year''s Day'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-05-01', 'Workers'' Day'),
  ('2026-06-12', 'Democracy Day'),
  ('2026-10-01', 'Independence Day'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-26', 'Boxing Day');

create table public.court_vacations (
  id         uuid primary key default gen_random_uuid(),
  level      public.court_level,          -- null = every court
  state_code text references public.ng_states,   -- null = every state
  name       text not null,               -- Annual Vacation, Christmas Vacation, Easter Vacation
  starts_on  date not null,
  ends_on    date not null,
  note       text,                         -- vacation judge arrangements, practice direction reference
  check (ends_on >= starts_on)
);
comment on table public.court_vacations is
  'Vacation windows from each court''s annual practice direction (typically an annual vacation from mid-July to mid-September, plus Christmas and Easter). Entered by the platform when published; nothing is assumed.';

alter table public.public_holidays enable row level security;
alter table public.court_vacations enable row level security;
create policy public_holidays_select on public.public_holidays for select using (true);
create policy court_vacations_select on public.court_vacations for select using (true);
grant select on public.public_holidays, public.court_vacations to anon, authenticated;
revoke insert, update, delete on public.public_holidays, public.court_vacations, public.ng_states from anon, authenticated;

create or replace function public.is_public_holiday(p_date date, p_country text default 'NG') returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public_holidays where country = p_country and on_date = p_date) $$;

-- true when a sitting date falls on a weekend, a public holiday or a published vacation of that court
create or replace function public.is_non_sitting_day(p_date date, p_level public.court_level default null, p_state text default null) returns bool
  language sql stable security definer set search_path = public as
  $$ select extract(isodow from p_date) >= 6
         or public.is_public_holiday(p_date)
         or exists (select 1 from court_vacations v
                    where p_date between v.starts_on and v.ends_on
                      and (v.level is null or v.level = p_level)
                      and (v.state_code is null or v.state_code = p_state)) $$;
grant execute on function public.is_public_holiday(date, text) to anon, authenticated;
grant execute on function public.is_non_sitting_day(date, public.court_level, text) to anon, authenticated;

-- ---------------------------------------------------------------- legal practitioners
alter table public.lawyer_profiles
  add column scn          text,                                    -- Supreme Court enrolment number
  add column year_of_call smallint check (year_of_call between 1900 and 2100),
  add column nba_branch   text;
comment on column public.lawyer_profiles.scn is 'Supreme Court of Nigeria enrolment number of the legal practitioner (Legal Practitioners Act). Shown on court processes, not on the public site.';
comment on column public.lawyer_profiles.year_of_call is 'Year called to the Nigerian Bar. A plain fact the Rules of Professional Conduct allow a firm to state.';

drop view if exists public.lawyer_public;
create view public.lawyer_public with (security_invoker = false) as
  select lp.firm_id, lp.user_id as id, lp.slug, lp.title, lp.bio, lp.photo_path,
         lp.practice_areas, lp.category, lp.year_of_call, p.full_name, p.timezone
  from public.lawyer_profiles lp
  join public.profiles p on p.id = lp.user_id
  where lp.is_public;
grant select on public.lawyer_public to anon, authenticated;

-- ---------------------------------------------------------------- matters in a court
alter type public.matter_type add value if not exists 'criminal';
alter type public.matter_type add value if not exists 'arbitration';

alter table public.matters
  add column court_id          uuid references public.courts on delete set null,
  add column judicial_division text;
alter table public.court_events
  add column court_id uuid references public.courts on delete set null;
create index matters_court_idx on public.matters (firm_id, court_id) where deleted_at is null;

comment on column public.matters.court_id   is 'Structured court (courts table); court_name stays as the display/free-text companion.';
comment on column public.matters.suit_number is 'As assigned by the court registry, in that court''s format (see courts.suit_number_hint).';

-- Firms may only point a matter at a court they can see (platform-wide, or their own private row).
create or replace function public.check_matter_court() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.court_id is not null and not exists (
       select 1 from courts c where c.id = new.court_id and (c.firm_id is null or c.firm_id = new.firm_id)) then
    raise exception 'court % is not available to this firm', new.court_id;
  end if;
  if new.court_id is not null and new.court_name is null then
    select name into new.court_name from courts where id = new.court_id;
  end if;
  return new;
end $$;
create trigger matters_check_court before insert or update of court_id on public.matters
  for each row execute function public.check_matter_court();
