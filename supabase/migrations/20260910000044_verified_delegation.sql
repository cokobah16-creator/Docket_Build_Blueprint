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
  -- The name of whoever redeemed it, captured then. The principal is not a member of the firm, so
  -- can_see_profile() does not let them read the representative's profile row — without this their
  -- own screen could not tell them who is acting for them, which is what that screen is for.
  representative_name   text,
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
  constraint representations_not_self_chk check (representative_id is null or representative_id <> principal_id),
  -- An authority must NAME somebody. Without this the acceptance check below has nothing to compare
  -- against and skips itself, so any holder of the link binds — which is the whole thing this slice
  -- exists to prevent. "The firm chose to name nobody" is not a case worth supporting for an
  -- authority over another person's legal files.
  constraint representations_invitee_chk check (invited_email is not null or invited_phone is not null)
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
            --
            -- EXCEPT A WALLED ONE. `access = 'team'` is here because otherwise delegation walks
            -- straight through migration 29: a lawyer outside a restricted matter's team could
            -- grant an all-matters authority to somebody of their choosing and reach it that way.
            -- A restricted matter is reached only by an authority that NAMES it, and naming it at
            -- grant time asks can_see_matter() of the lawyer granting it. Fail-closed on purpose: a
            -- firm that raises a wall tomorrow narrows every standing all-matters authority that
            -- day, which is the safe direction for a change nobody re-reviewed.
            or (rp.scope = 'all_matters'
                and exists (select 1 from matter_parties pp
                             where pp.matter_id = m and pp.user_id = rp.principal_id)
                and exists (select 1 from matters mt
                             where mt.id = m and mt.firm_id = rp.firm_id and mt.access = 'firm')))
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

-- Finding from review: widening is_matter_party() also widened documents_client_insert (migration
-- 21), which authorised a client-visible INSERT on that predicate alone. can_upload_document()
-- guards the version and the bytes, but the first write — the document ROW — went through the base
-- right. A representative trusted with nothing but the matter could therefore create a document on
-- the file. The policy now asks for the documents right from whichever side the writer comes.
drop policy if exists documents_client_insert on public.documents;
create policy documents_client_insert on public.documents for insert
  with check (uploaded_by = (select auth.uid()) and client_visible
              and ( public.party_may_see_docs(matter_id)
                 or public.acts_for_matter(matter_id, 'docs')
                 or public.is_appointment_client(appointment_id)));

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
                -- Walled matters are excluded here too, for the reason acts_for_matter() gives.
                and exists (select 1 from matters mt
                             where mt.id = m and mt.firm_id = rp.firm_id and mt.access = 'firm'))))
$$;
revoke execute on function public.acts_for_client(uuid, uuid) from public;
grant  execute on function public.acts_for_client(uuid, uuid) to anon, authenticated;

-- Finding from review: exposing the invoice ROW alone made can_pay useless. invoice_items_select
-- and payments_select both ask can_access_invoice(), and invoice_settlement() — which the payment
-- action needs before it can reach Paystack — had its own copy of the same test. So a
-- representative the firm trusted with money saw an invoice with no items, no history, and a
-- refusal when they pressed pay. A right the product offers and the database refuses is exactly the
-- kind of claim this codebase is not allowed to make, so the predicate is fixed in one place and
-- the settlement function is brought to it.
--
-- While re-creating it: the member arm becomes matter_row_r() rather than is_firm_member(). Since
-- migration 29 the invoices SELECT policy has been walled and this function has not, so a colleague
-- outside a restricted matter's team could read that matter's invoice ITEMS — the narrative of the
-- work — through invoice_items_select. That is a wall hole nobody had noticed; it closes here. An
-- invoice with no matter (a consultation fee) is unaffected: matter_row_r(f, null) is is_firm_member(f).
create or replace function public.can_access_invoice(i uuid) returns bool
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from invoices inv
     where inv.id = i
       and ( public.matter_row_r(inv.firm_id, inv.matter_id)
          or (inv.client_id = auth.uid() and inv.status <> 'draft')
          or (inv.matter_id is not null and inv.status <> 'draft'
              and public.acts_for_client(inv.matter_id, inv.client_id))))
$$;

create or replace function public.invoice_settlement(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype; v_sub text; v_status text;
begin
  select * into v_inv from invoices where id = p_invoice;
  if not found or not (v_inv.client_id = auth.uid()
                       or is_firm_member(v_inv.firm_id)
                       or (v_inv.matter_id is not null and v_inv.status <> 'draft'
                           and acts_for_client(v_inv.matter_id, v_inv.client_id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  select paystack_subaccount, status into v_sub, v_status from firms where id = v_inv.firm_id;
  return jsonb_build_object('paystack_subaccount', v_sub, 'firm_status', v_status,
                            'invoice_number', v_inv.number, 'total_minor', v_inv.total_minor, 'currency', v_inv.currency);
end $$;

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
  -- An all-matters authority is refused outright where this client has a matter the granting lawyer
  -- cannot see. acts_for_matter() already refuses to reach a walled matter through such an
  -- authority, so this is belt to that brace — but it is the half that produces a sentence a lawyer
  -- can act on, instead of an authority that silently covers less than they think.
  if p_matter is null and exists (
       select 1 from matter_parties mp join matters mt on mt.id = mp.matter_id
        where mp.user_id = p_principal and mt.firm_id = p_firm and mt.deleted_at is null
          and not can_see_matter(mt.id)) then
    raise exception 'this client has a matter you cannot see, so an authority over all of them is not yours to give — grant it on the matters you can, one at a time';
  end if;
  if p_expires_on is not null and p_expires_on < v_today then
    raise exception 'an authority that has already expired grants nothing — give a day in the future, or none';
  end if;
  if nullif(btrim(lower(coalesce(p_invited_email, ''))), '') is null
     and nullif(btrim(coalesce(p_invited_phone, '')), '') is null then
    raise exception 'name the person: an authority is taken up by somebody signed in as the email or phone you record here, and by nobody else';
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
declare r representations%rowtype; v_email text; v_phone text; v_name text;
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
  -- The person redeeming must BE the person the firm named, and the table requires one to be named.
  --
  -- MEASURED AGAINST THE IDENTITY PROVIDER, NOT THE PROFILE. An earlier draft compared
  -- profiles.email / profiles.phone, which the owner may edit through profiles_update: where the
  -- invited address did not yet belong to anybody, a holder of the link could simply write it onto
  -- their own profile and then satisfy the check. The unique index on those columns only stops that
  -- when the real person already has an account — which is precisely the case where an invitation
  -- was least needed. So the comparison is against auth.users, where the address is what the person
  -- authenticated with and nothing in `public` can rewrite it. accept_staff_invite() has done it
  -- this way since migration 14; this is the same rule for the same reason.
  select coalesce(auth.jwt() ->> 'email', (select u.email from auth.users u where u.id = auth.uid())),
         coalesce(auth.jwt() ->> 'phone', (select u.phone from auth.users u where u.id = auth.uid()))
    into v_email, v_phone;
  if not ( (r.invited_email is not null and v_email is not null and lower(v_email) = lower(r.invited_email))
        or (r.invited_phone is not null and v_phone is not null and btrim(v_phone) = btrim(r.invited_phone))
        -- A phone as Supabase stores it has no leading '+'; the firm types one. Compare the digits.
        or (r.invited_phone is not null and v_phone is not null
            and regexp_replace(v_phone, '\D', '', 'g') = regexp_replace(r.invited_phone, '\D', '', 'g')) ) then
    raise exception 'this invitation was sent to somebody else — sign in as the person the firm named'
      using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(full_name), ''), v_email, v_phone) into v_name from profiles where id = auth.uid();
  update representations
     set representative_id = auth.uid(), accepted_at = now(),
         representative_name = coalesce(v_name, 'A person')
   where id = r.id;
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
