-- The second copy: the other half of the backup work, and the one that needed a decision.
--
-- Migration 28 built the MANIFEST — proof that the bytes the database describes actually exist.
-- It says in its own header that "the copy of the bytes to a second location is the other half and
-- waits on where that location is." That decision is taken: Cloudflare R2, region `enam`.
--
-- WHY A SECOND PROVIDER RATHER THAN A SECOND REGION. What is being insured against is not a
-- regional outage — it is losing the objects entirely: an account closed, a project deleted, a
-- credential compromised, a Supabase-side failure that takes rows and bytes together.
-- docs/RESTORE_RUNBOOK.md §1.2 asks for the copy to live "somewhere a compromise of the Supabase
-- project cannot reach", and only a different provider gives that. `enam` is the same jurisdiction
-- as the us-east-2 primary, so the second copy adds a PROCESSOR to disclose and no new
-- jurisdiction — which is the cheaper compliance answer and the honest one, since the documents are
-- already outside Nigeria. Geographic separation would be `weur` and one more disclosure in every
-- firm's privacy notice; it was considered and not taken.
--
-- WHY A SIBLING TABLE AND NOT A COLUMN ON storage_manifest. They answer different questions and
-- move at different speeds. The manifest asks "do the bytes exist?" and re-verifies everything
-- weekly; replication asks "is there a second copy of these exact bytes?" and only needs to act
-- when an object is new or its hash has changed. One cursor cannot serve both without one of them
-- dragging the other, and a status column that means two things is the sort of thing that is
-- misread once and then relied on.
--
-- WHAT IS NOT HERE. Restoring FROM the replica. That is a runbook procedure, not a scheduled job,
-- and writing it as code nobody has ever run would be the third unexercised claim this repository
-- has had to correct this week. docs/RESTORE_RUNBOOK.md §3 is where it belongs, once the drill has
-- actually been done and can be described from what happened rather than from what should.
create table public.storage_replicas (
  bucket        text        not null,
  path          text        not null,
  -- The hash of what was COPIED. Compared against storage_manifest.sha256 to notice an object that
  -- changed after it was replicated: same path, different bytes, stale copy.
  sha256        text,
  size_bytes    bigint,
  -- What the destination said it stored. An ETag that does not match what we sent is a copy that
  -- did not land, and is recorded as such rather than assumed good.
  replica_etag  text,
  -- 'unconfirmed' is not a hedge, it is the honest fourth answer. A copy is 'ok' only when the
  -- destination recomputed the sha256 and said it matched; a 2xx that confirms nothing is stored
  -- and unproven, and `unreplicated` below counts it as not covered. Deno has no MD5, so the ETag
  -- of a single-part PUT cannot be checked instead — see supabase/functions/storage-replicate.
  status        text        not null check (status in ('ok', 'unconfirmed', 'mismatch', 'error')),
  error         text,
  replicated_at timestamptz not null default now(),
  primary key (bucket, path)
);
create index storage_replicas_replicated_idx on public.storage_replicas (replicated_at);
alter table public.storage_replicas enable row level security;
revoke all on public.storage_replicas from anon, authenticated;

comment on table public.storage_replicas is
  'One row per object copied to the off-Supabase store by the storage-replicate Edge Function. status: ok (copied and the destination CONFIRMED the same sha256), unconfirmed (stored, but the destination confirmed no digest, so the copy is unproven), mismatch (the destination reported different bytes), error. Only ok counts as coverage. No API role may read it; the platform reads storage_replication_health().';

/**
 * What the platform reads. The number that matters is `unreplicated`: objects the manifest has seen
 * for which no GOOD copy exists — which is exactly the set that would be lost.
 *
 * A failed read must never look like health, so this raises rather than returning zeros, in the
 * same shape as storage_integrity().
 */
create or replace function public.storage_replication_health()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_objects bigint := 0; v_storage boolean := to_regclass('storage.objects') is not null;
        v_ok bigint; v_unconfirmed bigint; v_mismatch bigint; v_error bigint; v_rows bigint; v_last timestamptz;
        v_unreplicated bigint; v_stale bigint;
begin
  if not (is_platform_admin() and mfa_ok()) then raise exception 'not permitted' using errcode = '42501'; end if;

  if v_storage then
    execute $q$select count(*) from storage.objects where bucket_id in ('documents', 'intake-uploads')$q$ into v_objects;
  end if;

  select count(*) filter (where status = 'ok'), count(*) filter (where status = 'unconfirmed'),
         count(*) filter (where status = 'mismatch'), count(*) filter (where status = 'error'),
         count(*), max(replicated_at)
    into v_ok, v_unconfirmed, v_mismatch, v_error, v_rows, v_last
    from storage_replicas;

  -- Seen by the manifest, with no GOOD copy. The manifest is the inventory of what exists, so it
  -- is the honest denominator rather than a count of what we happen to have tried. Note the
  -- status = 'ok' on the inner test: an object whose replication ERRORED has a row and no usable
  -- copy, and counting the row as coverage would be the exact self-deception this table exists to
  -- prevent — a number that says the documents are safe because we tried.
  select count(*) into v_unreplicated
    from storage_manifest m
   where m.status = 'ok'
     and not exists (select 1 from storage_replicas r
                      where r.bucket = m.bucket and r.path = m.path and r.status = 'ok');
  -- ('unconfirmed' falls on the uncovered side of that test, deliberately.)

  -- Copied once, then the source changed underneath it. The copy is real and is of the wrong bytes.
  select count(*) into v_stale
    from storage_replicas r join storage_manifest m on m.bucket = r.bucket and m.path = r.path
   where r.status = 'ok' and m.status = 'ok'
     and r.sha256 is distinct from m.sha256;

  return jsonb_build_object(
    'storage_present', v_storage,
    'objects',         v_objects,
    'replica_rows',    v_rows,
    'ok',              v_ok,
    'unconfirmed',     v_unconfirmed,
    'mismatch',        v_mismatch,
    'error',           v_error,
    'unreplicated',    v_unreplicated,
    'stale',           v_stale,
    'last_run_at',     v_last
  );
end $$;
revoke execute on function public.storage_replication_health() from public, anon;
grant  execute on function public.storage_replication_health() to authenticated;

-- Every fifteen minutes, a bounded batch — offset from the manifest's ten so the two are rarely
-- downloading the same object at the same moment. URL and shared secret live in Vault exactly as
-- migration 28 has the manifest's:
--   vault.create_secret('https://<ref>.supabase.co/functions/v1/storage-replicate', 'storage_replicate_url')
-- and the same 'cron_secret'. The job is a NO-OP until both exist, which is why this migration is
-- safe to apply before the R2 bucket is created. No-op on plain Postgres.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or to_regclass('vault.secrets') is null then
    raise notice 'pg_cron / pg_net / vault not available — schedule storage-replicate by hand';
    return;
  end if;
  execute 'create extension if not exists pg_net';
  if exists (select 1 from cron.job where jobname = 'docket-storage-replicate') then
    perform cron.unschedule('docket-storage-replicate');
  end if;
  perform cron.schedule('docket-storage-replicate', '*/15 * * * *', $j$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'storage_replicate_url'),
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000)
    where (select count(*) from vault.decrypted_secrets where name in ('storage_replicate_url', 'cron_secret')) = 2
  $j$);
end $$;
