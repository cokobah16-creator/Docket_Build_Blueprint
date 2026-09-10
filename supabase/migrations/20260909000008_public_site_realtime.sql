-- Docket — migration 8 (slice 1): public site + booking plumbing.
-- 1) lawyer_public: anon-safe projection of public lawyer profiles carrying
--    the display name and timezone the site and booking wizard need
--    (profiles itself stays member/self-only).
-- 2) firm_public gains legal_name for the About/Terms pages.
-- 3) appointments join the Realtime publication so the payment-result page
--    can watch its own row (RLS still scopes it to the client).

create view public.lawyer_public with (security_invoker = false) as
  select lp.firm_id, lp.user_id as id, lp.slug, lp.title, lp.bio, lp.photo_path,
         lp.practice_areas, lp.category, p.full_name, p.timezone
  from public.lawyer_profiles lp
  join public.profiles p on p.id = lp.user_id
  where lp.is_public;
grant select on public.lawyer_public to anon, authenticated;

drop view if exists public.firm_public;
create view public.firm_public with (security_invoker = false) as
  select id, slug, name, legal_name, brand, policies, custom_domain, timezone, default_currency
  from public.firms;
grant select on public.firm_public to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'appointments') then
      alter publication supabase_realtime add table public.appointments;
    end if;
  else
    raise notice 'supabase_realtime publication not present — skipping (plain Postgres)';
  end if;
end $$;
