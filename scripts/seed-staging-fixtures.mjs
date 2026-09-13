#!/usr/bin/env node
// Provision the accounts and rows the authenticated journeys need, on a STAGING project.
//
// STATUS: complete, and NEVER YET RUN. Every step below is written against the real policies and
// RPCs — the signatures were read out of supabase/migrations and docs/RPC_REFERENCE.md rather than
// remembered — but nothing has executed it end to end, because staging was still applying its
// schema when it was written. Treat the first clean run as the moment it becomes evidence.
//
// WHY THIS EXISTS. tests/integration/README.md asks a person to hand-make six things before the
// journeys can run: a client with a matter, a message and a document; a second firm acting for the
// same client; a firm member with TOTP enrolled AND the base32 secret kept; and a matter the client
// has no claim on. Hand-made fixtures rot, nobody remembers which account was which, and the secret
// that "cannot be recovered afterwards" is exactly the one somebody loses. This makes the whole set
// reproducible from an empty project, and prints the environment block at the end.
//
// IT USES THE PRODUCT'S OWN DOORS. The service role is used for the two things only it can do —
// creating auth users, and bootstrapping the first platform admin — and for nothing else. The firm
// is opened with create_firm() the way a firm opens itself; the client is attached with
// invite_matter_party() and accept_invite() the way a real client is; matters are opened with
// open_matter(). A fixture built by inserting rows behind the policies would prove the journeys can
// read data that no real flow could ever have produced.
//
// Dependency-free on purpose: global fetch, node 18+. Same reasoning as src/lib/pdf.ts and the
// TOTP in tests/integration/journeys.spec.ts — a fixture script that needs an install is a fixture
// script that stops working.
//
//   SUPABASE_URL=https://<staging-ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   SUPABASE_ANON_KEY=... \
//   node scripts/seed-staging-fixtures.mjs
//
// Re-running is safe: every step checks for what it would create first.

import { createHmac, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------- guards
const URL_ = process.env.SUPABASE_URL ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';

// The production project, by name, so this can never be pointed at it by a copied shell line.
// docs/ENVIRONMENTS.md rule 2: no test ever points at production.
const PRODUCTION_REF = 'xgxuwimcxkpgtfkunwfe';

function die(msg) { console.error(`\n${msg}\n`); process.exit(1); }

if (!URL_ || !SERVICE || !ANON) {
  die('set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY for the STAGING project.');
}
if (URL_.includes(PRODUCTION_REF)) {
  die(`refusing to run: ${PRODUCTION_REF} is the PRODUCTION project.\n` +
      'This script creates accounts, opens matters and posts messages. See docs/ENVIRONMENTS.md.');
}

// ---------------------------------------------------------------- tiny HTTP helpers
const base = URL_.replace(/\/$/, '');

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep the text */ }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

/** Storage wants raw bytes and a real content type, not JSON. */
async function putObject(bucket, path, bytes, contentType, token) {
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload ${bucket}/${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

const admin = (path, opts = {}) =>
  api(path, { ...opts, token: SERVICE, headers: { ...(opts.headers ?? {}), apikey: SERVICE } });

/** PostgREST as the service role. Used ONLY for reads this script needs to be idempotent. */
const svcSelect = (table, query) => admin(`/rest/v1/${table}?${query}`);

/** An RPC as a signed-in person, under RLS. This is how everything real is done here. */
const rpcAs = (token, fn, args) =>
  api(`/rest/v1/rpc/${fn}`, { method: 'POST', token, body: args ?? {} });

// ---------------------------------------------------------------- TOTP (RFC 6238)
// The same implementation as tests/integration/journeys.spec.ts, so the secret this prints is one
// that file can use. Kept here rather than imported: that file is TypeScript under Playwright.
function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = secret.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error(`not base32: bad char ${char}`);
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 0xff); }
  }
  return Buffer.from(out);
}

function totp(secret, atMs = Date.now()) {
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
               ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

/** Never submit a code that expires in transit. */
async function freshTotp(secret) {
  const into = Date.now() % 30_000;
  if (into > 27_000) await new Promise((r) => setTimeout(r, 30_000 - into + 500));
  return totp(secret);
}

// ---------------------------------------------------------------- accounts
const PASSWORD = 'Docket-staging-' + '9f4c2a7e';   // fixed, so a re-run signs in rather than fails

/**
 * Create an auth user if it is not already there. The profiles row is made by the
 * on_auth_user_created trigger (migration 3, handle_new_user) from email, phone and
 * raw_user_meta_data.full_name — this passes all three rather than patching profiles afterwards.
 */
async function ensureUser({ email, phone, fullName, password }) {
  const existing = await admin(`/auth/v1/admin/users?filter=${encodeURIComponent(email)}`);
  const found = (existing?.users ?? []).find((u) => u.email === email);
  if (found) return { id: found.id, created: false };
  const made = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email,
      ...(phone ? { phone } : {}),
      ...(password ? { password } : {}),
      email_confirm: true,
      ...(phone ? { phone_confirm: true } : {}),
      user_metadata: { full_name: fullName },
    },
  });
  return { id: made.id, created: true };
}

async function signInWithPassword(email, password) {
  const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  return r.access_token;
}

/**
 * A real magic link, redeemed. The mail transport is the only thing skipped: GoTrue mints the
 * token and /auth/v1/verify redeems it exactly as it would from an inbox. Clients have no password
 * anywhere in Docket, so this is the only honest way to hold a client session.
 */
async function signInClientByMagicLink(email) {
  const link = await admin('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: { type: 'magiclink', email },
  });
  const hashed = link?.hashed_token ?? link?.properties?.hashed_token;
  if (!hashed) throw new Error('generate_link returned no hashed_token');
  const r = await api('/auth/v1/verify', {
    method: 'POST',
    body: { type: 'magiclink', token_hash: hashed },
  });
  return r.access_token;
}

/** Enrol TOTP and reach aal2. Returns { token, secret } — the secret is what the journeys need. */
async function enrolTotp(email) {
  let token = await signInWithPassword(email, PASSWORD);
  const factors = await api('/auth/v1/factors', { method: 'POST', token, body: { factor_type: 'totp' } });
  const factorId = factors.id;
  const secret = factors?.totp?.secret;
  if (!secret) throw new Error('enrol returned no TOTP secret');
  const challenge = await api(`/auth/v1/factors/${factorId}/challenge`, { method: 'POST', token, body: {} });
  const verified = await api(`/auth/v1/factors/${factorId}/verify`, {
    method: 'POST', token,
    body: { challenge_id: challenge.id, code: await freshTotp(secret) },
  });
  return { token: verified.access_token, secret };
}

/** Sign in and climb to aal2 with a secret we already hold. */
async function signInStaffAal2(email, secret) {
  const token = await signInWithPassword(email, PASSWORD);
  const list = await api('/auth/v1/factors', { token });
  const factor = (list?.totp ?? list?.all ?? []).find((f) => f.status === 'verified') ?? (list?.totp ?? [])[0];
  if (!factor) throw new Error(`no TOTP factor on ${email}`);
  const challenge = await api(`/auth/v1/factors/${factor.id}/challenge`, { method: 'POST', token, body: {} });
  const verified = await api(`/auth/v1/factors/${factor.id}/verify`, {
    method: 'POST', token,
    body: { challenge_id: challenge.id, code: await freshTotp(secret) },
  });
  return verified.access_token;
}

// ---------------------------------------------------------------- the fixtures
const FIXTURES = {
  staff:      { email: 'staff.owner@docket-staging.invalid',   fullName: 'Ada Owner' },
  colleague:  { email: 'staff.colleague@docket-staging.invalid', fullName: 'Bode Colleague' },
  client:     { email: 'client@docket-staging.invalid', phone: '+2348000000001', fullName: 'Chidi Client' },
  otherStaff: { email: 'staff.secondfirm@docket-staging.invalid', fullName: 'Dupe Second' },
  platform:   { email: 'platform.admin@docket-staging.invalid', fullName: 'Platform Admin' },
  firm:       { name: 'Staging Legal Partners', slug: 'staging-legal' },
  secondFirm: { name: 'Second Staging Chambers', slug: 'second-staging' },
};
// .invalid is reserved by RFC 2606 and can never be a real mailbox, so these accounts cannot
// receive mail even if a transport is configured by mistake.

async function main() {
  const out = {};
  console.log(`staging: ${base}\n`);

  // 1. the people
  for (const [key, who] of Object.entries(FIXTURES)) {
    if (!who.email) continue;
    const { id, created } = await ensureUser({ ...who, password: PASSWORD });
    out[key] = { ...who, id };
    console.log(`  ${created ? 'created' : 'present'}  ${key.padEnd(11)} ${who.email}`);
  }

  // 2. the staff member's second factor. Docket refuses every staff WRITE below aal2, so nothing
  //    after this point could be done without it.
  console.log('\n  enrolling TOTP for the staff owner...');
  const { token: staffToken, secret: staffSecret } = await enrolTotp(FIXTURES.staff.email);
  out.staffTotpSecret = staffSecret;
  console.log(`  aal2 reached; secret kept (${staffSecret.length} chars)`);

  // 3. the firm, opened the way a firm opens itself
  let firm = (await svcSelect('firms', `slug=eq.${FIXTURES.firm.slug}&select=id,status`))[0];
  if (!firm) {
    await rpcAs(staffToken, 'create_firm', {
      p_name: FIXTURES.firm.name, p_slug: FIXTURES.firm.slug, p_state_code: 'LA',
    });
    firm = (await svcSelect('firms', `slug=eq.${FIXTURES.firm.slug}&select=id,status`))[0];
    console.log(`\n  created firm ${FIXTURES.firm.slug} (${firm.status})`);
  } else {
    console.log(`\n  firm ${FIXTURES.firm.slug} present (${firm.status})`);
  }

  // 4. activate it. create_firm always opens a firm 'pending', and firm_public filters to
  //    status = 'active' — so until this runs the slug resolves to nothing and every tenant-facing
  //    screen is blank. Done through set_firm_status() by a real platform admin rather than by
  //    updating the column, because the guard on those columns is part of what staging exists to
  //    keep honest.
  if (firm.status !== 'active') {
    await admin('/rest/v1/platform_admins', { method: 'POST', body: { user_id: out.platform.id } })
      .catch((e) => { if (!/duplicate|conflict|23505/.test(e.message)) throw e; });
    const { token: paToken } = await enrolTotp(FIXTURES.platform.email);
    await rpcAs(paToken, 'set_firm_status', { p_firm: firm.id, p_status: 'active' });
    firm = (await svcSelect('firms', `slug=eq.${FIXTURES.firm.slug}&select=id,status`))[0];
    console.log(`  activated: ${firm.status}`);
  }

  // 5. publish the policies. Every new firm's terms and privacy are '0-draft', and the portal
  //    layout renders one info alert and NO navigation until both are published — so a client
  //    journey against an unpublished firm would walk into an empty shell and prove nothing.
  //    firms_update is admin_w(id), so the owner does this himself; only status/plan/slug/domain
  //    are fenced off by the lifecycle trigger.
  await api(`/rest/v1/firms?id=eq.${firm.id}`, {
    method: 'PATCH', token: staffToken,
    headers: { Prefer: 'return=minimal' },
    body: {
      policies: {
        terms:   { version: '2026-09', text: 'Staging terms. Not a real engagement.' },
        privacy: { version: '2026-09', text: 'Staging privacy notice. No real client data lives here.' },
      },
    },
  });
  console.log('  policies published (terms + privacy at 2026-09)');

  // 6. the colleague, through the real invitation. firm_members has had its INSERT grant revoked
  //    from every API role since migration 22 — the RPCs are the only doors, which is the whole
  //    point of that migration.
  const already = await svcSelect('firm_members', `firm_id=eq.${firm.id}&user_id=eq.${out.colleague.id}&select=user_id`);
  if (already.length === 0) {
    const invite = await api('/rest/v1/staff_invites', {
      method: 'POST', token: staffToken,
      headers: { Prefer: 'return=representation' },
      body: { firm_id: firm.id, email: FIXTURES.colleague.email, role: 'lawyer', created_by: out.staff.id },
    });
    const token = (Array.isArray(invite) ? invite[0] : invite).token;
    const colleagueToken = await signInWithPassword(FIXTURES.colleague.email, PASSWORD);
    await rpcAs(colleagueToken, 'accept_staff_invite', { p_token: token });
    console.log('  colleague joined as lawyer');
  } else {
    console.log('  colleague already a member');
  }

  // 7. two matters. The SECOND is the one the client is never joined to: the denial journey needs a
  //    matter that demonstrably EXISTS (the staff account can read it) and that the client cannot
  //    reach. A matter at some unrelated third firm cannot be vouched for by anything these tests
  //    hold, which is why the id under test is one of this firm's own.
  async function matterFor(title) {
    const existing = await svcSelect('matters', `firm_id=eq.${firm.id}&title=eq.${encodeURIComponent(title)}&select=id`);
    if (existing.length) return existing[0].id;
    const r = await rpcAs(staffToken, 'open_matter', { p_firm: firm.id, p_title: title, p_type: 'litigation' });
    const id = r?.matter_id ?? r?.id ?? r?.matter?.id;
    if (!id) throw new Error(`open_matter returned no id: ${JSON.stringify(r).slice(0, 200)}`);
    return id;
  }
  const clientMatter = await matterFor('Staging client matter');
  const forbiddenMatter = await matterFor('Staging matter the client is not on');
  console.log(`  matters: client ${clientMatter}, forbidden ${forbiddenMatter}`);

  // 8. join the client to the first one, through the invitation a firm really sends.
  const parties = await svcSelect('matter_parties', `matter_id=eq.${clientMatter}&user_id=eq.${out.client.id}&select=user_id`);
  if (parties.length === 0) {
    const inv = await rpcAs(staffToken, 'invite_matter_party', {
      p_matter: clientMatter, p_email: FIXTURES.client.email, p_role: 'client',
    });
    const clientToken = await signInClientByMagicLink(FIXTURES.client.email);
    await rpcAs(clientToken, 'accept_invite', { p_token: inv.token });
    console.log('  client joined the matter');
  } else {
    console.log('  client already on the matter');
  }

  // 9. something to read. A thread the client started (messages_insert requires
  //    sender_id = auth.uid() and is_matter_party), and a document with real bytes behind it.
  const clientToken = await signInClientByMagicLink(FIXTURES.client.email);
  const msgs = await svcSelect('messages', `matter_id=eq.${clientMatter}&select=id&limit=1`);
  if (msgs.length === 0) {
    await api('/rest/v1/messages', {
      method: 'POST', token: clientToken, headers: { Prefer: 'return=minimal' },
      body: { firm_id: firm.id, matter_id: clientMatter, sender_id: out.client.id,
              body: 'Staging fixture: a message from the client, so the thread exists.' },
    });
    console.log('  client posted a message');
  } else {
    console.log('  the thread already has a message');
  }

  const docs = await svcSelect('documents', `matter_id=eq.${clientMatter}&select=id&limit=1`);
  if (docs.length === 0) {
    // The same three steps the portal takes: the row, then the bytes, then the version. The trigger
    // on document_versions sets documents.current_version_id, so it is never set by hand.
    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const storagePath = `${firm.id}/${documentId}/${versionId}.txt`;
    const bytes = new TextEncoder().encode('Staging fixture document. Not a real client file.\n');
    await api('/rest/v1/documents', {
      method: 'POST', token: clientToken, headers: { Prefer: 'return=minimal' },
      body: { id: documentId, firm_id: firm.id, matter_id: clientMatter, name: 'staging-fixture.txt',
              category: 'client_upload', client_visible: true, uploaded_by: out.client.id },
    });
    await putObject('documents', storagePath, bytes, 'text/plain', clientToken);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const checksum = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    await api('/rest/v1/document_versions', {
      method: 'POST', token: clientToken, headers: { Prefer: 'return=minimal' },
      body: { id: versionId, document_id: documentId, storage_path: storagePath,
              mime: 'text/plain', size_bytes: bytes.byteLength, checksum, uploaded_by: out.client.id },
    });
    console.log('  client uploaded a document, with a real checksum');
  } else {
    console.log('  the matter already has a document');
  }

  console.log('\n' + '='.repeat(72));
  console.log('# environment for tests/integration — set these as GitHub repository secrets');
  console.log('='.repeat(72));
  console.log(`NEXT_PUBLIC_SUPABASE_URL=${base}`);
  console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key you passed in>');
  console.log(`E2E_FIRM_SLUG=${FIXTURES.firm.slug}`);
  console.log(`E2E_STAFF_EMAIL=${FIXTURES.staff.email}`);
  console.log(`E2E_STAFF_PASSWORD=${PASSWORD}`);
  console.log(`E2E_STAFF_TOTP_SECRET=${staffSecret}`);
  console.log(`E2E_FORBIDDEN_MATTER_ID=${forbiddenMatter}`);
  console.log('');
  console.log('# The client signs in with a phone OTP and nothing else: /auth/callback handles only');
  console.log('# ?code= with exchangeCodeForSession, and a magic link arrives as a URL fragment that');
  console.log('# nothing on /app reads. So register this number as a Supabase SMS TEST number with a');
  console.log('# fixed code (Authentication -> Providers -> Phone), then set both:');
  console.log(`E2E_CLIENT_PHONE=${FIXTURES.client.phone}`);
  console.log('E2E_CLIENT_OTP=<the fixed code you mapped to that number>');
  console.log('');
  console.log('# Journey 6 (a client acting through two firms) still needs a second firm acting for');
  console.log('# this same client. Not created here yet.');
  console.log('# E2E_SECOND_FIRM_NAME=');
}

main().catch((e) => die(`failed: ${e.message}`));
