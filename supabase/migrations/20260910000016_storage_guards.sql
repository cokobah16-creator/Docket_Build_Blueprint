-- Docket — migration 16: storage policies must never throw.
--
-- The 'documents' bucket policies cast path segments to uuid. On Supabase, storage.objects
-- policies are evaluated for every object in a listing, so one object whose name is not
-- {firm}/{document}/{version}.{ext} (an upload made with the dashboard, a stray file) would make
-- the cast throw and every listing or download in the bucket fail. The casts are now guarded:
-- a malformed name simply matches no policy. Nothing changes on a plain Postgres.

create or replace function public.try_uuid(p text) returns uuid
  language sql immutable strict as
  $$ select case when p ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then p::uuid end $$;
grant execute on function public.try_uuid(text) to anon, authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not present — skipping storage policy update';
    return;
  end if;
  execute $p$ drop policy if exists "documents: read the version you may access" on storage.objects $p$;
  execute $p$
    create policy "documents: read the version you may access" on storage.objects for select
      using (bucket_id = 'documents'
             and public.try_uuid(split_part(storage.filename(name), '.', 1)) is not null
             and public.can_access_document_version(public.try_uuid(split_part(storage.filename(name), '.', 1))))
  $p$;
  execute $p$ drop policy if exists "documents: upload if you may add to the document" on storage.objects $p$;
  execute $p$
    create policy "documents: upload if you may add to the document" on storage.objects for insert
      with check (bucket_id = 'documents'
                  and public.try_uuid((storage.foldername(name))[2]) is not null
                  and public.can_upload_document(public.try_uuid((storage.foldername(name))[2])))
  $p$;
  execute $p$ drop policy if exists "intake: client or firm staff reads" on storage.objects $p$;
  execute $p$
    create policy "intake: client or firm staff reads" on storage.objects for select
      using (bucket_id = 'intake-uploads'
             and ((storage.foldername(name))[2] = auth.uid()::text
                  or (public.try_uuid((storage.foldername(name))[1]) is not null
                      and public.is_firm_member(public.try_uuid((storage.foldername(name))[1])))))
  $p$;
  execute $p$ drop policy if exists "firm assets: admin write" on storage.objects $p$;
  execute $p$
    create policy "firm assets: admin write" on storage.objects for all
      using (bucket_id = 'firm-assets' and public.try_uuid((storage.foldername(name))[1]) is not null
             and public.admin_w(public.try_uuid((storage.foldername(name))[1])))
      with check (bucket_id = 'firm-assets' and public.try_uuid((storage.foldername(name))[1]) is not null
                  and public.admin_w(public.try_uuid((storage.foldername(name))[1])))
  $p$;
end $$;
