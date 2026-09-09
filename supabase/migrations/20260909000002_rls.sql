-- Docket v0.2 — row-level security
-- Pattern: staff see their firm's rows and need an MFA-verified session (aal2) to write;
-- clients see their own appointments and client-visible rows on matters they are party to;
-- users see themselves. Clients never insert appointments or payments directly (server functions do).

-- ---------------------------------------------------------------- helpers
create or replace function public.mfa_ok() returns bool
  language sql stable as
  $$ select coalesce(auth.jwt()->>'aal', '') = 'aal2' $$;

create or replace function public.is_firm_member(f uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from firm_members where firm_id = f and user_id = auth.uid()) $$;

create or replace function public.has_firm_role(f uuid, roles firm_role[]) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from firm_members where firm_id = f and user_id = auth.uid() and role = any(roles)) $$;

create or replace function public.staff_w(f uuid) returns bool          -- staff write: member + MFA
  language sql stable as
  $$ select public.is_firm_member(f) and public.mfa_ok() $$;

create or replace function public.admin_w(f uuid) returns bool          -- owner/admin write: role + MFA
  language sql stable as
  $$ select public.has_firm_role(f, array['owner','admin']::firm_role[]) and public.mfa_ok() $$;

create or replace function public.is_matter_party(m uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from matter_parties where matter_id = m and user_id = auth.uid()) $$;

create or replace function public.is_appointment_client(a uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from appointments where id = a and client_id = auth.uid()) $$;

create or replace function public.is_client_of_firm(f uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (select 1 from appointments where firm_id = f and client_id = auth.uid())
         or exists (select 1 from matter_parties where firm_id = f and user_id = auth.uid()) $$;

-- may the current user see profile p? self, a colleague in a shared firm, or a client of one of my firms
create or replace function public.can_see_profile(p uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select p = auth.uid()
         or exists (select 1 from firm_members me join firm_members other on other.firm_id = me.firm_id
                    where me.user_id = auth.uid() and other.user_id = p)
         or exists (select 1 from firm_members me join appointments a on a.firm_id = me.firm_id
                    where me.user_id = auth.uid() and a.client_id = p)
         or exists (select 1 from firm_members me join matter_parties mp on mp.firm_id = me.firm_id
                    where me.user_id = auth.uid() and mp.user_id = p) $$;

create or replace function public.can_access_document(d uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (
       select 1 from documents doc
       where doc.id = d
         and ( public.is_firm_member(doc.firm_id)
            or (doc.client_visible and doc.deleted_at is null
                and (public.is_matter_party(doc.matter_id) or public.is_appointment_client(doc.appointment_id))) ) ) $$;

create or replace function public.can_access_invoice(i uuid) returns bool
  language sql stable security definer set search_path = public as
  $$ select exists (
       select 1 from invoices inv
       where inv.id = i and (public.is_firm_member(inv.firm_id) or (inv.client_id = auth.uid() and inv.status <> 'draft')) ) $$;

-- ---------------------------------------------------------------- enable RLS everywhere
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- profiles
create policy profiles_select on profiles for select using (can_see_profile(id));
create policy profiles_insert on profiles for insert with check (id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------- firms and membership
create policy firms_select on firms for select using (is_firm_member(id));
create policy firms_update on firms for update using (admin_w(id)) with check (admin_w(id));
-- firms are created by the platform (service role) only

create policy firm_members_select on firm_members for select using (is_firm_member(firm_id));
create policy firm_members_write  on firm_members for all using (admin_w(firm_id)) with check (admin_w(firm_id));

create policy lawyer_profiles_select on lawyer_profiles for select using (is_public or is_firm_member(firm_id));
create policy lawyer_profiles_write  on lawyer_profiles for all
  using ((user_id = auth.uid() and staff_w(firm_id)) or admin_w(firm_id))
  with check ((user_id = auth.uid() and staff_w(firm_id)) or admin_w(firm_id));

-- ---------------------------------------------------------------- catalogue and intake
create policy services_select on services for select using (is_active or is_firm_member(firm_id));
create policy services_write  on services for all using (admin_w(firm_id)) with check (admin_w(firm_id));

create policy intake_forms_select on intake_forms for select using (is_active or is_firm_member(firm_id));
create policy intake_forms_write  on intake_forms for all using (admin_w(firm_id)) with check (admin_w(firm_id));

create policy intake_responses_select on intake_responses for select using (client_id = auth.uid() or is_firm_member(firm_id));
create policy intake_responses_insert on intake_responses for insert with check (client_id = auth.uid());

-- ---------------------------------------------------------------- availability and appointments
create policy availability_rules_select on availability_rules for select using (is_firm_member(firm_id));
create policy availability_rules_write  on availability_rules for all
  using ((lawyer_id = auth.uid() and staff_w(firm_id)) or admin_w(firm_id))
  with check ((lawyer_id = auth.uid() and staff_w(firm_id)) or admin_w(firm_id));

create policy availability_exceptions_select on availability_exceptions for select using (is_firm_member(firm_id));
create policy availability_exceptions_write  on availability_exceptions for all
  using ((lawyer_id = auth.uid() and staff_w(firm_id)) or admin_w(firm_id))
  with check ((lawyer_id = auth.uid() and staff_w(firm_id)) or admin_w(firm_id));

create policy appointments_client_select on appointments for select using (client_id = auth.uid());
create policy appointments_staff_select  on appointments for select using (is_firm_member(firm_id));
create policy appointments_staff_write   on appointments for all using (staff_w(firm_id)) with check (staff_w(firm_id));
-- clients book through book_appointment() and cancel through cancel_appointment()

create policy consultation_sessions_select on consultation_sessions for select
  using (is_firm_member(firm_id) or is_appointment_client(appointment_id));
-- sessions are written by Edge Functions (service role) only

create policy consultation_notes_select on consultation_notes for select
  using (is_firm_member(firm_id) or is_appointment_client(appointment_id));
create policy consultation_notes_write  on consultation_notes for all using (staff_w(firm_id)) with check (staff_w(firm_id));

create policy consultation_internal_notes_all on consultation_internal_notes for all
  using (staff_w(firm_id)) with check (staff_w(firm_id));

-- ---------------------------------------------------------------- matters
create policy matter_statuses_select on matter_statuses for select using (is_firm_member(firm_id) or is_client_of_firm(firm_id));
create policy matter_statuses_write  on matter_statuses for all using (admin_w(firm_id)) with check (admin_w(firm_id));

create policy matters_select on matters for select
  using (is_firm_member(firm_id) or (deleted_at is null and is_matter_party(id)));
create policy matters_write  on matters for all using (staff_w(firm_id)) with check (staff_w(firm_id));

create policy matter_parties_select on matter_parties for select using (user_id = auth.uid() or is_firm_member(firm_id));
create policy matter_parties_write  on matter_parties for all using (staff_w(firm_id)) with check (staff_w(firm_id));

create policy matter_lawyers_select on matter_lawyers for select using (is_firm_member(firm_id) or is_matter_party(matter_id));
create policy matter_lawyers_write  on matter_lawyers for all using (staff_w(firm_id)) with check (staff_w(firm_id));

create policy updates_staff_select  on updates for select using (is_firm_member(firm_id));
create policy updates_client_select on updates for select using (visibility = 'client' and is_matter_party(matter_id));
create policy updates_insert        on updates for insert with check (staff_w(firm_id) and posted_by = auth.uid());
create policy updates_modify        on updates for update
  using ((posted_by = auth.uid() and staff_w(firm_id)) or admin_w(firm_id))
  with check ((posted_by = auth.uid() and staff_w(firm_id)) or admin_w(firm_id));
create policy updates_delete        on updates for delete using (admin_w(firm_id));

create policy court_events_select on court_events for select using (is_firm_member(firm_id) or is_matter_party(matter_id));
create policy court_events_write  on court_events for all using (staff_w(firm_id)) with check (staff_w(firm_id));

create policy tasks_select on tasks for select using (is_firm_member(firm_id));
create policy tasks_write  on tasks for all using (staff_w(firm_id)) with check (staff_w(firm_id));

-- ---------------------------------------------------------------- documents and messages
create policy documents_select on documents for select using (can_access_document(id));
create policy documents_staff_insert on documents for insert with check (staff_w(firm_id) and uploaded_by = auth.uid());
create policy documents_client_insert on documents for insert
  with check (uploaded_by = auth.uid() and client_visible
              and (is_matter_party(matter_id) or is_appointment_client(appointment_id)));
create policy documents_staff_modify on documents for update using (staff_w(firm_id)) with check (staff_w(firm_id));
-- no delete policy: legal records are soft-deleted (deleted_at) by staff, never hard-deleted by users

create policy document_versions_select on document_versions for select using (can_access_document(document_id));
create policy document_versions_insert on document_versions for insert
  with check (uploaded_by = auth.uid() and can_access_document(document_id)
              and (exists (select 1 from documents d where d.id = document_id and staff_w(d.firm_id))
                   or exists (select 1 from documents d where d.id = document_id and d.client_visible
                              and (is_matter_party(d.matter_id) or is_appointment_client(d.appointment_id)))));

create policy messages_select on messages for select
  using (is_firm_member(firm_id) or is_matter_party(matter_id) or is_appointment_client(appointment_id));
create policy messages_insert on messages for insert
  with check (sender_id = auth.uid()
              and (staff_w(firm_id) or is_matter_party(matter_id) or is_appointment_client(appointment_id)));
create policy messages_mark_read on messages for update
  using (is_firm_member(firm_id) or is_matter_party(matter_id) or is_appointment_client(appointment_id))
  with check (is_firm_member(firm_id) or is_matter_party(matter_id) or is_appointment_client(appointment_id));

-- ---------------------------------------------------------------- money
create policy invoices_select on invoices for select
  using (is_firm_member(firm_id) or (client_id = auth.uid() and status <> 'draft'));
create policy invoices_write  on invoices for all using (staff_w(firm_id)) with check (staff_w(firm_id));

create policy invoice_items_select on invoice_items for select using (can_access_invoice(invoice_id));
create policy invoice_items_write  on invoice_items for all
  using (exists (select 1 from invoices i where i.id = invoice_id and staff_w(i.firm_id)))
  with check (exists (select 1 from invoices i where i.id = invoice_id and staff_w(i.firm_id)));

create policy payments_select on payments for select using (can_access_invoice(invoice_id));
-- payments are written by record_payment() from webhooks only

-- ---------------------------------------------------------------- notifications, consent, content, operations
create policy notifications_select on notifications for select using (user_id = auth.uid());
create policy notifications_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notification_preferences_all on notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_subscriptions_all on push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy consent_records_select on consent_records for select using (user_id = auth.uid() or is_firm_member(firm_id));
create policy consent_records_insert on consent_records for insert with check (user_id = auth.uid());

create policy content_select on content for select using (status = 'published' or is_firm_member(firm_id));
create policy content_write  on content for all using (admin_w(firm_id)) with check (admin_w(firm_id));

create policy invites_select on invites for select using (is_firm_member(firm_id));
create policy invites_write  on invites for all using (staff_w(firm_id)) with check (staff_w(firm_id));
-- invites are accepted through accept_invite(token)

create policy conflict_checks_select on conflict_checks for select using (is_firm_member(firm_id));
create policy conflict_checks_write  on conflict_checks for all using (staff_w(firm_id)) with check (staff_w(firm_id));

create policy audit_log_select on audit_log for select
  using (has_firm_role(firm_id, array['owner','admin']::firm_role[]));
-- audit_log is append-only via the audit() function; update/delete grants were revoked in the schema migration

-- firm_counters: no policies — only security-definer functions touch it
