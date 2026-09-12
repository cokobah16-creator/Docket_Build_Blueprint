-- Search, and the wall it must not defeat.
--
-- Until now the only searchable text about a file was its name, typed into a browser's find-in-page
-- on whatever the list happened to have loaded. A firm with a real caseload cannot work that way:
-- "which matter was the Ikeja tenancy?" is a question the product could not answer.
--
-- The assessment (#15b) asks for search and says the thing that matters about it: it must be
-- permission-scoped from day one, or it becomes the hole that defeats Wave 2's walls. A search box
-- is the classic way a carefully built access model leaks — one denormalised index table, written
-- by a definer trigger, read by a definer function, and every wall in the product is gone behind a
-- text box.
--
-- SO THIS ONE HOLDS NO COPY OF THE TEXT AND HAS NO PRIVILEGES OF ITS OWN.
--
--  · Each row offers a `search_doc` — a tsvector GENERATED ALWAYS from its own columns, stored and
--    indexed. It is part of the row. It is deleted when the row is, updated when the row is, and
--    visible exactly when the row is: there is no second copy to drift, no trigger to miss an
--    update, and nothing to reconcile.
--  · search_docket() is SECURITY INVOKER — deliberately, and it is the whole design. It runs as the
--    caller, so every arm of it reads its own table under that caller's own RLS. A matter walled by
--    migration 29 is not in `matters` for this caller, so it cannot be in the result; an internal
--    update is not in `updates` for a client; a document the caller may not open is not in
--    `documents`. The search inherits every wall the product has and can never be ahead of one.
--    If a future wall is added to a table, this function is walled by it the same day, with no edit
--    here. That is the point of building it this way rather than the fast way.
--
-- WHAT IT DOES NOT SEARCH, SAID PLAINLY. The CONTENTS of uploaded files. A document matches on its
-- name and nothing else: Docket does not extract text from a PDF or a scan, so a clause inside an
-- agreement is not findable and the screens must not suggest it is. Extraction and OCR are their own
-- piece of work, with their own decisions about where the text is stored and who may read it, and
-- until that exists the search box says so in as many words.
--
-- One disclosure worth stating rather than discovering. The person arm returns a client the caller
-- may already read under can_see_profile() — which has always let any member of a firm see any
-- client of that firm — but it returns NO matter against them, because which matters a client has
-- is exactly what the wall decides. So a walled matter cannot be found through the name of its
-- client, and nothing here widens who is known to whom.

-- ---------------------------------------------------------------- 1. what each row offers
-- 'english' throughout: the prose in this product is English, and a stemmed reference number is
-- nonsense, so references and numbers are matched literally in section 2 rather than stemmed here.

alter table public.matters add column search_doc tsvector generated always as (
  to_tsvector('english'::regconfig,
    coalesce(title, '') || ' ' || coalesce(cause_title, '') || ' ' || coalesce(description, '') || ' ' ||
    coalesce(next_action, '') || ' ' || coalesce(opposing_party, '') || ' ' || coalesce(judge, '') || ' ' ||
    coalesce(court_name, '') || ' ' || coalesce(judicial_division, ''))) stored;
create index matters_search_idx on public.matters using gin (search_doc);
comment on column public.matters.search_doc is
  'The matter''s own prose, for search. Generated: it is the row, so it cannot drift from it and is visible exactly when the row is.';

alter table public.updates add column search_doc tsvector generated always as (
  to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(body, ''))) stored;
create index updates_search_idx on public.updates using gin (search_doc);

alter table public.messages add column search_doc tsvector generated always as (
  to_tsvector('english'::regconfig, coalesce(body, ''))) stored;
create index messages_search_idx on public.messages using gin (search_doc);

alter table public.documents add column search_doc tsvector generated always as (
  to_tsvector('english'::regconfig, coalesce(name, '') || ' ' || coalesce(category, ''))) stored;
create index documents_search_idx on public.documents using gin (search_doc);

alter table public.tasks add column search_doc tsvector generated always as (
  to_tsvector('english'::regconfig, coalesce(title, ''))) stored;
create index tasks_search_idx on public.tasks using gin (search_doc);

alter table public.deadlines add column search_doc tsvector generated always as (
  to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(note, '') || ' ' ||
                         coalesce(rule_name, '') || ' ' || coalesce(provision_label, ''))) stored;
create index deadlines_search_idx on public.deadlines using gin (search_doc);

alter table public.court_events add column search_doc tsvector generated always as (
  to_tsvector('english'::regconfig, coalesce(purpose, '') || ' ' || coalesce(court_name, ''))) stored;
create index court_events_search_idx on public.court_events using gin (search_doc);

-- Without the aliases: array_to_string() is STABLE (it reaches for the element type's output
-- function), so a generated column may not call it. No loss — an alias is a name, and the arm below
-- matches names by substring through unnest(), which finds "Okonkwo" inside "A. B. Okonkwo & Sons"
-- where stemming would not.
alter table public.matter_adverse_parties add column search_doc tsvector generated always as (
  to_tsvector('english'::regconfig, coalesce(name, '') || ' ' || coalesce(note, ''))) stored;
create index matter_adverse_parties_search_idx on public.matter_adverse_parties using gin (search_doc);

alter table public.consultation_notes add column search_doc tsvector generated always as (
  to_tsvector('english'::regconfig, coalesce(client_summary, '') || ' ' || coalesce(advice_given, '') || ' ' ||
                         coalesce(follow_up, ''))) stored;
create index consultation_notes_search_idx on public.consultation_notes using gin (search_doc);

-- Staff work product. It has no client policy and never has; it is searchable only by the people
-- its own policy already admits.
alter table public.consultation_internal_notes add column search_doc tsvector generated always as (
  to_tsvector('english'::regconfig, coalesce(body, ''))) stored;
create index consultation_internal_notes_search_idx on public.consultation_internal_notes using gin (search_doc);

-- ---------------------------------------------------------------- 2. the search
-- SECURITY INVOKER. There is no `security definer` on this function and there must never be: the
-- guard is that every arm reads its own table as the caller, under that caller's RLS. Adding
-- `security definer` here would turn it into a firm-wide, wall-free read of everything in one line.
--
-- p_firm scopes the search to one firm for the console, which is firm-scoped; a client passes null
-- and searches everything they are a party to, across firms, because that is what their portal is.
-- Neither is a privilege: RLS decides in both cases, and p_firm only narrows.
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

    -- The NAME of a document, and not one word of what is inside it. See the header.
    union all
    select 'document', d.id, d.firm_id, d.matter_id, d.name, d.category, d.created_at,
           (ts_rank_cd(d.search_doc, q.tsq) + case when d.name ilike q.like_q then 0.5 else 0.0 end)::real
      from documents d, q
     where d.deleted_at is null
       and (p_firm is null or d.firm_id = p_firm)
       and (d.search_doc @@ q.tsq or d.name ilike q.like_q)

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
  'Search the text Docket holds, as the caller. SECURITY INVOKER on purpose: every arm reads its own table under the caller''s RLS, so the search inherits every wall and can never be ahead of one. It does NOT search the contents of uploaded files — only their names.';
