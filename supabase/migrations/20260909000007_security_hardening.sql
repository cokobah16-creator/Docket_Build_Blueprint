-- Docket — migration 7: hardening from the Supabase security advisor.
-- 1) Pin search_path on the three helper functions that lacked it.
-- 2) The signed-in-only RPCs were granted to `authenticated` but still carried
--    Postgres' default EXECUTE-to-PUBLIC, so `anon` could reach them (they
--    refuse without auth.uid(), but there is no reason to expose them).
--    available_slots stays callable by anon on purpose (the booking wizard).

alter function public.mfa_ok()        set search_path = public;
alter function public.staff_w(uuid)   set search_path = public;
alter function public.admin_w(uuid)   set search_path = public;

revoke execute on function public.book_appointment(uuid,uuid,uuid,timestamptz,appointment_mode,text,jsonb,uuid) from public, anon;
revoke execute on function public.cancel_appointment(uuid,text) from public, anon;
revoke execute on function public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text) from public, anon;
revoke execute on function public.save_consultation_notes(uuid,text,text,text,text,bool) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
