#!/usr/bin/env node
// Provision the accounts and rows the authenticated journeys need, on a STAGING project.
//
// STATUS: INCOMPLETE, and never yet run. It creates the people, reaches aal2 with a real second
// factor, and opens the firm. It does NOT yet activate the firm, attach the colleague, invite and
// accept the client, open the matters, post a message or store a document — those steps are named
// in tests/integration/README.md and are still done by hand. Finishing them needs a project with
// the full schema to run against, which did not exist when this was written. Do not cite it as
// though staging were provisioned by it.
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

  console.log('\n' + '-'.repeat(72));
  console.log('INCOMPLETE. Still to do by hand (tests/integration/README.md): activate the firm,');
  console.log('attach the colleague, invite and accept the client, open the matters including the one');
  console.log('the client is not a party to, post a message, and store a document version.');
  console.log('-'.repeat(72) + '\n');

  console.log('# environment for tests/integration — paste into GitHub repository secrets');
  console.log(`NEXT_PUBLIC_SUPABASE_URL=${base}`);
  console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key you passed in>');
  console.log(`E2E_FIRM_SLUG=${FIXTURES.firm.slug}`);
  console.log(`E2E_STAFF_EMAIL=${FIXTURES.staff.email}`);
  console.log(`E2E_STAFF_PASSWORD=${PASSWORD}`);
  console.log(`E2E_STAFF_TOTP_SECRET=${staffSecret}`);
  console.log(`E2E_CLIENT_EMAIL=${FIXTURES.client.email}`);
}

main().catch((e) => die(`failed: ${e.message}`));
