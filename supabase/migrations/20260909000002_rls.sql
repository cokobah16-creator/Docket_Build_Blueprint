-- Docket slice 0 — migration 2: row-level security.
-- The database is the source of truth for authorization (blueprint §6).
-- Every policy reduces to four questions: is this my row, am I an active
-- member of this firm, has my session passed MFA (aal2), am I a party to
-- this matter. Staff WRITES always require an MFA-verified session.

-- ---------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER (owner = migration role) so they read membership
-- tables without recursing into the very policies that call them.
-- ---------------------------------------------------------------------------

create function app.is_mfa() returns boolean
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  )
$$;

create function app.member_role(f uuid) returns public.firm_role
language sql stable security definer set search_path = public
as $$
  select role from public.firm_members
  where firm_id = f and user_id = auth.uid() and is_active
$$;

-- All four firm roles are "staff" for read purposes.
create function app.is_staff(f uuid) returns boolean
language sql stable
as $$
  select app.member_role(f) is not null
$$;

-- Staff writes are MFA-gated. Do not loosen this in later slices; build the
-- TOTP enrolment gate instead.
create function app.can_write(f uuid) returns boolean
language sql stable
as $$
  select app.is_staff(f) and app.is_mfa()
$$;

create function app.is_party(m uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.matter_parties
    where matter_id = m and user_id = auth.uid()
  )
$$;

create function app.is_client_of_firm(f uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.matter_parties mp
    join public.matters m on m.id = mp.matter_id
    where m.firm_id = f and mp.user_id = auth.uid()
  ) or exists (
    select 1 from public.appointments a
    where a.firm_id = f and a.client_id = auth.uid()
  )
$$;

-- Staff may see the profile of anyone who is a member, client party or
-- appointment holder at a firm they belong to — and nobody else's.
create function app.staff_can_view_profile(p uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.firm_members me
    where me.user_id = auth.uid() and me.is_active and (
      exists (select 1 from public.firm_members fm
              where fm.firm_id = me.firm_id and fm.user_id = p)
      or exists (select 1 from public.appointments a
                 where a.firm_id = me.firm_id and a.client_id = p)
      or exists (select 1 from public.matter_parties mp
                 join public.matters m on m.id = mp.matter_id
                 where m.firm_id = me.firm_id and mp.user_id = p)
    )
  )
$$;

grant usage on schema app to anon;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. Nothing is readable or writable until a policy
-- below says so (service_role bypasses RLS by role attribute).
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create policy firms_select on public.firms for select
  using (app.is_staff(id) or app.is_platform_admin());
create policy firms_update on public.firms for update
  using (app.member_role(id) in ('owner', 'admin') and app.is_mfa())
  with check (app.member_role(id) in ('owner', 'admin') and app.is_mfa());
-- firms insert/delete: service role only (platform admin server action).

create policy platform_admins_select on public.platform_admins for select
  using (user_id = auth.uid());

create policy profiles_select on public.profiles for select
  using (id = auth.uid() or app.staff_can_view_profile(id) or app.is_platform_admin());
create policy profiles_insert on public.profiles for insert
  with check (id = auth.uid());
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy firm_members_select on public.firm_members for select
  using (user_id = auth.uid() or app.is_staff(firm_id));
create policy firm_members_insert on public.firm_members for insert
  with check (app.member_role(firm_id) in ('owner', 'admin') and app.is_mfa());
create policy firm_members_update on public.firm_members for update
  using (app.member_role(firm_id) in ('owner', 'admin') and app.is_mfa());
create policy firm_members_delete on public.firm_members for delete
  using (app.member_role(firm_id) in ('owner', 'admin') and app.is_mfa());

create policy consent_records_select on public.consent_records for select
  using (user_id = auth.uid() or (firm_id is not null and app.is_staff(firm_id)));
create policy consent_records_insert on public.consent_records for insert
  with check (user_id = auth.uid());
-- consent records are immutable: no update/delete policies.

-- ---------------------------------------------------------------------------
-- Catalogue (the anonymous booking surface reads these)
-- ---------------------------------------------------------------------------

create policy services_select on public.services for select
  to anon, authenticated
  using (is_active or app.is_staff(firm_id));
create policy services_write on public.services for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy lawyer_profiles_select on public.lawyer_profiles for select
  to anon, authenticated
  using (is_public or user_id = auth.uid() or app.is_staff(firm_id));
create policy lawyer_profiles_write on public.lawyer_profiles for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy availability_rules_select on public.availability_rules for select
  using (app.is_staff(firm_id));
create policy availability_rules_write on public.availability_rules for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy availability_exceptions_select on public.availability_exceptions for select
  using (app.is_staff(firm_id));
create policy availability_exceptions_write on public.availability_exceptions for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy intake_forms_select on public.intake_forms for select
  to anon, authenticated
  using (is_active or app.is_staff(firm_id));
create policy intake_forms_write on public.intake_forms for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy content_select on public.content for select
  to anon, authenticated
  using (is_published or app.is_staff(firm_id));
create policy content_write on public.content for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

-- ---------------------------------------------------------------------------
-- Appointments and consultations
-- ---------------------------------------------------------------------------

-- Clients never insert appointments directly; book_appointment() does.
create policy appointments_select on public.appointments for select
  using (client_id = auth.uid() or app.is_staff(firm_id));
create policy appointments_update on public.appointments for update
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy intake_responses_select on public.intake_responses for select
  using (client_id = auth.uid() or app.is_staff(firm_id));

create policy consultation_sessions_select on public.consultation_sessions for select
  using (
    app.is_staff(firm_id)
    or exists (select 1 from public.appointments a
               where a.id = appointment_id and a.client_id = auth.uid())
  );
create policy consultation_sessions_insert on public.consultation_sessions for insert
  with check (
    app.can_write(firm_id)
    or exists (select 1 from public.appointments a
               where a.id = appointment_id and a.client_id = auth.uid()
                 and a.status in ('confirmed', 'rescheduled'))
  );

create policy consultation_notes_select on public.consultation_notes for select
  using (
    app.is_staff(firm_id)
    or exists (select 1 from public.appointments a
               where a.id = appointment_id and a.client_id = auth.uid())
  );
create policy consultation_notes_write on public.consultation_notes for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

-- Internal notes have NO client policy on purpose. Never add one.
create policy consultation_internal_notes_select on public.consultation_internal_notes for select
  using (app.is_staff(firm_id));
create policy consultation_internal_notes_insert on public.consultation_internal_notes for insert
  with check (app.can_write(firm_id));

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------

create policy invoices_select on public.invoices for select
  using (client_id = auth.uid() or app.is_staff(firm_id));
create policy invoices_insert on public.invoices for insert
  with check (app.can_write(firm_id));
create policy invoices_update on public.invoices for update
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy invoice_items_select on public.invoice_items for select
  using (
    app.is_staff(firm_id)
    or exists (select 1 from public.invoices i
               where i.id = invoice_id and i.client_id = auth.uid())
  );
create policy invoice_items_write on public.invoice_items for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

-- Payments are written only by record_payment() under the service role.
create policy payments_select on public.payments for select
  using (
    app.is_staff(firm_id)
    or exists (select 1 from public.invoices i
               where i.id = invoice_id and i.client_id = auth.uid())
  );

create policy webhook_events_select on public.webhook_events for select
  using (app.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Matters
-- ---------------------------------------------------------------------------

create policy matter_statuses_select on public.matter_statuses for select
  using (app.is_staff(firm_id) or app.is_client_of_firm(firm_id));
create policy matter_statuses_write on public.matter_statuses for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy matters_select on public.matters for select
  using (app.is_staff(firm_id) or app.is_party(id));
create policy matters_insert on public.matters for insert
  with check (app.can_write(firm_id));
create policy matters_update on public.matters for update
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy matter_parties_select on public.matter_parties for select
  using (user_id = auth.uid() or app.is_staff(firm_id));
create policy matter_parties_write on public.matter_parties for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy matter_lawyers_select on public.matter_lawyers for select
  using (app.is_staff(firm_id) or app.is_party(matter_id));
create policy matter_lawyers_write on public.matter_lawyers for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

-- Clients see only client-visible timeline entries of their own matters.
create policy updates_select on public.updates for select
  using (
    app.is_staff(firm_id)
    or (visibility = 'client' and app.is_party(matter_id))
  );
create policy updates_insert on public.updates for insert
  with check (app.can_write(firm_id));

create policy court_events_select on public.court_events for select
  using (app.is_staff(firm_id) or app.is_party(matter_id));
create policy court_events_write on public.court_events for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create policy documents_select on public.documents for select
  using (
    app.is_staff(firm_id)
    or owner_id = auth.uid()
    or (is_client_visible and matter_id is not null and app.is_party(matter_id))
  );
create policy documents_insert on public.documents for insert
  with check (
    app.can_write(firm_id)
    or (owner_id = auth.uid() and matter_id is not null and app.is_party(matter_id))
  );
create policy documents_update on public.documents for update
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy document_versions_select on public.document_versions for select
  using (
    -- visible iff the parent document row is visible to the caller
    exists (select 1 from public.documents d where d.id = document_id)
  );
create policy document_versions_insert on public.document_versions for insert
  with check (
    app.can_write(firm_id)
    or (uploaded_by = auth.uid()
        and exists (select 1 from public.documents d
                    where d.id = document_id and d.owner_id = auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------

create policy messages_select on public.messages for select
  using (app.is_staff(firm_id) or app.is_party(matter_id));
create policy messages_insert on public.messages for insert
  with check (
    sender_id = auth.uid()
    and (app.can_write(firm_id) or app.is_party(matter_id))
  );

create policy message_reads_select on public.message_reads for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.messages m
               where m.id = message_id and app.is_staff(m.firm_id))
  );
create policy message_reads_insert on public.message_reads for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.messages m where m.id = message_id)
  );

-- ---------------------------------------------------------------------------
-- Invites and tasks
-- ---------------------------------------------------------------------------

-- Tokens never leak: clients redeem via accept_invite(), staff manage here.
create policy invites_select on public.invites for select
  using (app.is_staff(firm_id));
create policy invites_write on public.invites for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

create policy tasks_select on public.tasks for select
  using (app.is_staff(firm_id));
create policy tasks_write on public.tasks for all
  using (app.can_write(firm_id)) with check (app.can_write(firm_id));

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create policy notifications_select on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid()); -- mark read

create policy notification_preferences_all on public.notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_subscriptions_all on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Audit log: readable by firm owners/admins, writable by nobody but app.audit()
-- (security definer, migration 3). A trigger makes it append-only even for
-- roles that bypass RLS.
-- ---------------------------------------------------------------------------

create policy audit_log_select on public.audit_log for select
  using (
    app.is_platform_admin()
    or (firm_id is not null and app.member_role(firm_id) in ('owner', 'admin'))
  );

create function app.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function app.forbid_mutation();
