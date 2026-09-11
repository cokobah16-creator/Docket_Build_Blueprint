-- Docket — migration 21: hardening the database found by its own advisors.
--
-- Everything here came from Supabase's security and performance linters run against the live
-- project, plus one deliberate new capability (rate limiting) that slice 5 needs and Postgres
-- is the only place in this stack that can hold.
--
-- Nothing here changes who may read or write anything. Two of the changes look like they
-- might, so they are explained where they happen:
--
--  · Splitting a `for all` write policy into insert/update/delete removes SELECT from that
--    policy. It is safe ONLY because every table it is done to has a separate `_select`
--    policy that is strictly broader — the write predicate always includes mfa_ok() and
--    firm_not_suspended(), which the read predicate does not. The three `for all` policies
--    with NO select sibling (consultation_internal_notes, notification_preferences,
--    push_subscriptions) are deliberately left alone: splitting those WOULD remove reads.
--    The 297-check suite is what proves it, since it exercises every read path from both sides.
--
--  · Wrapping auth.uid() as (select auth.uid()) turns a per-row call into a one-time initplan.
--    Same value, same predicate, evaluated once per query instead of once per row.

-- ================================================================ 1. a public table with no RLS
-- ng_states is reference data — the 36 states and the FCT — and writes were already revoked
-- from anon and authenticated (migration 10). But RLS was never enabled, which is what the
-- linter flags: a table in the exposed schema with no row security at all. Reading it is
-- meant to be free; that is now said explicitly rather than by omission.
alter table public.ng_states enable row level security;
drop policy if exists ng_states_select on public.ng_states;
create policy ng_states_select on public.ng_states for select using (true);

-- ================================================================ 2. functions with a mutable search_path
-- A security-definer function without a fixed search_path resolves unqualified names against
-- the caller's path. try_uuid() is the worst of these: it is called from the storage policies
-- on every object listing.
alter function public.is_valid_firm_slug(text)  set search_path = public;
alter function public.validate_brand(jsonb)     set search_path = public;
alter function public.firms_validate_brand()    set search_path = public;
alter function public.try_uuid(text)            set search_path = public;

-- ================================================================ 3. trigger functions are not an API
-- Every trigger function was reachable at /rest/v1/rpc/<name> by anonymous callers. Postgres
-- refuses to run a trigger function outside a trigger, so nothing could be done with them, but
-- they have no business being on the API surface at all. Triggers themselves are unaffected:
-- they run as the table owner and do not consult EXECUTE grants.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    join pg_type t on t.oid = p.prorettype and t.typname = 'trigger'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- ---------------- one-time auth lookups: same predicate, evaluated once per query ----------------
-- 22 policies
drop policy if exists appointments_client_select on public.appointments;
create policy appointments_client_select on public.appointments for select
  using ((client_id = (select auth.uid())));

drop policy if exists consent_records_insert on public.consent_records;
create policy consent_records_insert on public.consent_records for insert
  with check ((user_id = (select auth.uid())));

drop policy if exists consent_records_select on public.consent_records;
create policy consent_records_select on public.consent_records for select
  using (((user_id = (select auth.uid())) OR is_firm_member(firm_id)));

drop policy if exists courts_insert on public.courts;
create policy courts_insert on public.courts for insert
  with check (((firm_id IS NOT NULL) AND staff_w(firm_id) AND (created_by = (select auth.uid()))));

drop policy if exists document_versions_insert on public.document_versions;
create policy document_versions_insert on public.document_versions for insert
  with check (((uploaded_by = (select auth.uid())) AND can_upload_document(document_id)));

drop policy if exists documents_client_insert on public.documents;
create policy documents_client_insert on public.documents for insert
  with check (((uploaded_by = (select auth.uid())) AND client_visible AND (is_matter_party(matter_id) OR is_appointment_client(appointment_id))));

drop policy if exists documents_staff_insert on public.documents;
create policy documents_staff_insert on public.documents for insert
  with check ((staff_w(firm_id) AND (uploaded_by = (select auth.uid()))));

drop policy if exists intake_responses_insert on public.intake_responses;
create policy intake_responses_insert on public.intake_responses for insert
  with check ((client_id = (select auth.uid())));

drop policy if exists intake_responses_select on public.intake_responses;
create policy intake_responses_select on public.intake_responses for select
  using (((client_id = (select auth.uid())) OR is_firm_member(firm_id)));

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using ((is_firm_member(firm_id) OR ((client_id = (select auth.uid())) AND (status <> 'draft'::invoice_status))));

drop policy if exists matter_counsel_insert on public.matter_counsel;
create policy matter_counsel_insert on public.matter_counsel for insert
  with check ((staff_w(firm_id) AND (created_by = (select auth.uid()))));

drop policy if exists matter_parties_select on public.matter_parties;
create policy matter_parties_select on public.matter_parties for select
  using (((user_id = (select auth.uid())) OR is_firm_member(firm_id)));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (((sender_id = (select auth.uid())) AND (staff_w(firm_id) OR is_matter_party(matter_id) OR is_appointment_client(appointment_id))));

drop policy if exists notification_preferences_all on public.notification_preferences;
create policy notification_preferences_all on public.notification_preferences for all
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select
  using ((user_id = (select auth.uid())));

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists platform_admins_self on public.platform_admins;
create policy platform_admins_self on public.platform_admins for select
  using ((user_id = (select auth.uid())));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert
  with check ((id = (select auth.uid())));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using ((id = (select auth.uid())))
  with check ((id = (select auth.uid())));

drop policy if exists push_subscriptions_all on public.push_subscriptions;
create policy push_subscriptions_all on public.push_subscriptions for all
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists updates_insert on public.updates;
create policy updates_insert on public.updates for insert
  with check ((staff_w(firm_id) AND (posted_by = (select auth.uid()))));

drop policy if exists updates_modify on public.updates;
create policy updates_modify on public.updates for update
  using ((((posted_by = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)))
  with check ((((posted_by = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)));

-- ---------------- a write policy no longer also grants reads ----------------
-- 24 policies, each becoming insert + update + delete
drop policy if exists appointments_staff_write on public.appointments;
create policy appointments_staff_write_ins on public.appointments for insert
  with check (staff_w(firm_id));
create policy appointments_staff_write_upd on public.appointments for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy appointments_staff_write_del on public.appointments for delete
  using (staff_w(firm_id));

drop policy if exists availability_exceptions_write on public.availability_exceptions;
create policy availability_exceptions_write_ins on public.availability_exceptions for insert
  with check ((((lawyer_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)));
create policy availability_exceptions_write_upd on public.availability_exceptions for update
  using ((((lawyer_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)))
  with check ((((lawyer_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)));
create policy availability_exceptions_write_del on public.availability_exceptions for delete
  using ((((lawyer_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)));

drop policy if exists availability_rules_write on public.availability_rules;
create policy availability_rules_write_ins on public.availability_rules for insert
  with check ((((lawyer_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)));
create policy availability_rules_write_upd on public.availability_rules for update
  using ((((lawyer_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)))
  with check ((((lawyer_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)));
create policy availability_rules_write_del on public.availability_rules for delete
  using ((((lawyer_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)));

drop policy if exists conflict_checks_write on public.conflict_checks;
create policy conflict_checks_write_ins on public.conflict_checks for insert
  with check (staff_w(firm_id));
create policy conflict_checks_write_upd on public.conflict_checks for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy conflict_checks_write_del on public.conflict_checks for delete
  using (staff_w(firm_id));

drop policy if exists consultation_notes_write on public.consultation_notes;
create policy consultation_notes_write_ins on public.consultation_notes for insert
  with check (staff_w(firm_id));
create policy consultation_notes_write_upd on public.consultation_notes for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy consultation_notes_write_del on public.consultation_notes for delete
  using (staff_w(firm_id));

drop policy if exists content_write on public.content;
create policy content_write_ins on public.content for insert
  with check (admin_w(firm_id));
create policy content_write_upd on public.content for update
  using (admin_w(firm_id))
  with check (admin_w(firm_id));
create policy content_write_del on public.content for delete
  using (admin_w(firm_id));

drop policy if exists court_events_write on public.court_events;
create policy court_events_write_ins on public.court_events for insert
  with check (staff_w(firm_id));
create policy court_events_write_upd on public.court_events for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy court_events_write_del on public.court_events for delete
  using (staff_w(firm_id));

drop policy if exists court_vacations_platform_write on public.court_vacations;
create policy court_vacations_platform_write_ins on public.court_vacations for insert
  with check ((is_platform_admin() AND mfa_ok()));
create policy court_vacations_platform_write_upd on public.court_vacations for update
  using ((is_platform_admin() AND mfa_ok()))
  with check ((is_platform_admin() AND mfa_ok()));
create policy court_vacations_platform_write_del on public.court_vacations for delete
  using ((is_platform_admin() AND mfa_ok()));

drop policy if exists courts_platform_write on public.courts;
create policy courts_platform_write_ins on public.courts for insert
  with check (((firm_id IS NULL) AND is_platform_admin() AND mfa_ok()));
create policy courts_platform_write_upd on public.courts for update
  using (((firm_id IS NULL) AND is_platform_admin() AND mfa_ok()))
  with check (((firm_id IS NULL) AND is_platform_admin() AND mfa_ok()));
create policy courts_platform_write_del on public.courts for delete
  using (((firm_id IS NULL) AND is_platform_admin() AND mfa_ok()));

drop policy if exists firm_members_write on public.firm_members;
create policy firm_members_write_ins on public.firm_members for insert
  with check (admin_w(firm_id));
create policy firm_members_write_upd on public.firm_members for update
  using (admin_w(firm_id))
  with check (admin_w(firm_id));
create policy firm_members_write_del on public.firm_members for delete
  using (admin_w(firm_id));

drop policy if exists intake_forms_write on public.intake_forms;
create policy intake_forms_write_ins on public.intake_forms for insert
  with check (admin_w(firm_id));
create policy intake_forms_write_upd on public.intake_forms for update
  using (admin_w(firm_id))
  with check (admin_w(firm_id));
create policy intake_forms_write_del on public.intake_forms for delete
  using (admin_w(firm_id));

drop policy if exists invites_write on public.invites;
create policy invites_write_ins on public.invites for insert
  with check (staff_w(firm_id));
create policy invites_write_upd on public.invites for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy invites_write_del on public.invites for delete
  using (staff_w(firm_id));

drop policy if exists invoice_items_write on public.invoice_items;
create policy invoice_items_write_ins on public.invoice_items for insert
  with check ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_items.invoice_id) AND staff_w(i.firm_id)))));
create policy invoice_items_write_upd on public.invoice_items for update
  using ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_items.invoice_id) AND staff_w(i.firm_id)))))
  with check ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_items.invoice_id) AND staff_w(i.firm_id)))));
create policy invoice_items_write_del on public.invoice_items for delete
  using ((EXISTS ( SELECT 1 FROM invoices i WHERE ((i.id = invoice_items.invoice_id) AND staff_w(i.firm_id)))));

drop policy if exists invoices_write on public.invoices;
create policy invoices_write_ins on public.invoices for insert
  with check (staff_w(firm_id));
create policy invoices_write_upd on public.invoices for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy invoices_write_del on public.invoices for delete
  using (staff_w(firm_id));

drop policy if exists lawyer_profiles_write on public.lawyer_profiles;
create policy lawyer_profiles_write_ins on public.lawyer_profiles for insert
  with check ((((user_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)));
create policy lawyer_profiles_write_upd on public.lawyer_profiles for update
  using ((((user_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)))
  with check ((((user_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)));
create policy lawyer_profiles_write_del on public.lawyer_profiles for delete
  using ((((user_id = (select auth.uid())) AND staff_w(firm_id)) OR admin_w(firm_id)));

drop policy if exists matter_court_numbers_write on public.matter_court_numbers;
create policy matter_court_numbers_write_ins on public.matter_court_numbers for insert
  with check (staff_w(firm_id));
create policy matter_court_numbers_write_upd on public.matter_court_numbers for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy matter_court_numbers_write_del on public.matter_court_numbers for delete
  using (staff_w(firm_id));

drop policy if exists matter_lawyers_write on public.matter_lawyers;
create policy matter_lawyers_write_ins on public.matter_lawyers for insert
  with check (staff_w(firm_id));
create policy matter_lawyers_write_upd on public.matter_lawyers for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy matter_lawyers_write_del on public.matter_lawyers for delete
  using (staff_w(firm_id));

drop policy if exists matter_parties_write on public.matter_parties;
create policy matter_parties_write_ins on public.matter_parties for insert
  with check (staff_w(firm_id));
create policy matter_parties_write_upd on public.matter_parties for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy matter_parties_write_del on public.matter_parties for delete
  using (staff_w(firm_id));

drop policy if exists matter_statuses_write on public.matter_statuses;
create policy matter_statuses_write_ins on public.matter_statuses for insert
  with check (admin_w(firm_id));
create policy matter_statuses_write_upd on public.matter_statuses for update
  using (admin_w(firm_id))
  with check (admin_w(firm_id));
create policy matter_statuses_write_del on public.matter_statuses for delete
  using (admin_w(firm_id));

drop policy if exists matters_write on public.matters;
create policy matters_write_ins on public.matters for insert
  with check (staff_w(firm_id));
create policy matters_write_upd on public.matters for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy matters_write_del on public.matters for delete
  using (staff_w(firm_id));

drop policy if exists public_holidays_platform_write on public.public_holidays;
create policy public_holidays_platform_write_ins on public.public_holidays for insert
  with check ((is_platform_admin() AND mfa_ok()));
create policy public_holidays_platform_write_upd on public.public_holidays for update
  using ((is_platform_admin() AND mfa_ok()))
  with check ((is_platform_admin() AND mfa_ok()));
create policy public_holidays_platform_write_del on public.public_holidays for delete
  using ((is_platform_admin() AND mfa_ok()));

drop policy if exists services_write on public.services;
create policy services_write_ins on public.services for insert
  with check (admin_w(firm_id));
create policy services_write_upd on public.services for update
  using (admin_w(firm_id))
  with check (admin_w(firm_id));
create policy services_write_del on public.services for delete
  using (admin_w(firm_id));

drop policy if exists staff_invites_write on public.staff_invites;
create policy staff_invites_write_ins on public.staff_invites for insert
  with check ((admin_w(firm_id) AND (created_by = (select auth.uid()))));
create policy staff_invites_write_upd on public.staff_invites for update
  using (admin_w(firm_id))
  with check ((admin_w(firm_id) AND (created_by = (select auth.uid()))));
create policy staff_invites_write_del on public.staff_invites for delete
  using (admin_w(firm_id));

drop policy if exists tasks_write on public.tasks;
create policy tasks_write_ins on public.tasks for insert
  with check (staff_w(firm_id));
create policy tasks_write_upd on public.tasks for update
  using (staff_w(firm_id))
  with check (staff_w(firm_id));
create policy tasks_write_del on public.tasks for delete
  using (staff_w(firm_id));


-- ================================================================ 5. rate limiting
-- The three surfaces slice 5 must limit live in three runtimes — the browser talking straight
-- to GoTrue, Next.js server actions, and a Deno Edge Function — and they share exactly one
-- thing: this database. There is no Redis here, so the counter is a table and the decision is
-- an RPC that every runtime can call.
--
-- Postgres cannot see the caller's IP: nothing in this codebase passes a request header down.
-- So a signed-in caller is keyed on auth.uid() with no argument to forge, and an anonymous
-- caller is keyed on whatever the calling runtime hashes and passes in. The RPC never trusts
-- p_key to identify a signed-in person — auth.uid() always wins when there is one.
create table if not exists public.rate_limits (
  bucket       text not null,
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (bucket, key, window_start)
);
alter table public.rate_limits enable row level security;
-- No policy: nobody reads or writes this table directly. The definer function below is the
-- only way in, exactly as firm_counters works.
revoke all on public.rate_limits from anon, authenticated;

create index if not exists rate_limits_sweep_idx on public.rate_limits (window_start);

create or replace function public.rate_limit_hit(
  p_bucket text, p_limit int, p_window interval default interval '1 minute', p_key text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_key text; v_window timestamptz; v_hits int;
begin
  if p_limit is null or p_limit < 1 then raise exception 'a limit must be at least 1'; end if;
  if p_bucket is null or p_bucket !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'unknown bucket'; end if;
  -- A signed-in caller can never borrow somebody else's key.
  v_key := coalesce(auth.uid()::text, nullif(left(coalesce(p_key, ''), 100), ''), 'anonymous');
  v_window := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));

  insert into rate_limits (bucket, key, window_start, hits)
  values (p_bucket, v_key, v_window, 1)
  on conflict (bucket, key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into v_hits;

  -- Opportunistic sweep: one in roughly two hundred calls clears anything long expired, so the
  -- table stays small without a cron job of its own.
  if v_hits % 200 = 0 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end $$;
revoke execute on function public.rate_limit_hit(text,int,interval,text) from public;
grant  execute on function public.rate_limit_hit(text,int,interval,text) to anon, authenticated;

-- ================================================================ 6. the foreign keys that get joined
-- The advisor lists 79 unindexed foreign keys. Most are on small lookup tables where a scan is
-- cheaper than an index. These are the ones on the paths every screen actually walks: firm
-- scoping, and the parent-child reads behind documents, invoices and service of process.
create index if not exists appointments_matter_id_idx        on public.appointments (matter_id);
create index if not exists appointments_service_id_idx       on public.appointments (service_id);
create index if not exists appointments_invoice_id_idx       on public.appointments (invoice_id);
create index if not exists document_versions_document_id_idx on public.document_versions (document_id);
create index if not exists documents_current_version_idx     on public.documents (current_version_id);
create index if not exists invoice_items_invoice_id_idx      on public.invoice_items (invoice_id);
create index if not exists payments_invoice_id_idx           on public.payments (invoice_id);
create index if not exists invoices_matter_id_idx            on public.invoices (matter_id);
create index if not exists invoices_appointment_id_idx       on public.invoices (appointment_id);
create index if not exists tasks_firm_id_idx                 on public.tasks (firm_id);
create index if not exists tasks_matter_id_idx               on public.tasks (matter_id);
create index if not exists updates_firm_id_idx               on public.updates (firm_id);
create index if not exists messages_firm_id_idx              on public.messages (firm_id);
create index if not exists notifications_firm_id_idx         on public.notifications (firm_id);
create index if not exists court_events_firm_id_idx          on public.court_events (firm_id);
create index if not exists matter_parties_firm_id_idx        on public.matter_parties (firm_id);
create index if not exists matter_lawyers_firm_id_idx        on public.matter_lawyers (firm_id);
create index if not exists intake_responses_form_id_idx      on public.intake_responses (form_id);
create index if not exists intake_responses_appointment_idx  on public.intake_responses (appointment_id);
create index if not exists process_service_firm_id_idx       on public.process_service (firm_id);
create index if not exists process_service_document_idx      on public.process_service (document_id);
create index if not exists process_service_served_firm_idx   on public.process_service (served_firm_id);
create index if not exists invites_firm_id_idx               on public.invites (firm_id);
create index if not exists invites_matter_id_idx             on public.invites (matter_id);
