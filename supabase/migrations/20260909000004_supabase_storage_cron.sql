-- Docket slice 0 — migration 4: Supabase Storage buckets/policies and pg_cron
-- schedules. Both are guarded so the migration is a no-op on plain Postgres
-- (the local test runner) and does the real work on Supabase.

-- ---------------------------------------------------------------------------
-- Storage. Three private buckets; every object path carries the tenant:
--   documents/{firm_id}/{document_id}/{version_id}.{ext}
--   intake-uploads/{firm_id}/{client_id}/…
--   firm-assets/{firm_id}/…
-- ---------------------------------------------------------------------------

do $storage$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage schema not present — skipping bucket setup (plain Postgres)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values
    ('documents',      'documents',      false, 52428800),  -- 50 MB
    ('intake-uploads', 'intake-uploads', false, 26214400),  -- 25 MB
    ('firm-assets',    'firm-assets',    false, 10485760)   -- 10 MB
  on conflict (id) do nothing;

  -- documents: a version file is visible iff the document_versions row is
  -- visible to the caller (public RLS decides — single source of truth).
  execute $p$
    create policy docket_documents_read on storage.objects for select
    using (
      bucket_id = 'documents'
      and exists (select 1 from public.document_versions v where v.storage_path = name)
    )
  $p$;
  execute $p$
    create policy docket_documents_write on storage.objects for insert
    with check (
      bucket_id = 'documents'
      and (
        app.can_write(((storage.foldername(name))[1])::uuid)
        or exists (
          select 1 from public.documents d
          where d.id = ((storage.foldername(name))[2])::uuid
            and d.owner_id = auth.uid()
        )
      )
    )
  $p$;
  execute $p$
    create policy docket_documents_delete on storage.objects for delete
    using (
      bucket_id = 'documents'
      and app.can_write(((storage.foldername(name))[1])::uuid)
    )
  $p$;

  -- intake-uploads/{firm}/{client}/…: the client writes and reads their own
  -- folder; firm staff read the firm's folder.
  execute $p$
    create policy docket_intake_write on storage.objects for insert
    with check (
      bucket_id = 'intake-uploads'
      and ((storage.foldername(name))[2])::uuid = auth.uid()
    )
  $p$;
  execute $p$
    create policy docket_intake_read on storage.objects for select
    using (
      bucket_id = 'intake-uploads'
      and (
        ((storage.foldername(name))[2])::uuid = auth.uid()
        or app.is_staff(((storage.foldername(name))[1])::uuid)
      )
    )
  $p$;

  -- firm-assets: public read (logos, lawyer photos on the public site),
  -- MFA-verified staff write.
  execute $p$
    create policy docket_assets_read on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'firm-assets')
  $p$;
  execute $p$
    create policy docket_assets_write on storage.objects for insert
    with check (
      bucket_id = 'firm-assets'
      and app.can_write(((storage.foldername(name))[1])::uuid)
    )
  $p$;
  execute $p$
    create policy docket_assets_update on storage.objects for update
    using (
      bucket_id = 'firm-assets'
      and app.can_write(((storage.foldername(name))[1])::uuid)
    )
  $p$;
  execute $p$
    create policy docket_assets_delete on storage.objects for delete
    using (
      bucket_id = 'firm-assets'
      and app.can_write(((storage.foldername(name))[1])::uuid)
    )
  $p$;
end
$storage$;

-- ---------------------------------------------------------------------------
-- pg_cron. dispatch-notifications is driven separately by a Supabase Cron
-- HTTP schedule (see README); these are the pure-SQL jobs.
-- ---------------------------------------------------------------------------

do $cron$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable — skipping job schedules (plain Postgres)';
    return;
  end;

  perform cron.schedule('docket-release-expired-holds', '* * * * *',
    $$select public.release_expired_holds()$$);
  perform cron.schedule('docket-appointment-reminders', '*/5 * * * *',
    $$select public.enqueue_appointment_reminders()$$);
  perform cron.schedule('docket-court-reminders', '0 * * * *',
    $$select public.enqueue_court_reminders()$$);
  perform cron.schedule('docket-overdue-invoices', '17 * * * *',
    $$select public.mark_overdue_invoices()$$);
  perform cron.schedule('docket-sittings-digest', '0 7 * * *',
    $$select public.digest_sittings_without_update()$$);
end
$cron$;
