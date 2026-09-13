-- The words inside a file, and the wall they must not walk around.
--
-- Migration 43 built search and said, in its own header, exactly what it did not do: "a document
-- matches on its name and nothing else... Extraction and OCR are their own piece of work, with
-- their own decisions about where the text is stored and who may read it, and until that exists the
-- search box says so in as many words." This is that piece of work — the extraction half of the
-- assessment's #15b.
--
-- WHERE THE TEXT LIVES, AND WHY IT IS NOT A NEW TABLE. On document_versions, beside the checksum
-- and the storage path, as ordinary columns of the row it belongs to. Every alternative was worse:
--
--  · A `document_text` table with its own RLS is a second statement of who may read a document,
--    and the day migration 29's wall or migration 45's collaboration arm changes, one of the two
--    statements is stale. A wall stated twice is a wall with a hole in it in six months.
--  · A denormalised search index written by a definer trigger is the classic way a carefully built
--    access model leaks: one table, no policy of its own, and every wall in the product is gone
--    behind a text box.
--
-- On the row, `document_versions_select using (can_access_document_version(id))` already decides
-- who may see it — the same function the STORAGE policies call before any byte moves. So the text
-- of a document is readable by exactly the people who may open the document, by construction, and
-- there is nothing here for a future wall to have to remember.
--
-- NOTHING CAN WRITE IT BUT THE EXTRACTOR. update and delete on document_versions were revoked from
-- anon and authenticated in migration 24, and migration 40 narrowed the insert grant to a named
-- list of columns that these are not in. So the only doors are the two definer functions below,
-- and both refuse a caller who has an auth.uid() at all: they are the service role's alone. There
-- is no door beside the door.
--
-- WHAT IS EXTRACTED, AND WHAT IS NOT. src/lib/extract.ts reads plain text, Markdown, CSV, HTML and
-- DOCX exactly, and a PDF's text layer best-effort with a guard that discards anything that does
-- not come back looking like prose. **There is no OCR.** A scan is recorded `no_text_layer`, the
-- screens say its words are not searchable, and docs/DOCUMENT_TEXT.md carries the decision — a
-- per-page cost and a third party receiving clients' documents — that has to be taken before that
-- changes. Recording "we could not read this" is the honest answer; indexing nothing and saying
-- nothing is how a firm comes to believe a search covered a file it never touched.

-- ---------------------------------------------------------------- 1. the columns
alter table public.document_versions
  add column text_status     text not null default 'pending'
    check (text_status in ('pending', 'extracted', 'no_text_layer', 'unsupported', 'failed', 'too_large')),
  add column text_content    text,
  add column text_chars      int,
  -- A document longer than the extractor's cap keeps its first 400,000 characters and says so,
  -- rather than being silently half-indexed.
  add column text_truncated  boolean not null default false,
  add column text_detail     text,
  add column text_extracted_at timestamptz,
  add column text_attempts   int not null default 0,
  add column text_claimed_at timestamptz;

alter table public.document_versions add column text_search_doc tsvector
  generated always as (to_tsvector('english'::regconfig, coalesce(text_content, ''))) stored;
create index document_versions_text_idx on public.document_versions using gin (text_search_doc);
-- The queue. Only a document's CURRENT version is ever extracted, so this index is deliberately
-- not the whole of what is 'pending': a superseded version stays pending for ever and is not
-- waiting for anything, which document_text_health() reports separately rather than as a backlog.
create index document_versions_text_queue_idx on public.document_versions (created_at)
  where text_status in ('pending', 'failed');

comment on column public.document_versions.text_content is
  'The words inside this version of the file, where Docket could read them. Visible to exactly the people can_access_document_version() admits — the same test the storage policies make before any byte moves. Never written by anyone but the extractor.';
comment on column public.document_versions.text_status is
  'pending | extracted | no_text_layer (a scan, or a PDF whose text we cannot decode) | unsupported (a kind of file Docket does not read) | failed | too_large.';

-- ---------------------------------------------------------------- 2. the extractor's two doors
/**
 * A bounded batch of current versions whose text has not been read yet. Service role only: the
 * extract-text Edge Function calls it, downloads each object, and hands the result back below.
 *
 * A claim that never finished — the function died mid-read — goes back in the queue after fifteen
 * minutes, and attempts is what stops a file that kills the extractor from being retried for ever.
 */
create or replace function public.claim_document_text(p_limit int default 5)
returns table (version_id uuid, document_id uuid, storage_path text, mime text, name text, size_bytes bigint)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then raise exception 'not permitted' using errcode = '42501'; end if;
  p_limit := least(greatest(coalesce(p_limit, 5), 1), 50);

  -- A claim nobody finished is not a claim.
  update document_versions v set text_claimed_at = null
   where v.text_claimed_at is not null and v.text_claimed_at < now() - interval '15 minutes';

  return query
    with c as (
      select v.id
        from document_versions v
        join documents d on d.id = v.document_id
       where d.current_version_id = v.id            -- only the version a search would return
         and d.deleted_at is null
         and v.text_claimed_at is null
         and (v.text_status = 'pending'
              or (v.text_status = 'failed' and v.text_attempts < 3
                  and coalesce(v.text_extracted_at, 'epoch'::timestamptz) < now() - interval '1 hour'))
       order by v.created_at
       limit p_limit
       for update of v skip locked),
    u as (
      update document_versions v
         set text_claimed_at = now(), text_attempts = v.text_attempts + 1
        from c where v.id = c.id
      returning v.id, v.document_id, v.storage_path, v.mime, v.size_bytes)
    select u.id, u.document_id, u.storage_path, u.mime, d.name, u.size_bytes
      from u join documents d on d.id = u.document_id;
end $$;
revoke execute on function public.claim_document_text(int) from public, anon, authenticated;

/**
 * What the extractor found. `p_text` is stored only when the status is 'extracted' — every other
 * outcome stores the reason and no text, so there is never a row that half-says something.
 */
create or replace function public.record_document_text(
  p_version uuid, p_status text, p_text text default null,
  p_detail text default null, p_truncated boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_status not in ('extracted', 'no_text_layer', 'unsupported', 'failed', 'too_large') then
    raise exception 'unknown extraction outcome %', p_status using errcode = '22023';
  end if;
  update document_versions
     set text_status      = p_status,
         text_content     = case when p_status = 'extracted' then nullif(p_text, '') end,
         text_chars       = case when p_status = 'extracted' then length(coalesce(p_text, '')) end,
         text_truncated   = case when p_status = 'extracted' then coalesce(p_truncated, false) else false end,
         text_detail      = left(p_detail, 500),
         text_extracted_at = now(),
         text_claimed_at  = null
   where id = p_version;
  if not found then raise exception 'no such document version' using errcode = 'P0002'; end if;
end $$;
revoke execute on function public.record_document_text(uuid, text, text, text, boolean) from public, anon, authenticated;


-- ---------------------------------------------------------------- 3. the schedule
-- Every five minutes, a batch of five. URL and shared secret live in Vault exactly as the
-- dispatcher's and the storage manifest's do:
--   vault.create_secret('https://<ref>.supabase.co/functions/v1/extract-text', 'extract_text_url')
-- and the same 'cron_secret'. The job is a no-op until both exist, and a no-op on plain Postgres,
-- which is why the suite can run this migration without pg_cron.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
     or to_regclass('vault.secrets') is null then
    raise notice 'pg_cron / pg_net / vault not available — schedule extract-text by hand';
    return;
  end if;
  execute 'create extension if not exists pg_net';
  if exists (select 1 from cron.job where jobname = 'docket-extract-text') then
    perform cron.unschedule('docket-extract-text');
  end if;
  perform cron.schedule('docket-extract-text', '*/5 * * * *', $j$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'extract_text_url'),
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body    := '{}'::jsonb,
      timeout_milliseconds := 120000)
    where (select count(*) from vault.decrypted_secrets where name in ('extract_text_url', 'cron_secret')) = 2
  $j$);
end $$;

-- ---------------------------------------------------------------- 4. what the firm can see of it
/**
 * How far the reading has got, for this firm's own current documents. Counts only — never a word of
 * anybody's text, and never another firm's numbers.
 *
 * `waiting` is what is actually queued. A superseded version is not counted anywhere here, because
 * it is not waiting and never will be: it is simply not searched.
 */
create or replace function public.document_text_health(p_firm uuid)
returns table (waiting bigint, extracted bigint, no_text_layer bigint, unsupported bigint,
               failed bigint, too_large bigint, last_extracted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where v.text_status in ('pending', 'failed') and v.text_attempts < 3),
         count(*) filter (where v.text_status = 'extracted'),
         count(*) filter (where v.text_status = 'no_text_layer'),
         count(*) filter (where v.text_status = 'unsupported'),
         count(*) filter (where v.text_status = 'failed' and v.text_attempts >= 3),
         count(*) filter (where v.text_status = 'too_large'),
         max(v.text_extracted_at)
    from documents d
    join document_versions v on v.id = d.current_version_id
   where d.firm_id = p_firm and d.deleted_at is null
     and is_firm_member(p_firm)
$$;
revoke execute on function public.document_text_health(uuid) from public, anon;
grant  execute on function public.document_text_health(uuid) to authenticated;

-- ---------------------------------------------------------------- 5. search reaches inside
-- Migration 43's function, re-created with ONE arm changed: the document arm. Everything else is
-- character for character what migration 43 wrote, and it is repeated in full rather than patched
-- because a SQL function has no patch — the whole body is the definition, and a reviewer must be
-- able to read what is now running without holding two files open. The changed arm carries its own
-- reasoning, and the wall is not restated there: see the note above it.
--
-- ts_headline still gives the fragment, still after the limit, exactly as migration 43 arranged it.
-- What it is given for a document is the first 12,000 characters of the text — the reason is in the
-- arm.
create or replace function public.search_docket(
  p_q text, p_firm uuid default null, p_kinds text[] default null, p_limit int default 30)
returns table (kind text, id uuid, firm_id uuid, matter_id uuid, title text, snippet text,
               occurred_at timestamptz, rank real)
language sql stable as $$
  -- A query of one character matches most of a caseload, which is not a search; the cross join to
  -- `q` is what enforces it, because an empty q makes every arm below return nothing.
  with q as (
    select websearch_to_tsquery('english', btrim(p_q))          as tsq,
           '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as like_q,
           greatest(1, least(coalesce(p_limit, 30), 100))       as lim
      where length(btrim(coalesce(p_q, ''))) between 2 and 200
  ),
  hits as (
    -- A matter matches on its prose, and separately on any reference a lawyer would type: the
    -- Docket reference, the file number it came in with, the suit number (however it is spaced),
    -- the court's own case id, and any number recorded against it in the court-numbers table.
    select 'matter'::text as kind, m.id, m.firm_id, m.id as matter_id, m.title,
           nullif(concat_ws(' · ', m.reference, m.suit_number, m.description), '') as body,
           m.created_at as occurred_at,
           ts_rank_cd(m.search_doc, q.tsq)
             + case when m.reference ilike q.like_q or m.legacy_reference ilike q.like_q
                      or m.suit_number ilike q.like_q or m.court_case_ref ilike q.like_q
                      or m.suit_number_norm like upper(regexp_replace(q.like_q, '\s', '', 'g'))
                      or exists (select 1 from matter_court_numbers cn
                                  where cn.matter_id = m.id and cn.number ilike q.like_q)
                    then 1.0 else 0.0 end::real as rank
      from matters m, q
     where m.deleted_at is null
       and (p_firm is null or m.firm_id = p_firm)
       and (m.search_doc @@ q.tsq
            or m.reference ilike q.like_q or m.legacy_reference ilike q.like_q
            or m.suit_number ilike q.like_q or m.court_case_ref ilike q.like_q
            or m.suit_number_norm like upper(regexp_replace(q.like_q, '\s', '', 'g'))
            or exists (select 1 from matter_court_numbers cn
                        where cn.matter_id = m.id and cn.number ilike q.like_q))

    union all
    select 'update', u.id, u.firm_id, u.matter_id, u.title, u.body, u.occurred_at,
           ts_rank_cd(u.search_doc, q.tsq)::real
      from updates u, q
     where (p_firm is null or u.firm_id = p_firm) and u.search_doc @@ q.tsq

    union all
    select 'message', g.id, g.firm_id, g.matter_id, 'Message'::text, g.body, g.created_at,
           ts_rank_cd(g.search_doc, q.tsq)::real
      from messages g, q
     where (p_firm is null or g.firm_id = p_firm) and g.search_doc @@ q.tsq

    -- The name of a document AND, since migration 48, the words inside its current version where
    -- Docket could read them. A file whose words could not be read is found by its name exactly as
    -- before, and the screens say of it that its contents are not searchable.
    --
    -- The wall is not restated here and must never be. This function is SECURITY INVOKER, so the
    -- join below reads document_versions under the caller's own RLS —
    -- can_access_document_version(id), the same function the STORAGE policies call before any byte
    -- moves. A colleague outside a restricted matter's team gets no row from `documents` and none
    -- from `document_versions`, so no phrase inside that matter's files is findable by them, and
    -- there was nothing here to remember to add.
    --
    -- The body handed on for the snippet is the first 12,000 characters. The MATCH is over the
    -- whole text — the tsvector is the whole text — but ts_headline is linear in what it is given,
    -- and running it over a few hundred pages, thirty times, would make the search box slow enough
    -- that nobody used it. So a hit deep in a long document is still found; its fragment may then
    -- be the document's opening rather than the passage. Stated because it is visible.
    union all
    select 'document', d.id, d.firm_id, d.matter_id, d.name,
           case when dv.text_search_doc @@ q.tsq then left(dv.text_content, 12000) else d.category end,
           d.created_at,
           (ts_rank_cd(d.search_doc, q.tsq)
            + case when d.name ilike q.like_q then 0.5 else 0.0 end
            + case when dv.text_search_doc @@ q.tsq then ts_rank_cd(dv.text_search_doc, q.tsq) else 0.0 end)::real
      from documents d
      left join document_versions dv on dv.id = d.current_version_id, q
     where d.deleted_at is null
       and (p_firm is null or d.firm_id = p_firm)
       and (d.search_doc @@ q.tsq or d.name ilike q.like_q or dv.text_search_doc @@ q.tsq)

    union all
    select 'task', t.id, t.firm_id, t.matter_id, t.title, null::text, t.created_at,
           ts_rank_cd(t.search_doc, q.tsq)::real
      from tasks t, q
     where (p_firm is null or t.firm_id = p_firm) and t.search_doc @@ q.tsq

    union all
    select 'deadline', dl.id, dl.firm_id, dl.matter_id, dl.title,
           nullif(concat_ws(' · ', dl.rule_name, dl.provision_label, dl.note), ''), dl.computed_at,
           ts_rank_cd(dl.search_doc, q.tsq)::real
      from deadlines dl, q
     where (p_firm is null or dl.firm_id = p_firm) and dl.search_doc @@ q.tsq

    union all
    select 'court_event', ce.id, ce.firm_id, ce.matter_id,
           coalesce(nullif(ce.purpose, ''), 'Court sitting'), ce.court_name, ce.scheduled_at,
           ts_rank_cd(ce.search_doc, q.tsq)::real
      from court_events ce, q
     where (p_firm is null or ce.firm_id = p_firm) and ce.search_doc @@ q.tsq

    union all
    select 'adverse_party', ap.id, ap.firm_id, ap.matter_id, ap.name,
           nullif(concat_ws(' · ', array_to_string(ap.aliases, ', '), ap.note), ''), ap.created_at,
           (ts_rank_cd(ap.search_doc, q.tsq) + case when ap.name ilike q.like_q then 0.5 else 0.0 end)::real
      from matter_adverse_parties ap, q
     where (p_firm is null or ap.firm_id = p_firm)
       and (ap.search_doc @@ q.tsq or ap.name ilike q.like_q
            or exists (select 1 from unnest(ap.aliases) a where a ilike q.like_q))

    union all
    select 'note', cn.id, cn.firm_id, cn.matter_id, 'Consultation note'::text,
           nullif(concat_ws(' · ', cn.client_summary, cn.advice_given, cn.follow_up), ''), cn.created_at,
           ts_rank_cd(cn.search_doc, q.tsq)::real
      from consultation_notes cn, q
     where (p_firm is null or cn.firm_id = p_firm) and cn.search_doc @@ q.tsq

    union all
    select 'internal_note', inn.id, inn.firm_id, null::uuid, 'Internal note'::text, inn.body, inn.created_at,
           ts_rank_cd(inn.search_doc, q.tsq)::real
      from consultation_internal_notes inn, q
     where (p_firm is null or inn.firm_id = p_firm) and inn.search_doc @@ q.tsq

    union all
    select 'invoice', i.id, i.firm_id, i.matter_id, i.number,
           (i.currency || ' ' || (i.total_minor / 100.0)::text || ' · ' || i.status), i.created_at,
           case when i.number ilike q.like_q then 1.0 else 0.0 end::real
      from invoices i, q
     where (p_firm is null or i.firm_id = p_firm) and i.number ilike q.like_q

    union all
    select 'appointment', a.id, a.firm_id, a.matter_id, a.reference, a.status::text, a.starts_at,
           case when a.reference ilike q.like_q then 1.0 else 0.0 end::real
      from appointments a, q
     where (p_firm is null or a.firm_id = p_firm) and a.reference ilike q.like_q

    -- A person, with NO matter against them: which matters a client has is the wall's to decide,
    -- and this arm answers "who is this?", not "what are they in?". One row per person, however many
    -- matters they are on, because no matter is joined to them here.
    union all
    select 'person', pr.id, null::uuid, null::uuid, coalesce(pr.full_name, pr.email, pr.phone, 'Client'),
           nullif(concat_ws(' · ', pr.email, pr.phone), ''), pr.created_at,
           case when pr.full_name ilike q.like_q then 1.0 else 0.5 end::real
      from profiles pr, q
     where (pr.full_name ilike q.like_q or pr.email ilike q.like_q or pr.phone ilike q.like_q)
       and (p_firm is null
            or exists (select 1 from matter_parties mp where mp.user_id = pr.id and mp.firm_id = p_firm)
            or exists (select 1 from appointments ap2 where ap2.client_id = pr.id and ap2.firm_id = p_firm)
            or exists (select 1 from firm_members fm where fm.user_id = pr.id and fm.firm_id = p_firm))
  ),
  -- Limited FIRST, then given a snippet: ts_headline is expensive and there is no reason to run it
  -- over everything that matched only to throw the result away.
  top as (
    select h.*, q.tsq from hits h, q
     where p_kinds is null or h.kind = any (p_kinds)
     order by h.rank desc, h.occurred_at desc nulls last
     limit (select lim from q)
  )
  select top.kind, top.id, top.firm_id, top.matter_id, top.title,
         case when top.body is null or btrim(top.body) = '' then null
              else ts_headline('english', top.body, top.tsq,
                               'MaxFragments=1, MaxWords=22, MinWords=8, ShortWord=2, StartSel=<<, StopSel=>>') end,
         top.occurred_at, top.rank::real
    from top
   order by top.rank desc, top.occurred_at desc nulls last
$$;
revoke execute on function public.search_docket(text, uuid, text[], int) from public, anon;
grant  execute on function public.search_docket(text, uuid, text[], int) to authenticated;
comment on function public.search_docket(text, uuid, text[], int) is
  'Search the text Docket holds, as the caller. SECURITY INVOKER on purpose: every arm reads its own table under the caller''s RLS, so the search inherits every wall and can never be ahead of one. Since migration 48 it reaches inside a document too, where the extractor could read it — a scan has no words to find, and the screens say so.';
