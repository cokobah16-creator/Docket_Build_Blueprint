-- Verified delegation: who may act for a client, on what, until when — and the record of why the
-- firm believed them.
--
-- The assessment's #10b. Today a client is a login, and that is the whole model: whoever holds the
-- session IS the client. A company's matters sit in the name of one natural person, so when the
-- company secretary changes there is no way to end the old one's access or start the new one's
-- except by sharing a password. An elderly client's daughter, a litigant's assistant, a receiver
-- appointed over a company — none of them can be given access with a scope, an end date, or a
-- record of the authority the firm saw. A firm doing this properly today has to choose between
-- refusing a legitimate representative and handing over a login.
--
-- TWO SWITCHES THE FIRM WAS SHOWN AND THE DATABASE NEVER ASKED. Before any of that, this migration
-- settles a defect it found on the way. matter_parties has carried can_view_docs and can_pay since
-- migration 1, and the console prints them at two places as though they were controls — "Can read
-- shared documents" / "No document access", "cannot see documents · cannot pay". Nothing in the
-- database has ever consulted either column, and nothing in the app has ever written one. So a firm
-- that believed it had limited a contact had limited nothing.
--
--  · can_view_docs is made real here: the three document helpers ask it, so it reaches the rows,
--    the versions and — through the storage policies, which call the same helpers — the object
--    bytes. It defaults to true, so no existing party loses anything the day this is applied.
--  · can_pay is NOT made real for a party, because for a party it never meant anything: a contact
--    does not see invoices at all (invoices_select admits the billed client alone), so there was no
--    read to restrict. Inventing a feature to justify a label is the wrong repair. The label is
--    removed from the console instead, and the column is given the one meaning it can honestly
--    carry — below, where a representative may be allowed to see and pay what their principal owes.
--
-- HOW A REPRESENTATION WORKS, AND WHY IT IS SHAPED THIS WAY.
--
--  · It is granted by staff with a second factor, against a recorded authority: what the firm saw
--    (a board resolution, a power of attorney, a court order, the person in the room), its
--    reference, optionally the uploaded document, and which lawyer verified it, on what day.
--    Docket does not verify anybody's identity and this migration does not pretend otherwise — it
--    records that a named lawyer did, against a named thing, and makes that record permanent.
--  · A SHARED PHONE NUMBER CONFERS NOTHING. The grant names no representative. It carries the
--    email or phone the firm was given purely so the invitation can be sent, and the person is
--    bound to it only by redeeming a single-use token while signed in as themselves. No row
--    anywhere is matched on a phone number or an email address to decide who may act for whom, and
--    the suite asserts it: a second profile carrying the same details gains nothing at all.
--  · Liveness is the database's, not a job's. is_matter_party() — the one function every
--    client-side policy already calls — is re-created here to test the representation at the
--    moment of the read: accepted, not revoked, started, not expired, with the day compared in the
--    firm's own timezone because starts_on and expires_on are calendar days and never instants. An
--    expired representation therefore grants nothing the second it expires, with no cron to run
--    late and no row to clean up.
--  · The rights are narrow and default closed. The base right — see the matter, its timeline, its
--    court dates, exchange messages — is what a representation is for. Documents need can_view_docs
--    and money needs can_pay, both off unless the firm says otherwise, and signing is never
--    delegated at all: record_signature() asks for the matter's own client and a representative is
--    not one. A person who may act is not thereby a person who may execute.
--  · The principal is told. Granting, acceptance and revocation each notify the client whose
--    matters are being opened, because the single best control against a representation nobody
--    asked for is that the person it is about hears of it.
--  · The principal may end it. Revocation is the client's as well as the firm's — it is their
--    matter — and revoking is immediate. It cannot recall what has already been read or
--    downloaded, and the screens say so in those words, as the service-of-process exchange does.

-- ================================================================ 1. the switch that was never asked
-- The client arm now asks the party's own can_view_docs. The member arm is untouched.
create or replace function public.party_may_see_docs(m uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from matter_parties mp
                  where mp.matter_id = m and mp.user_id = auth.uid() and mp.can_view_docs)
$$;
comment on function public.party_may_see_docs(uuid) is
  'A party to this matter, whose own can_view_docs is true. The column has existed since migration 1 and was consulted by nothing until now.';

-- ================================================================ 2. representations
create table public.representations (
  id                    uuid primary key default gen_random_uuid(),
  firm_id               uuid not null references public.firms(id) on delete cascade,
  -- Whose authority is being exercised. A business client is a profile with client_type 'business'
  -- and a company_name, so a company officer is a representation over that profile.
  principal_id          uuid not null references public.profiles(id) on delete cascade,
  -- Null until somebody redeems the token. This is the only way it is ever set.
  representative_id     uuid references public.profiles(id) on delete set null,
  capacity              text not null check (capacity in ('company_officer','attorney','family','carer','employee','receiver','other')),
  -- The company or body acted for, when that is what this is. Recorded, not inferred.
  organisation_name     text check (organisation_name is null or length(btrim(organisation_name)) between 2 and 200),
  scope                 text not null default 'matter' check (scope in ('matter','all_matters')),
  matter_id             uuid references public.matters(id) on delete cascade,
  can_view_docs         boolean not null default false,
  can_pay               boolean not null default false,
  starts_on             date not null default current_date,
  expires_on            date,
  -- What the firm saw, and who looked at it.
  authority_kind        text not null check (authority_kind in ('board_resolution','power_of_attorney','letter_of_authority','court_order','in_person','other')),
  authority_ref         text check (authority_ref is null or length(btrim(authority_ref)) between 2 and 200),
  authority_document_id uuid references public.documents(id) on delete set null,
  verification_note     text check (verification_note is null or length(verification_note) <= 2000),
  verified_by           uuid not null references public.profiles(id) on delete restrict,
  verified_at           timestamptz not null default now(),
  -- The invitation. These are how it is SENT, never how anyone is matched.
  invited_email         text,
  invited_phone         text,
  token                 text unique not null default encode(gen_random_bytes(24), 'hex'),
  token_expires_at      timestamptz not null default now() + interval '14 days',
  accepted_at           timestamptz,
  revoked_at            timestamptz,
  revoked_by            uuid references public.profiles(id) on delete set null,
  revoke_reason         text check (revoke_reason is null or length(revoke_reason) <= 1000),
  created_at            timestamptz not null default now(),
  constraint representations_scope_chk check ((scope = 'matter') = (matter_id is not null)),
  constraint representations_dates_chk check (expires_on is null or expires_on >= starts_on),
  -- A firm must record something it saw. 'in_person' is a real answer, and then the note is the
  -- record; every other kind names a document or a reference.
  constraint representations_authority_chk check (
    authority_ref is not null or authority_document_id is not null
    or (authority_kind = 'in_person' and verification_note is not null)),
  constraint representations_not_self_chk check (representative_id is null or representative_id <> principal_id)
);
create index representations_firm_idx      on public.representations (firm_id, principal_id);
create index representations_rep_idx       on public.representations (representative_id) where representative_id is not null;
create index representations_matter_idx    on public.representations (matter_id) where matter_id is not null;

alter table public.representations enable row level security;
-- Read: the firm's staff who may see the matter, the principal, and the representative themselves.
-- Nobody else, and no anonymous arm — a representation names a client and their authorised agent.
create policy representations_select on public.representations for select
  using (matter_row_r(firm_id, matter_id)
         or principal_id = (select auth.uid())
         or representative_id = (select auth.uid()));
-- NO write policy and NO write grant, on purpose: the three functions below are the only doors.
-- This is the rule the firm_members escalation, the invoice door and the documents door each
-- taught — a guarded function beside a writable table is not a guard.
revoke insert, update, delete on public.representations from anon, authenticated;

create trigger representations_firm_guard before insert or update on public.representations
  for each row execute function public.check_row_firm();
create trigger representations_audit after insert or update or delete on public.representations
  for each row execute function public.audit_row_change();

comment on table public.representations is
  'Who may act for a client, on what, until when, and the authority the firm recorded. Written only by grant_representation(), accept_representation() and revoke_representation().';
comment on column public.representations.invited_email is
  'Where the invitation was sent. NEVER how a representative is identified: only redeeming the token binds a person.';

-- Live means all of it: accepted, not revoked, started, not expired — with the day read in the
-- firm's own timezone, because these are calendar days and a DATE is never timezone-shifted.
create or replace function public.representation_live(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from representations rp join firms f on f.id = rp.firm_id
     where rp.id = r
       and rp.accepted_at is not null
       and rp.revoked_at is null
       and rp.representative_id is not null
       and rp.starts_on <= (now() at time zone coalesce(f.timezone, 'Africa/Lagos'))::date
       and (rp.expires_on is null
            or rp.expires_on >= (now() at time zone coalesce(f.timezone, 'Africa/Lagos'))::date))
$$;

/**
 * Does the caller hold a live representation reaching this matter, and does it carry this right?
 * p_right: 'base' (see the matter and its timeline), 'docs', 'pay'.
 */
create or replace function public.acts_for_matter(m uuid, p_right text default 'base') returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from representations rp
     where rp.representative_id = auth.uid()
       and public.representation_live(rp.id)
       and (rp.matter_id = m
            -- Firm-wide: every matter of that firm the principal is themselves a party to. A matter
            -- opened tomorrow is covered without anything being written, and a matter the principal
            -- leaves stops being covered the same way.
            or (rp.scope = 'all_matters'
                and exists (select 1 from matter_parties pp
                             where pp.matter_id = m and pp.user_id = rp.principal_id)
                and exists (select 1 from matters mt where mt.id = m and mt.firm_id = rp.firm_id)))
       and case p_right when 'docs' then rp.can_view_docs
                        when 'pay'  then rp.can_pay
                        else true end)
$$;
revoke execute on function public.representation_live(uuid) from public;
revoke execute on function public.acts_for_matter(uuid, text) from public;
grant  execute on function public.representation_live(uuid), public.acts_for_matter(uuid, text) to anon, authenticated;

-- The one function every client-side policy already calls. A representation reaches a matter here,
-- once, rather than through twenty separate policy edits — and it reaches it only while live.
create or replace function public.is_matter_party(m uuid) returns bool
language sql stable security definer set search_path = public as $$
  select exists (select 1 from matter_parties mp where mp.matter_id = m and mp.user_id = auth.uid())
      or public.acts_for_matter(m, 'base')
$$;

-- Documents: the client arm now asks for the right, from whichever side the reader comes.
-- is_matter_party() above would otherwise have opened every document to every representative, which
-- is exactly the fail-open this slice is meant to avoid.
create or replace function public.can_access_document(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from documents doc
     where doc.id = d
       and ( public.matter_row_r(doc.firm_id, doc.matter_id)
          or (doc.client_visible and doc.deleted_at is null
              and ( public.party_may_see_docs(doc.matter_id)
                 or public.acts_for_matter(doc.matter_id, 'docs')
                 or public.is_appointment_client(doc.appointment_id))) ) )
$$;
create or replace function public.can_access_document_version(v uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from document_versions dv join documents doc on doc.id = dv.document_id
     where dv.id = v
       and ( public.matter_row_r(doc.firm_id, doc.matter_id)
          or (doc.client_visible and doc.deleted_at is null
              and ( public.party_may_see_docs(doc.matter_id)
                 or public.acts_for_matter(doc.matter_id, 'docs')
                 or public.is_appointment_client(doc.appointment_id)))
          or exists (select 1 from process_service ps
                      where ps.document_version_id = dv.id and public.is_served_firm(ps.id)) ) )
$$;

-- Uploading is a document act too: a representative may add to the file only if the firm trusted
-- them with documents at all.
create or replace function public.can_upload_document(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from documents doc
     where doc.id = d and doc.deleted_at is null
       and ( public.matter_row_w(doc.firm_id, doc.matter_id)
          or (doc.client_visible
              and ( public.party_may_see_docs(doc.matter_id)
                 or public.acts_for_matter(doc.matter_id, 'docs')
                 or public.is_appointment_client(doc.appointment_id))) ) )
$$;

-- Money. can_pay earns its meaning here and nowhere else: a representative the firm has trusted
-- with it may see what their principal owes on the matters they cover, and pay it. A party's own
-- can_pay still decides nothing, because a party still never sees an invoice.
/**
 * Does the caller act, with the money right, for the person this invoice is billed to?
 *
 * It is a function rather than a subquery in the policy, and that is not tidiness. A subquery
 * inside a policy runs under the caller's RLS as well, so the obvious version — `exists (select 1
 * from matter_parties …)` written into the USING clause — always read false: a representative
 * cannot see the matter_parties row naming their own principal. A policy that needs a fact the
 * caller may not read has to ask a definer function for it.
 */
create or replace function public.acts_for_client(m uuid, p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from representations rp
     where rp.representative_id = auth.uid()
       and rp.can_pay
       and rp.principal_id = p_client
       and public.representation_live(rp.id)
       and (rp.matter_id = m
            or (rp.scope = 'all_matters'
                and exists (select 1 from matter_parties pp where pp.matter_id = m and pp.user_id = rp.principal_id)
                and exists (select 1 from matters mt where mt.id = m and mt.firm_id = rp.firm_id))))
$$;
revoke execute on function public.acts_for_client(uuid, uuid) from public;
grant  execute on function public.acts_for_client(uuid, uuid) to anon, authenticated;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using (matter_row_r(firm_id, matter_id)
         or (client_id = (select auth.uid()) and status <> 'draft'::invoice_status)
         or (matter_id is not null and status <> 'draft'::invoice_status
             and acts_for_client(matter_id, client_id)));

-- ---------------------------------------------------------------- the three doors
create or replace function public.grant_representation(
  p_firm uuid, p_principal uuid, p_capacity text, p_authority_kind text,
  p_matter uuid default null, p_organisation text default null,
  p_can_view_docs boolean default false, p_can_pay boolean default false,
  p_expires_on date default null, p_authority_ref text default null,
  p_authority_document uuid default null, p_note text default null,
  p_invited_email text default null, p_invited_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_token text; v_tz text; v_today date;
begin
  if not staff_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  select coalesce(timezone, 'Africa/Lagos') into v_tz from firms where id = p_firm;
  v_today := (now() at time zone v_tz)::date;

  -- The principal must actually be this firm's client. Otherwise a member could mint an authority
  -- over a stranger and invite themselves to it.
  if not exists (select 1 from matter_parties mp join matters mt on mt.id = mp.matter_id
                  where mp.user_id = p_principal and mt.firm_id = p_firm)
     and not exists (select 1 from appointments a where a.client_id = p_principal and a.firm_id = p_firm) then
    raise exception 'that person is not a client of this firm';
  end if;
  if exists (select 1 from firm_members fm where fm.firm_id = p_firm and fm.user_id = p_principal) then
    raise exception 'a member of the firm is not represented by an outsider on the firm''s own files';
  end if;
  if p_matter is not null then
    if not exists (select 1 from matters mt where mt.id = p_matter and mt.firm_id = p_firm) then
      raise exception 'that matter is not this firm''s';
    end if;
    if not can_see_matter(p_matter) then raise exception 'not permitted' using errcode = '42501'; end if;
    if not exists (select 1 from matter_parties mp where mp.matter_id = p_matter and mp.user_id = p_principal) then
      raise exception 'that person is not a party to that matter';
    end if;
  end if;
  if p_expires_on is not null and p_expires_on < v_today then
    raise exception 'an authority that has already expired grants nothing — give a day in the future, or none';
  end if;
  if p_authority_document is not null
     and not exists (select 1 from documents d where d.id = p_authority_document and d.firm_id = p_firm) then
    raise exception 'that authority document is not this firm''s';
  end if;

  insert into representations (firm_id, principal_id, capacity, organisation_name,
                               scope, matter_id, can_view_docs, can_pay, starts_on, expires_on,
                               authority_kind, authority_ref, authority_document_id, verification_note,
                               verified_by, invited_email, invited_phone)
  values (p_firm, p_principal, p_capacity, nullif(btrim(coalesce(p_organisation, '')), ''),
          case when p_matter is null then 'all_matters' else 'matter' end, p_matter,
          coalesce(p_can_view_docs, false), coalesce(p_can_pay, false), v_today, p_expires_on,
          p_authority_kind, nullif(btrim(coalesce(p_authority_ref, '')), ''), p_authority_document,
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid(),
          nullif(btrim(lower(coalesce(p_invited_email, ''))), ''), nullif(btrim(coalesce(p_invited_phone, '')), ''))
  returning id, token into v_id, v_token;

  perform audit('representation.granted', 'representation', v_id, p_firm,
                jsonb_build_object('principal_id', p_principal, 'matter_id', p_matter, 'capacity', p_capacity,
                                   'scope', case when p_matter is null then 'all_matters' else 'matter' end,
                                   'can_view_docs', coalesce(p_can_view_docs, false), 'can_pay', coalesce(p_can_pay, false),
                                   'expires_on', p_expires_on, 'authority_kind', p_authority_kind));
  -- The person whose files are being opened hears about it, before anybody uses it.
  perform enqueue_notification(p_principal, p_firm, 'representation_granted',
            jsonb_build_object('representation_id', v_id, 'capacity', p_capacity,
                               'organisation', nullif(btrim(coalesce(p_organisation, '')), ''),
                               'matter_id', p_matter, 'expires_on', p_expires_on));
  return jsonb_build_object('representation_id', v_id, 'token', v_token);
end $$;
revoke execute on function public.grant_representation(uuid, uuid, text, text, uuid, text, boolean, boolean, date, text, uuid, text, text, text) from public, anon;
grant  execute on function public.grant_representation(uuid, uuid, text, text, uuid, text, boolean, boolean, date, text, uuid, text, text, text) to authenticated;

-- Redeeming the token is the ONLY act that binds a person to a representation. Nothing is matched
-- on the email or phone the firm recorded.
create or replace function public.accept_representation(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r representations%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into r from representations
   where token = p_token and accepted_at is null and revoked_at is null and token_expires_at > now()
     for update;
  if not found then raise exception 'that invitation is not valid, or has already been used'; end if;
  if r.principal_id = auth.uid() then
    raise exception 'you are the client on these files already — an authority to act for yourself is not a thing';
  end if;
  if exists (select 1 from firm_members fm where fm.firm_id = r.firm_id and fm.user_id = auth.uid()) then
    raise exception 'a member of the firm cannot also act for its client' using errcode = '42501';
  end if;
  -- Where the firm recorded who it was inviting, the person redeeming must BE them. profiles.email
  -- and profiles.phone are unique, so this is a real second condition and not a formality: holding
  -- the link is not enough, and holding the phone number is not enough either. Neither confers
  -- anything alone — which is the whole of "a shared phone number must not confer representation".
  -- Where the firm recorded neither, the token alone binds, because the firm chose to name nobody.
  if r.invited_email is not null or r.invited_phone is not null then
    if not exists (select 1 from profiles p
                    where p.id = auth.uid()
                      and ( (r.invited_email is not null and lower(p.email) = lower(r.invited_email))
                         or (r.invited_phone is not null and p.phone = r.invited_phone))) then
      raise exception 'this invitation was sent to somebody else — sign in as the person the firm named'
        using errcode = '42501';
    end if;
  end if;

  update representations set representative_id = auth.uid(), accepted_at = now() where id = r.id;
  perform audit('representation.accepted', 'representation', r.id, r.firm_id,
                jsonb_build_object('principal_id', r.principal_id, 'matter_id', r.matter_id));
  perform enqueue_notification(r.principal_id, r.firm_id, 'representation_accepted',
            jsonb_build_object('representation_id', r.id, 'matter_id', r.matter_id, 'capacity', r.capacity));
  perform enqueue_notification(r.verified_by, r.firm_id, 'representation_accepted_staff',
            jsonb_build_object('representation_id', r.id, 'matter_id', r.matter_id, 'principal_id', r.principal_id));
  return jsonb_build_object('representation_id', r.id, 'firm_id', r.firm_id, 'matter_id', r.matter_id);
end $$;
revoke execute on function public.accept_representation(text) from public, anon;
grant  execute on function public.accept_representation(text) to authenticated;

-- The firm may end it. So may the client: they are their own files' principal, and an authority
-- somebody else can end but they cannot is not one they truly granted.
create or replace function public.revoke_representation(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r representations%rowtype;
begin
  select * into r from representations where id = p_id for update;
  if not found then raise exception 'not found'; end if;
  if r.revoked_at is not null then return; end if;   -- already ended; saying so twice changes nothing
  if not (matter_row_w(r.firm_id, r.matter_id) or r.principal_id = auth.uid()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update representations
     set revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id;
  perform audit('representation.revoked', 'representation', p_id, r.firm_id,
                jsonb_build_object('principal_id', r.principal_id, 'representative_id', r.representative_id,
                                   'matter_id', r.matter_id, 'by_principal', r.principal_id = auth.uid(),
                                   'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  perform enqueue_notification(r.principal_id, r.firm_id, 'representation_revoked',
            jsonb_build_object('representation_id', p_id, 'matter_id', r.matter_id));
  if r.representative_id is not null then
    perform enqueue_notification(r.representative_id, r.firm_id, 'representation_revoked',
              jsonb_build_object('representation_id', p_id, 'matter_id', r.matter_id));
  end if;
end $$;
revoke execute on function public.revoke_representation(uuid, text) from public, anon;
grant  execute on function public.revoke_representation(uuid, text) to authenticated;

-- ================================================================ 3. a changed phone number is an identity event
-- profiles.phone and profiles.email are the owner's to change, and the dispatcher sends to whatever
-- they currently say — so changing a phone number silently redirects a firm's SMS about a matter to
-- a new handset. That is the ordinary way an account is taken over, and until now it left no trace
-- anywhere.
--
-- WHAT THIS CAN AND CANNOT DO, PLAINLY. Docket cannot warn the old number: once the column is
-- overwritten it no longer holds it, and enqueue_notification sends to a person, not to an address.
-- So the control is not a message to the old handset — it is that the change is written down with
-- the old value beside the new one, the firm is told, and a human can ring the number that used to
-- be the client's. Nothing here verifies anybody's identity and nothing here claims to.
create table public.identity_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  field       text not null check (field in ('phone', 'email')),
  old_value   text,
  new_value   text,
  changed_at  timestamptz not null default now()
);
create index identity_events_user_idx on public.identity_events (user_id, changed_at desc);
alter table public.identity_events enable row level security;
-- The person themselves, and the staff of any firm they are a client of. Append-only: no update or
-- delete policy and no write grant, so not even the person it is about can tidy it away.
create policy identity_events_select on public.identity_events for select
  using (user_id = (select auth.uid())
         or exists (select 1 from matter_parties mp join matters mt on mt.id = mp.matter_id
                     where mp.user_id = identity_events.user_id and is_firm_member(mt.firm_id))
         or exists (select 1 from appointments a
                     where a.client_id = identity_events.user_id and is_firm_member(a.firm_id)));
revoke insert, update, delete on public.identity_events from anon, authenticated;

create or replace function public.record_identity_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if new.phone is distinct from old.phone then
    insert into identity_events (user_id, field, old_value, new_value) values (new.id, 'phone', old.phone, new.phone);
  end if;
  if new.email is distinct from old.email then
    insert into identity_events (user_id, field, old_value, new_value) values (new.id, 'email', old.email, new.email);
  end if;
  if (new.phone is distinct from old.phone) or (new.email is distinct from old.email) then
    -- Every firm this person is a client of is told once, to its owners and admins: this is a
    -- thing a human should look at, not a counter.
    for f in select distinct mt.firm_id from matter_parties mp join matters mt on mt.id = mp.matter_id where mp.user_id = new.id
             union
             select distinct a.firm_id from appointments a where a.client_id = new.id
    loop
      perform enqueue_notification(fm.user_id, f.firm_id, 'client_contact_changed',
                jsonb_build_object('client_id', new.id,
                                   'phone_changed', new.phone is distinct from old.phone,
                                   'email_changed', new.email is distinct from old.email))
        from firm_members fm where fm.firm_id = f.firm_id and fm.role in ('owner', 'admin');
    end loop;
  end if;
  return new;
end $$;
create trigger profiles_identity_events after update of phone, email on public.profiles
  for each row execute function public.record_identity_change();

comment on table public.identity_events is
  'Append-only record of a client changing the phone number or email a firm reaches them on, with the old value kept. Not a verification: the point is that a human can ring the number that used to be theirs.';
