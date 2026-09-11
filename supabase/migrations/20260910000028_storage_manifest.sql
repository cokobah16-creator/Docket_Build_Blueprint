-- The manifest: does every document the database describes actually exist as bytes?
--
-- Supabase's database backup restores storage.objects ROWS; the object BYTES are a separate thing,
-- and docs/RESTORE_RUNBOOK.md §1.2 puts it plainly: a restore that brings back rows without bytes
-- is worse than one that brings back neither, because the system will look intact. Nothing in the
-- repository could say whether it was intact. This is the half of the backup work that needs no
-- decision from anyone: a standing, verified inventory of the bytes, so that "the documents are
-- there" is a measured statement and a restore drill has something to check against. The copy
-- of the bytes to a second location is the other half and waits on where that location is.
--
-- HOW IT IS BUILT. The storage-manifest Edge Function (the one place the service role is
-- permitted) is called by pg_cron on a schedule, takes a bounded batch of objects that have never
-- been verified or were verified longest ago, DOWNLOADS each one — listing proves nothing, the
-- list is a table read — hashes the bytes, compares the hash to document_versions.checksum where
-- there is one, and writes one row here per object. Over successive runs the manifest converges
-- on every object and then keeps every row fresh.
--
-- WHO MAY READ IT. Nobody through the API: the table has RLS and no policy, and no grant. The
-- platform reads a summary through storage_integrity(), which asks is_platform_admin(). A firm
-- has no business with the platform's storage accounting; what a firm needs to know — that its
-- documents open — it learns by opening them.
create table public.storage_manifest (
  bucket          text        not null,
  path            text        not null,
  size_bytes      bigint,
  sha256          text,
  expected_sha256 text,
  status          text        not null check (status in ('ok', 'missing', 'mismatch', 'error')),
  error           text,
  verified_at     timestamptz not null default now(),
  primary key (bucket, path)
);
create index storage_manifest_verified_idx on public.storage_manifest (verified_at);
alter table public.storage_manifest enable row level security;
revoke all on public.storage_manifest from anon, authenticated;

comment on table public.storage_manifest is
  'One row per object in the documents and intake-uploads buckets, as last DOWNLOADED and hashed by the storage-manifest Edge Function. status: ok, missing (rows say it exists, the bytes 404), mismatch (bytes hash differently from document_versions.checksum), error.';

-- The summary the platform reads. On a plain Postgres (local tests) there is no storage schema;
-- the function says so rather than inventing zeros that look like health.
create or replace function public.storage_integrity()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_objects bigint := 0; v_row_only bigint := 0; v_storage boolean := to_regclass('storage.objects') is not null;
        v_ok bigint; v_missing bigint; v_mismatch bigint; v_error bigint; v_stale bigint; v_last timestamptz; v_manifest bigint;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;

  if v_storage then
    execute $q$select count(*) from storage.objects where bucket_id in ('documents', 'intake-uploads')$q$ into v_objects;
    -- The failure the runbook warns of: a version row whose bytes the store does not have at all.
    execute $q$select count(*) from public.document_versions dv
                where not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = dv.storage_path)$q$
      into v_row_only;
  end if;

  select count(*) filter (where status = 'ok'), count(*) filter (where status = 'missing'),
         count(*) filter (where status = 'mismatch'), count(*) filter (where status = 'error'),
         count(*) filter (where verified_at < now() - interval '7 days'), max(verified_at), count(*)
    into v_ok, v_missing, v_mismatch, v_error, v_stale, v_last, v_manifest
    from storage_manifest;

  return jsonb_build_object(
    'storage_present',   v_storage,
    'objects',           v_objects,
    'manifest_rows',     v_manifest,
    'unverified',        greatest(v_objects - v_manifest, 0),
    'ok',                v_ok,
    'missing',           v_missing,
    'mismatch',          v_mismatch,
    'error',             v_error,
    'stale',             v_stale,
    'row_only_versions', v_row_only,
    'last_run_at',       v_last
  );
end $$;
revoke execute on function public.storage_integrity() from public, anon;
grant  execute on function public.storage_integrity() to authenticated;

-- Every ten minutes, a batch. URL and shared secret live in Vault, as migration 9 has the
-- dispatcher's: vault.create_secret('https://<ref>.supabase.co/functions/v1/storage-manifest', 'storage_manifest_url')
-- and the same 'cron_secret'. The job is a no-op until both exist. No-op on plain Postgres.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or to_regclass('vault.secrets') is null then
    raise notice 'pg_cron / pg_net / vault not available — schedule storage-manifest by hand';
    return;
  end if;
  execute 'create extension if not exists pg_net';
  if exists (select 1 from cron.job where jobname = 'docket-storage-manifest') then
    perform cron.unschedule('docket-storage-manifest');
  end if;
  perform cron.schedule('docket-storage-manifest', '*/10 * * * *', $j$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'storage_manifest_url'),
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000)
    where (select count(*) from vault.decrypted_secrets where name in ('storage_manifest_url', 'cron_secret')) = 2
  $j$);
end $$;
