// A lawyer's Docket diary, as a calendar they subscribe to.
//
// GET /functions/v1/calendar-feed/<token> returns text/calendar. Every calendar app on a phone
// understands that; none of them needs Docket to register an OAuth application, and because it is
// read only there is nothing to reconcile when somebody edits their copy.
//
// This function holds no rule. calendar_feed_events() takes the token, finds whose diary it is,
// applies that person's own matter walls, and returns rows — so there is no firm or user to pass
// and nothing here to get wrong. It runs as the service role, which is why it lives in
// supabase/functions rather than in the Next app.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildCalendar, type IcsEvent } from '../../../src/lib/ics.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

interface Row {
  uid: string;
  kind: string;
  starts_at: string | null;
  ends_at: string | null;
  day: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  status: string;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = (url.pathname.split('/calendar-feed/')[1] ?? '').split('/')[0].trim();

  // A calendar app sends GET, and HEAD before it subscribes.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!token) return new Response('not found', { status: 404 });

  const { data, error } = await supabase.rpc('calendar_feed_events', { p_token: token });
  if (error) {
    // 42501 is every token failure — unknown, revoked, or a member who has left. One answer for all
    // of them: a fetcher learns whether the URL works, never why it does not.
    if (error.code === '42501') return new Response('not found', { status: 404 });
    if (error.code === '53400') return new Response('too many requests', { status: 429 });
    console.error('calendar-feed', error.code, error.message);
    return new Response('unavailable', { status: 500 });
  }

  const asStatus = (s: string): IcsEvent['status'] =>
    s === 'CANCELLED' ? 'CANCELLED' : s === 'TENTATIVE' ? 'TENTATIVE' : 'CONFIRMED';

  const events: IcsEvent[] = ((data ?? []) as Row[]).map((r) => ({
    uid: r.uid,
    // A deadline is a day; a sitting and a consultation are instants.
    start: r.day ?? r.starts_at ?? '',
    end: r.day ? r.day : (r.ends_at ?? undefined),
    allDay: Boolean(r.day),
    summary: r.summary,
    description: r.description ?? undefined,
    location: r.location ?? undefined,
    status: asStatus(r.status),
  })).filter((e) => e.start !== '');

  const body = buildCalendar('Docket', events, new Date().toISOString());
  return new Response(req.method === 'HEAD' ? null : body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="docket.ics"',
      // A feed URL is a bearer credential: no shared cache should ever hold a copy of it.
      'Cache-Control': 'private, no-store',
    },
  });
});
