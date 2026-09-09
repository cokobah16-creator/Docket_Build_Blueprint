-- Docket v0.2 — Supabase-hosted pieces: storage buckets/policies and pg_cron schedules.
-- Guarded so the file is a no-op on a plain Postgres (local tests).

-- ---------------------------------------------------------------- storage
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present — skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('firm-assets',    'firm-assets',    true,  5242880,
      array['image/png','image/jpeg','image/webp','image/svg+xml']),
    ('documents',      'documents',      false, 26214400,
      array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg','image/png','image/heic']),
    ('intake-uploads', 'intake-uploads', false, 26214400,
      array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg','image/png','image/heic'])
  on conflict (id) do nothing;

  -- object paths: documents/{firm_id}/{document_id}/{version_id}.{ext}
  --               intake-uploads/{firm_id}/{client_id}/{filename}
  --               firm-assets/{firm_id}/...
  execute $p$
    create policy "documents: read if you can access the document" on storage.objects for select
      using (bucket_id = 'documents'
             and public.can_access_document(((storage.foldername(name))[2])::uuid))
  $p$;
  execute $p$
    create policy "documents: upload if you can access the document" on storage.objects for insert
      with check (bucket_id = 'documents'
                  and public.can_access_document(((storage.foldername(name))[2])::uuid))
  $p$;
  execute $p$
    create policy "intake: client writes own folder" on storage.objects for insert
      with check (bucket_id = 'intake-uploads' and (storage.foldername(name))[2] = auth.uid()::text)
  $p$;
  execute $p$
    create policy "intake: client or firm staff reads" on storage.objects for select
      using (bucket_id = 'intake-uploads'
             and ((storage.foldername(name))[2] = auth.uid()::text
                  or public.is_firm_member(((storage.foldername(name))[1])::uuid)))
  $p$;
  execute $p$
    create policy "firm assets: public read" on storage.objects for select using (bucket_id = 'firm-assets')
  $p$;
  execute $p$
    create policy "firm assets: admin write" on storage.objects for all
      using (bucket_id = 'firm-assets' and public.admin_w(((storage.foldername(name))[1])::uuid))
      with check (bucket_id = 'firm-assets' and public.admin_w(((storage.foldername(name))[1])::uuid))
  $p$;
end $$;

-- ---------------------------------------------------------------- cron
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available — skipping schedules';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  perform cron.schedule('docket-release-holds',      '* * * * *',   $j$ select public.release_expired_holds() $j$);
  perform cron.schedule('docket-appointment-remind', '* * * * *',   $j$ select public.enqueue_appointment_reminders() $j$);
  perform cron.schedule('docket-court-remind',       '0 7 * * *',   $j$ select public.enqueue_court_reminders() $j$);
  perform cron.schedule('docket-overdue-invoices',   '15 0 * * *',  $j$ select public.mark_overdue_invoices() $j$);
  perform cron.schedule('docket-sitting-digest',     '30 7 * * *',  $j$ select public.digest_sittings_without_update() $j$);
  -- the notification dispatcher is an Edge Function; schedule it from the Supabase dashboard
  -- (Integrations → Cron → HTTP request to /functions/v1/dispatch-notifications every minute)
end $$;
