-- Where a firm stands, from one place; and bringing an existing caseload onto Docket.
--
-- Two screens computed "can a client book?" separately and disagreed (the admin overview asked
-- three facts, the services page five). book_appointment() is the truth, so firm_readiness()
-- asks its gates in its order and adds the setup facts a checklist needs, and both screens read
-- that one function. A step that cannot be derived — "we will not take online payments" — is the
-- only thing persisted, as a skip with who and why, never as a "done" flag for a fact.
--
-- An import is staged, not streamed: the browser parses the file and stages rows; the database
-- processes them a bounded batch at a time, each row on its own, so a bad row fails alone and a
-- re-run continues where it stopped. Nothing is faked to make a row fit: an unknown status key
-- fails the row rather than filing the matter without one, and a client is linked only where the
-- firm could already see that person — otherwise an invitation is created, as for any client.
-- A historical matter keeps its dates (opened_at, closed_at are calendar days) and its old file
-- number (matters.legacy_reference; the Docket reference is still minted by next_reference()),
-- and no client-visible "Matter opened today" line is posted — the client sees nothing until
-- they accept, and then the timeline as the firm keeps it.
--
-- A client is never linked by a phone number or an email address in a spreadsheet. Those are
-- typed by the firm and, on a profile, by the person themselves — neither is verified — so a
-- match would let anyone who can be seen by the firm claim another person's file by changing
-- their own number. Every client row becomes an invitation, as for any client: the token is the
-- proof, and an existing Docket account accepts it like a new one. A number that belongs to a
-- member of the firm is refused, and where the firm requires conflict clearance before a client
-- joins a matter, the invitation waits for the clearance, as invite_matter_party() makes it.

-- ---------------------------------------------------------------- 1. the old file number
alter table public.matters add column legacy_reference text check (legacy_reference is null or length(legacy_reference) between 1 and 80);
create index matters_legacy_reference_idx on public.matters (firm_id, legacy_reference) where legacy_reference is not null;
comment on column public.matters.legacy_reference is 'The file number the firm used before Docket. Never the minted reference; unique per firm only by the import''s duplicate check.';

-- ---------------------------------------------------------------- 2. what cannot be derived: a skipped step
create table public.firm_onboarding_steps (
  firm_id    uuid not null references public.firms(id) on delete cascade,
  step       text not null check (step in ('policies', 'operations', 'settlement', 'people', 'profile', 'availability', 'services', 'intake', 'brand', 'service_of_process', 'import', 'domain')),
  skipped_at timestamptz not null default now(),
  skipped_by uuid references public.profiles(id) on delete set null,
  note       text check (note is null or length(note) <= 500),
  primary key (firm_id, step)
);
alter table public.firm_onboarding_steps enable row level security;
create policy firm_onboarding_steps_select on public.firm_onboarding_steps for select using (is_firm_member(firm_id));
revoke all on public.firm_onboarding_steps from anon, authenticated;
grant select on public.firm_onboarding_steps to authenticated;
comment on table public.firm_onboarding_steps is 'A checklist step an owner or admin chose to skip, with who and why. Facts are never stored here — they are computed by firm_readiness().';

create or replace function public.skip_onboarding_step(p_firm uuid, p_step text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not admin_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  insert into firm_onboarding_steps (firm_id, step, skipped_by, note)
  values (p_firm, p_step, auth.uid(), nullif(btrim(p_note), ''))
  on conflict (firm_id, step) do update set skipped_at = now(), skipped_by = excluded.skipped_by, note = excluded.note;
  perform audit('onboarding.step_skipped', 'firm', p_firm, p_firm, jsonb_build_object('step', p_step, 'note', p_note));
end $$;
create or replace function public.resume_onboarding_step(p_firm uuid, p_step text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not admin_w(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  delete from firm_onboarding_steps where firm_id = p_firm and step = p_step;
  perform audit('onboarding.step_resumed', 'firm', p_firm, p_firm, jsonb_build_object('step', p_step));
end $$;
revoke execute on function public.skip_onboarding_step(uuid, text, text) from public, anon;
grant  execute on function public.skip_onboarding_step(uuid, text, text) to authenticated;
revoke execute on function public.resume_onboarding_step(uuid, text) from public, anon;
grant  execute on function public.resume_onboarding_step(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 3. where the firm stands: one function, book_appointment()'s order
create or replace function public.firm_readiness(p_firm uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare f firms%rowtype; v jsonb; v_active int; v_all int; v_rules int; v_public int; v_needs_settlement bool;
        v_members int; v_owners int; v_lawyers int; v_intake int; v_matters int; v_clients int; v_invites int;
        v_issued bool; v_published bool; v_skipped jsonb; v_domain text;
begin
  if not is_firm_member(p_firm) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into f from firms where id = p_firm;
  v_published := firm_policies_published(p_firm);
  select count(*) filter (where is_active), count(*) into v_active, v_all from services where firm_id = p_firm;
  select exists (select 1 from services where firm_id = p_firm and is_active and price_minor > 0 and requires_prepayment) into v_needs_settlement;
  select count(*) into v_rules from availability_rules where firm_id = p_firm;
  select count(*) into v_public from lawyer_profiles where firm_id = p_firm and is_public;
  select count(*), count(*) filter (where role = 'owner'), count(*) filter (where role in ('owner', 'admin', 'lawyer')) into v_members, v_owners, v_lawyers from firm_members where firm_id = p_firm;
  select count(*) into v_intake from intake_forms where firm_id = p_firm and is_active;
  select count(*) into v_matters from matters where firm_id = p_firm and deleted_at is null;
  select count(distinct user_id) into v_clients from matter_parties where firm_id = p_firm and role = 'client';
  select count(*) into v_invites from invites where firm_id = p_firm and accepted_by is null and expires_at > now();
  -- Any reference: the prefix locks at the first one of any kind, which is what the settings screen enforces.
  select exists (select 1 from firm_counters where firm_id = p_firm) into v_issued;
  select coalesce(jsonb_object_agg(step, jsonb_build_object('at', skipped_at, 'by', skipped_by, 'note', note)), '{}'::jsonb) into v_skipped from firm_onboarding_steps where firm_id = p_firm;
  select status into v_domain from domain_requests where firm_id = p_firm and status in ('requested', 'verifying') order by created_at desc limit 1;

  v := jsonb_build_object(
    'status', f.status, 'verified_at', f.verified_at, 'slug', f.slug,
    'policies_published', v_published,
    'reference_prefix', f.reference_prefix, 'reference_issued', v_issued,
    'settlement_account', f.paystack_subaccount is not null, 'needs_settlement', v_needs_settlement,
    'active_services', v_active, 'all_services', v_all,
    'availability_rules', v_rules, 'public_lawyers', v_public,
    'members', v_members, 'owners', v_owners, 'lawyers', v_lawyers,
    'intake_forms', v_intake,
    'brand_colours', (f.brand -> 'colours' ->> 'primary') is not null,
    'brand_logo', (f.brand ->> 'logo_path') is not null,
    'address_for_service', nullif(btrim(coalesce(f.address_for_service ->> 'chambers', '')), '') is not null,
    'accepts_platform_service', f.accepts_platform_service,
    'matters', v_matters, 'clients', v_clients, 'pending_invites', v_invites,
    'custom_domain', f.custom_domain, 'domain_request', v_domain,
    'skipped', v_skipped
  );
  -- The three states a firm is in, from the booking engine's own gates, in its order.
  v := v || jsonb_build_object('gates', jsonb_build_object(
    'site_open', f.status = 'active',
    'bookable', f.status = 'active' and v_published and v_rules > 0 and v_public > 0
                and exists (select 1 from services s where s.firm_id = p_firm and s.is_active
                             and (f.paystack_subaccount is not null or not (s.requires_prepayment and s.price_minor > 0))),
    'payment_ready', f.paystack_subaccount is not null or not v_needs_settlement
  ));
  return v;
end $$;
revoke execute on function public.firm_readiness(uuid) from public, anon;
grant  execute on function public.firm_readiness(uuid) to authenticated;

-- ---------------------------------------------------------------- 4. the import, staged
create table public.import_batches (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id) on delete cascade,
  kind         text not null default 'matters' check (kind in ('matters')),
  source_name  text check (source_name is null or length(source_name) <= 200),
  row_count    int not null default 0 check (row_count >= 0),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index import_batches_firm_idx on public.import_batches (firm_id, created_at desc);
create table public.import_rows (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.import_batches(id) on delete cascade,
  firm_id      uuid not null references public.firms(id) on delete cascade,
  row_no       int not null check (row_no >= 1),
  raw          jsonb not null default '{}'::jsonb,
  skip         boolean not null default false,
  outcome      text check (outcome is null or outcome in ('created', 'skipped', 'failed')),
  matter_id    uuid references public.matters(id) on delete set null,
  invite_id    uuid references public.invites(id) on delete set null,
  note         text,
  processed_at timestamptz,
  unique (batch_id, row_no)
);
create index import_rows_pending_idx on public.import_rows (batch_id, row_no) where processed_at is null;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
-- Owners and admins stage and read; processing is the function's. Rows carry what a firm
-- typed about its clients, so the read is as narrow as the write. Nothing is ever deleted.
create policy import_batches_select on public.import_batches for select using (admin_w(firm_id) or (is_firm_member(firm_id) and created_by = (select auth.uid())));
create policy import_batches_insert on public.import_batches for insert with check (admin_w(firm_id) and created_by = (select auth.uid()));
create policy import_rows_select on public.import_rows for select using (exists (select 1 from import_batches b where b.id = batch_id and (admin_w(b.firm_id) or b.created_by = (select auth.uid()))));
create policy import_rows_insert on public.import_rows for insert with check (admin_w(firm_id) and exists (select 1 from import_batches b where b.id = batch_id and b.firm_id = import_rows.firm_id and b.processed_at is null));
create policy import_rows_update on public.import_rows for update using (admin_w(firm_id) and processed_at is null) with check (admin_w(firm_id) and processed_at is null);
revoke all on public.import_batches, public.import_rows from anon, authenticated;
grant select on public.import_batches to authenticated;
grant insert (id, firm_id, kind, source_name, row_count, created_by) on public.import_batches to authenticated;
grant select on public.import_rows to authenticated;
grant insert (id, batch_id, firm_id, row_no, raw, skip) on public.import_rows to authenticated;
grant update (skip) on public.import_rows to authenticated;
create trigger import_rows_check_firm before insert or update on public.import_rows for each row execute function public.check_row_firm();
comment on table public.import_batches is 'One staged file. Rows are processed by process_import_batch(), a bounded number per call, each on its own.';
comment on table public.import_rows is 'One staged CSV row (raw), and what became of it: created (matter_id, maybe invite_id), skipped, or failed with the reason. Never deleted: the reconciliation is the record.';

-- Nigerian numbers as the profile stores them: E.164. Anything else is null, never a guess.
create or replace function public.import_phone_key(p text) returns text
language sql immutable strict set search_path = public as $$
  select case
    when d ~ '^\+[1-9][0-9]{7,14}$' then d
    when d ~ '^\+0[0-9]{10}$' then '+234' || substr(d, 3)
    when d ~ '^0[0-9]{10}$' then '+234' || substr(d, 2)
    when d ~ '^234[0-9]{10}$' then '+' || d
    when d ~ '^[0-9]{10}$' then '+234' || d
  end
  from (select regexp_replace(p, '[^0-9+]', '', 'g') as d) t
$$;

-- A calendar day from what a spreadsheet exports: ISO, or day/month/year with / or - or .
create or replace function public.import_day(p text) returns date
language plpgsql immutable strict set search_path = public as $$
declare s text := btrim(p);
begin
  if s = '' then return null; end if;
  if s ~ '^\d{4}-\d{2}-\d{2}' then return substr(s, 1, 10)::date; end if;
  if s ~ '^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$' then return to_date(regexp_replace(s, '[.-]', '/', 'g'), 'DD/MM/YYYY'); end if;
  raise exception 'the date "%" is not readable — use YYYY-MM-DD or DD/MM/YYYY', p;
end $$;

-- Process up to p_limit unprocessed rows of a batch, each in its own block: a failing row records
-- its reason and the next row goes on. Returns the running totals and what is left.
create or replace function public.process_import_batch(p_batch uuid, p_limit int default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b import_batches%rowtype; r import_rows%rowtype; v_uid uuid := auth.uid(); v_n int;
        n_done int := 0; n_created int := 0; n_skipped int := 0; n_failed int := 0; n_left int;
        raw jsonb; v_title text; v_type matter_type; v_status uuid; v_status_key text; v_lead uuid; v_orig uuid;
        v_court uuid; v_court_name text; v_opened date; v_closed date; v_ref text; v_id uuid; v_note text;
        v_phone text; v_email text; v_client uuid; v_invite uuid; v_legacy text; v_existing text; v_link_note text; e text;
begin
  -- One run per batch at a time: the batch row is locked for the call, so a retried or
  -- double-submitted call waits and then finds the rows already processed.
  select * into b from import_batches where id = p_batch for update;
  if not found or not admin_w(b.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  p_limit := coalesce(p_limit, 25);
  if p_limit < 1 or p_limit > 200 then raise exception 'process between 1 and 200 rows at a time'; end if;

  for r in select * from import_rows where batch_id = p_batch and processed_at is null order by row_no limit p_limit for update loop
    n_done := n_done + 1;
    raw := r.raw;
    begin
      if r.skip then
        update import_rows set outcome = 'skipped', note = 'left out before processing', processed_at = now() where id = r.id and processed_at is null;
        n_skipped := n_skipped + 1; continue;
      end if;

      v_legacy := nullif(btrim(coalesce(raw ->> 'legacy_reference', '')), '');
      if v_legacy is not null then
        select reference into v_existing from matters where firm_id = b.firm_id and legacy_reference = v_legacy and deleted_at is null limit 1;
        if v_existing is not null then
          update import_rows set outcome = 'skipped', note = format('already on Docket as %s', v_existing), processed_at = now() where id = r.id and processed_at is null;
          n_skipped := n_skipped + 1; continue;
        end if;
      end if;

      v_title := nullif(btrim(coalesce(raw ->> 'title', '')), '');
      if v_title is null or length(v_title) < 2 then raise exception 'a matter needs a title'; end if;
      begin
        v_type := lower(btrim(coalesce(raw ->> 'type', 'other')))::matter_type;
      exception when others then
        raise exception 'unknown matter type "%"', raw ->> 'type';
      end;
      v_status_key := nullif(lower(btrim(coalesce(raw ->> 'status', ''))), '');
      if v_status_key is null then v_status_key := 'new_inquiry'; end if;
      select id into v_status from matter_statuses where firm_id = b.firm_id and (key = v_status_key or lower(label) = v_status_key);
      if v_status is null then raise exception 'unknown status "%" — use one of the firm''s status keys', v_status_key; end if;

      v_lead := null;
      if nullif(btrim(coalesce(raw ->> 'handling_lawyer', '')), '') is not null then
        select count(*), min(fm.user_id::text)::uuid into v_n, v_lead from firm_members fm join profiles p on p.id = fm.user_id
         where fm.firm_id = b.firm_id and (lower(p.email) = lower(btrim(raw ->> 'handling_lawyer')) or lower(p.full_name) = lower(btrim(raw ->> 'handling_lawyer')));
        if v_n = 0 then raise exception 'handling lawyer "%" is not a member of the firm — use their email or exact name', raw ->> 'handling_lawyer'; end if;
        if v_n > 1 then raise exception 'handling lawyer "%" matches % members — use their email', raw ->> 'handling_lawyer', v_n; end if;
      else
        v_lead := v_uid;
      end if;
      v_orig := null;
      if nullif(btrim(coalesce(raw ->> 'originating_lawyer', '')), '') is not null then
        select count(*), min(fm.user_id::text)::uuid into v_n, v_orig from firm_members fm join profiles p on p.id = fm.user_id
         where fm.firm_id = b.firm_id and (lower(p.email) = lower(btrim(raw ->> 'originating_lawyer')) or lower(p.full_name) = lower(btrim(raw ->> 'originating_lawyer')));
        if v_n = 0 then raise exception 'originating lawyer "%" is not a member of the firm', raw ->> 'originating_lawyer'; end if;
        if v_n > 1 then raise exception 'originating lawyer "%" matches % members — use their email', raw ->> 'originating_lawyer', v_n; end if;
      end if;

      v_court := null; v_court_name := nullif(btrim(coalesce(raw ->> 'court', '')), '');
      if v_court_name is not null then
        select id into v_court from courts c where (c.firm_id is null or c.firm_id = b.firm_id) and lower(c.name) = lower(v_court_name) limit 1;
      end if;
      v_opened := coalesce(import_day(nullif(btrim(coalesce(raw ->> 'opened_on', '')), '')), current_date);
      v_closed := import_day(nullif(btrim(coalesce(raw ->> 'closed_on', '')), ''));
      if v_closed is not null and v_closed < v_opened then raise exception 'closed before it was opened (% before %)', v_closed, v_opened; end if;

      v_ref := next_reference(b.firm_id, 'matter');
      insert into matters (firm_id, reference, legacy_reference, title, cause_title, type, status_id, description, court_id, court_name,
                           suit_number, judicial_division, opposing_party, next_action, opened_at, closed_at,
                           originating_lawyer_id, handling_lawyer_id, created_by)
      values (b.firm_id, v_ref, v_legacy, v_title, nullif(btrim(coalesce(raw ->> 'cause_title', '')), ''), v_type, v_status,
              nullif(btrim(coalesce(raw ->> 'description', '')), ''), v_court, case when v_court is null then v_court_name end,
              nullif(btrim(coalesce(raw ->> 'suit_number', '')), ''), nullif(btrim(coalesce(raw ->> 'judicial_division', '')), ''),
              nullif(btrim(coalesce(raw ->> 'opposing_party', '')), ''), nullif(btrim(coalesce(raw ->> 'next_action', '')), ''),
              v_opened, v_closed, coalesce(v_orig, v_lead), v_lead, v_uid)
      returning id into v_id;
      insert into matter_lawyers (matter_id, firm_id, user_id, is_lead) values (v_id, b.firm_id, v_lead, true);
      if nullif(btrim(coalesce(raw ->> 'suit_number', '')), '') is not null then
        insert into matter_court_numbers (firm_id, matter_id, court_id, number, kind) values (b.firm_id, v_id, v_court, btrim(raw ->> 'suit_number'), 'suit');
      end if;
      -- The other side, one name per semicolon, onto the register the conflict check searches.
      insert into matter_adverse_parties (firm_id, matter_id, name, created_by)
      select b.firm_id, v_id, btrim(x), v_uid from unnest(string_to_array(coalesce(raw ->> 'opposing_party', ''), ';')) x where length(btrim(x)) >= 2;
      -- Internal, dated today: the fact of the import. Nothing client-visible is invented.
      insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by)
      values (v_id, b.firm_id, 'note', 'internal', 'Brought onto Docket',
              format('Imported from %s (row %s)%s. Opened %s.', coalesce(b.source_name, 'a file'), r.row_no,
                     case when v_legacy is not null then format(', file %s', v_legacy) else '' end, v_opened),
              now(), v_uid);

      -- The client: invited, never linked (see the header). A number or address that belongs to a
      -- member of the firm is refused — a member cannot be the firm's client, and accept_invite()
      -- would refuse them anyway. Where the firm requires clearance, the invitation waits for it.
      v_link_note := null; v_client := null; v_invite := null;
      v_phone := import_phone_key(nullif(btrim(coalesce(raw ->> 'client_phone', '')), ''));
      v_email := nullif(lower(btrim(coalesce(raw ->> 'client_email', ''))), '');
      if v_phone is not null or v_email is not null then
        if exists (select 1 from profiles p join firm_members fm on fm.user_id = p.id
                    where fm.firm_id = b.firm_id and ((v_phone is not null and p.phone = v_phone) or (v_email is not null and lower(p.email) = v_email))) then
          v_link_note := 'client not invited: that phone or email belongs to a member of the firm — a member cannot be its client';
        elsif (select conflict_checks_required from firms where id = b.firm_id) and not conflict_cleared(v_id) then
          v_link_note := 'client not invited: this firm requires a cleared conflict check before a client joins a matter — clear it, then invite them from the matter';
        else
          insert into invites (firm_id, matter_id, phone, email, role, created_by, expires_at)
          values (b.firm_id, v_id, v_phone, v_email, 'client', v_uid, now() + interval '30 days')
          returning id into v_invite;
          v_link_note := 'invitation created — send the client their link';
        end if;
      elsif nullif(btrim(coalesce(raw ->> 'client_name', '')), '') is not null then
        v_link_note := format('client "%s" named but no phone or email — invite them from the matter', btrim(raw ->> 'client_name'));
      end if;

      perform audit('matter.imported', 'matter', v_id, b.firm_id,
                    jsonb_build_object('reference', v_ref, 'legacy_reference', v_legacy, 'batch_id', p_batch, 'row_no', r.row_no, 'client', v_client, 'invite', v_invite));
      update import_rows set outcome = 'created', matter_id = v_id, invite_id = v_invite, note = v_link_note, processed_at = now() where id = r.id and processed_at is null;
      n_created := n_created + 1;
    exception when others then
      -- The row's own failure; the matter it half-made is rolled back with the block.
      e := sqlerrm;
      update import_rows set outcome = 'failed', note = e, processed_at = now() where id = r.id and processed_at is null;
      n_failed := n_failed + 1;
    end;
  end loop;

  select count(*) into n_left from import_rows where batch_id = p_batch and processed_at is null;
  if n_left = 0 and b.processed_at is null then update import_batches set processed_at = now() where id = p_batch; end if;
  return jsonb_build_object('processed', n_done, 'created', n_created, 'skipped', n_skipped, 'failed', n_failed, 'remaining', n_left);
end $$;
revoke execute on function public.process_import_batch(uuid, int) from public, anon;
grant  execute on function public.process_import_batch(uuid, int) to authenticated;
revoke execute on function public.import_phone_key(text) from public, anon;
grant  execute on function public.import_phone_key(text) to authenticated;
revoke execute on function public.import_day(text) from public, anon, authenticated;
