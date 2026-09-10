// Supabase Edge Function — consultation video sessions (Daily).
// The only writer of consultation_sessions (service role). Callers are ordinary signed-in users:
//   { action: 'join',  appointment_id }               → get-or-create the private knocking room; owner token for the lawyer
//   { action: 'event', appointment_id, event }        → record admitted / started / ended in the session row
// Rules (blueprint §10, BUILD_PROMPTS slice 2): confirmed/rescheduled appointments only, from 10 minutes before
// starts_at until 1 hour after ends_at; the lawyer (firm staff, MFA session) is the room owner and admits the
// client; the client is a participant; the room expires at ends_at + 1h; recording is never enabled.
import { createClient } from 'npm:@supabase/supabase-js@2';

const DAILY = 'https://api.daily.co/v1';
const DAILY_KEY = Deno.env.get('DAILY_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const JOIN_BEFORE_MS = 10 * 60 * 1000;
const ROOM_AFTER_MS = 60 * 60 * 1000;

type Appt = {
  id: string; firm_id: string; client_id: string; lawyer_id: string | null; status: string; mode: string;
  starts_at: string; ends_at: string; reference: string;
};
type Session = { id: string; room_name: string | null; room_expires_at: string | null; started_at: string | null; client_admitted_at: string | null; ended_at: string | null; events: unknown[] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function jwtClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1];
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return {}; }
}

async function daily(path: string, init: RequestInit = {}) {
  const res = await fetch(`${DAILY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${DAILY_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { info: text }; }
  return { ok: res.ok, status: res.status, body };
}

/** Private room named after the appointment, knocking on, expiring 1h after the appointment ends. */
async function ensureRoom(name: string, expiresAt: Date): Promise<{ url: string; exp: number }> {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const props = {
    exp, enable_knocking: true, enable_screenshare: true, enable_chat: true, eject_at_room_exp: true,
    enable_prejoin_ui: false, enable_people_ui: true, enable_network_ui: true, start_video_off: false, start_audio_off: false,
  };
  const existing = await daily(`/rooms/${encodeURIComponent(name)}`);
  if (existing.ok) {
    const currentExp: number | undefined = existing.body?.config?.exp;
    if (currentExp && currentExp >= exp) return { url: existing.body.url, exp: currentExp };
    // rescheduled later than the room allows: extend it
    const upd = await daily(`/rooms/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify({ properties: props }) });
    if (!upd.ok) throw new Error(`Daily room update failed: ${upd.body?.info ?? upd.status}`);
    return { url: upd.body.url, exp };
  }
  const created = await daily('/rooms', { method: 'POST', body: JSON.stringify({ name, privacy: 'private', properties: props }) });
  if (!created.ok) throw new Error(`Daily room create failed: ${created.body?.info ?? created.status}`);
  return { url: created.body.url, exp };
}

async function mintToken(roomName: string, userId: string, userName: string, isOwner: boolean, exp: number): Promise<string> {
  const res = await daily('/meeting-tokens', {
    method: 'POST',
    body: JSON.stringify({ properties: { room_name: roomName, user_id: userId, user_name: userName, is_owner: isOwner, exp, enable_screenshare: true } }),
  });
  if (!res.ok) throw new Error(`Daily token failed: ${res.body?.info ?? res.status}`);
  return res.body.token as string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'not signed in' }, 401);

  const asUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await asUser.auth.getUser();
  if (userErr || !user) return json({ error: 'not signed in' }, 401);

  let input: { action?: string; appointment_id?: string; event?: string } = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid body' }, 400); }
  const appointmentId = String(input.appointment_id ?? '');
  if (!/^[0-9a-f-]{36}$/.test(appointmentId)) return json({ error: 'appointment_id required' }, 400);

  const { data: apptRow } = await admin
    .from('appointments')
    .select('id, firm_id, client_id, lawyer_id, status, mode, starts_at, ends_at, reference')
    .eq('id', appointmentId).maybeSingle();
  const appt = apptRow as Appt | null;
  if (!appt) return json({ error: 'appointment not found' }, 404);

  // Who is asking? The client of this appointment, or staff of its firm (owner side, MFA-verified session).
  let role: 'participant' | 'owner' | null = null;
  if (appt.client_id === user.id) role = 'participant';
  else {
    const { data: member } = await admin.from('firm_members').select('role').eq('firm_id', appt.firm_id).eq('user_id', user.id).maybeSingle();
    if (member) {
      if (jwtClaims(token).aal !== 'aal2') return json({ error: 'staff need a verified second factor to run consultations' }, 403);
      role = 'owner';
    }
  }
  if (!role) return json({ error: 'not permitted' }, 403);

  if (input.action === 'event') {
    const ev = String(input.event ?? '');
    if (!['joined', 'admitted', 'started', 'ended', 'left'].includes(ev)) return json({ error: 'unknown event' }, 400);
    const { data: sess } = await admin.from('consultation_sessions').select('id, events, started_at, client_admitted_at, ended_at').eq('appointment_id', appt.id).maybeSingle();
    if (!sess) return json({ error: 'no session yet' }, 404);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { events: [...((sess as Session).events ?? []), { at: now, by: role, type: ev }] };
    if (ev === 'started' && !(sess as Session).started_at) patch.started_at = now;
    if (ev === 'admitted' && role === 'owner' && !(sess as Session).client_admitted_at) patch.client_admitted_at = now;
    if (ev === 'ended' && role === 'owner') patch.ended_at = now;
    await admin.from('consultation_sessions').update(patch).eq('id', (sess as Session).id);
    return json({ ok: true });
  }

  if (input.action !== 'join') return json({ error: 'unknown action' }, 400);
  if (!DAILY_KEY) return json({ error: 'video is not configured' }, 503);
  if (appt.mode !== 'virtual') return json({ error: 'this appointment is not a virtual consultation' }, 409);
  if (!['confirmed', 'rescheduled'].includes(appt.status)) return json({ error: `appointment is ${appt.status.replace('_', ' ')}` }, 409);

  const starts = new Date(appt.starts_at).getTime();
  const ends = new Date(appt.ends_at).getTime();
  const nowMs = Date.now();
  if (nowMs < starts - JOIN_BEFORE_MS) return json({ error: 'too early', opens_at: new Date(starts - JOIN_BEFORE_MS).toISOString() }, 425);
  if (nowMs > ends + ROOM_AFTER_MS) return json({ error: 'this consultation has ended' }, 410);

  const roomExpiry = new Date(ends + ROOM_AFTER_MS);
  const roomName = `appt-${appt.id}`;
  let room: { url: string; exp: number };
  try { room = await ensureRoom(roomName, roomExpiry); }
  catch (e) { return json({ error: (e as Error).message }, 502); }

  const { data: existing } = await admin.from('consultation_sessions').select('id, room_name, room_expires_at').eq('appointment_id', appt.id).maybeSingle();
  if (!existing) {
    await admin.from('consultation_sessions').insert({ firm_id: appt.firm_id, appointment_id: appt.id, provider: 'daily', room_name: roomName, room_expires_at: roomExpiry.toISOString() });
  } else if ((existing as Session).room_name !== roomName || (existing as Session).room_expires_at !== roomExpiry.toISOString()) {
    await admin.from('consultation_sessions').update({ room_name: roomName, room_expires_at: roomExpiry.toISOString() }).eq('id', (existing as Session).id);
  }

  const { data: prof } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const userName = (prof as { full_name: string | null } | null)?.full_name?.trim() || (role === 'owner' ? 'Lawyer' : 'Client');
  // Daily lets a token holder straight in, bypassing knocking — so only the owner gets one.
  // The client joins the private room with the URL and a display name, knocks, and waits to be admitted.
  let meetingToken: string | null = null;
  if (role === 'owner') {
    try { meetingToken = await mintToken(roomName, user.id, userName, true, room.exp); }
    catch (e) { return json({ error: (e as Error).message }, 502); }
  }

  await admin.rpc('audit', {
    p_action: 'consultation.join', p_entity: 'appointment', p_entity_id: appt.id, p_firm: appt.firm_id,
    p_meta: { role, user_id: user.id, room: roomName },
  });

  return json({
    room_url: room.url, token: meetingToken, user_name: userName, role, room_name: roomName,
    expires_at: new Date(room.exp * 1000).toISOString(), starts_at: appt.starts_at, ends_at: appt.ends_at, reference: appt.reference,
  });
});
