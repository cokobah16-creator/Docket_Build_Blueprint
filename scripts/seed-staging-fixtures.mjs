#!/usr/bin/env node
// Provision the accounts and rows the authenticated journeys need, on a STAGING project.
//
// STATUS: run end to end against staging (wtfxbmrrpwdbyrspeeka) on 14–17 Sep 2026, several times,
// and idempotent on every re-run. Every step is written against the real policies and RPCs — the
// signatures were read out of supabase/migrations and docs/RPC_REFERENCE.md — and the first runs
// found and fixed five things a read-through had not: an orphan document with no version, a
// storage upsert the bucket's policies refuse, a TOTP factor that could not be re-enrolled, a
// placeholder PDF the bucket's MIME allow-list rejected, and a client who had never accepted any
// firm's terms and so saw the consent gate instead of every page the journeys open.
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

/**
 * Storage wants raw bytes and a real content type, not JSON.
 *
 * NO x-upsert, and that is load-bearing rather than a simplification. With the header, the
 * documents bucket refuses the write outright — 403, "new row violates row-level security policy" —
 * because an upsert engages the UPDATE path and storage.objects carries INSERT and SELECT policies
 * for that bucket and no UPDATE policy at all. Measured on staging, four runs: identical token,
 * document and path, 200 without the header and 403 with it, every time.
 *
 * Dropping it is also the correct behaviour and not merely the working one. Every object here is
 * named with a freshly generated version id, so there is nothing to overwrite; document versions
 * are append-only, and bytes silently replacing the bytes somebody already checksummed is the one
 * thing this model must never do. A collision would mean a duplicate UUID, and that should raise.
 */
async function putObject(bucket, path, bytes, contentType, token) {
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload ${bucket}/${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

/**
 * A genuinely valid one-page PDF.
 *
 * The documents bucket accepts application/pdf, DOCX, JPEG, PNG and HEIC and nothing else
 * (migration 4), so the .txt this script used to upload was refused 415 invalid_mime_type — which
 * is how the first real run of this file found out. It is built rather than embedded, and it is a
 * real PDF rather than a file named .pdf: the content stream is uncompressed and carries a text
 * layer, so extract-text can read words out of it and looksLikeProse() accepts them. The fixture is
 * then worth something to the extraction path as well as to the upload journey.
 *
 * ASCII only, deliberately: the xref offsets below are string lengths, and a multi-byte character
 * would make every one of them wrong by a byte a reader cannot see.
 */
function minimalPdf(line) {
  if (!/^[\x20-\x7e]*$/.test(line)) throw new Error('minimalPdf: ASCII only, or the xref offsets lie');
  const content = `BT /F1 12 Tf 72 770 Td (${line.replace(/([\\()])/g, '\\$1')}) Tj ET\n`;
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${content.length}>>\nstream\n${content}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) pdf += `${String(at).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const admin = (path, opts = {}) =>
  api(path, { ...opts, token: SERVICE, headers: { ...(opts.headers ?? {}), apikey: SERVICE } });

/** PostgREST as the service role. Used for the reads this script needs to be idempotent, and
 *  for one delete: clearing a half-made document left by a run that failed between the row and
 *  the bytes. Nothing else here goes round the policies. */
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

/**
 * Enrol TOTP and reach aal2. Returns { token, secret } — the secret is what the journeys need.
 *
 * ANY FACTOR ALREADY ON THE ACCOUNT IS REMOVED FIRST, and that is the whole point rather than
 * tidiness. A TOTP secret is handed over once, at enrolment, and can never be read back; so a
 * second run that found a factor sitting there could not use it, and holding that secret is the
 * entire reason this script exists. Supabase also refuses a second factor with the same friendly
 * name (422 mfa_factor_name_conflict) — which is how the second run of this script discovered that
 * the header's promise of a safe re-run was not true here.
 *
 * Two details, both found by trying rather than by assuming:
 *   · the factors are read from /auth/v1/user; a GET of /auth/v1/factors answers 405.
 *   · the delete goes through the ADMIN endpoint, because unenrolling a verified factor from the
 *     user's own aal1 session is refused 422 insufficient_aal — "AAL2 required to unenroll verified
 *     factor" — and reaching aal2 would need the very secret that is lost. The service role is the
 *     only way out of that circle, and a staging fixture account's old factor is worth nothing.
 */
async function enrolTotp(email) {
  const token = await signInWithPassword(email, PASSWORD);
  const user = await api('/auth/v1/user', { token });
  for (const stale of (user?.factors ?? []).filter((f) => f.factor_type === 'totp')) {
    await admin(`/auth/v1/admin/users/${user.id}/factors/${stale.id}`, { method: 'DELETE' });
    console.log(`  removed an earlier TOTP factor on ${email}; nobody could read its secret back`);
  }
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

/**
 * A client accepts a firm's terms and privacy notice on first visit, or sees nothing else: the
 * portal layout (app/app/(portal)/layout.tsx) looks for a consent_records row for the firm's
 * CURRENT terms version and another for its privacy version, and renders the consent gate in
 * place of every content page until both exist. The first run of the journeys proved it — all
 * four content journeys failed on the gate, because the fixture had built the matter, the message
 * and the document and never accepted anything.
 *
 * This writes the same two rows recordConsent (app/app/(portal)/actions.ts) writes, as the
 * client, through the same policy (consent_records_insert: user_id = auth.uid()). The service role
 * only READS here, to make the step idempotent. It refuses a '0-' version, because that is the
 * draft marker every new firm starts with and consenting to an unpublished policy is not a thing
 * a real client can do.
 */
async function acceptPolicies(clientToken, clientId, firmId, label) {
  const [firmRow] = await svcSelect('firms', `id=eq.${firmId}&select=policies`);
  const versions = { terms: firmRow?.policies?.terms?.version, privacy: firmRow?.policies?.privacy?.version };
  for (const [kind, version] of Object.entries(versions)) {
    if (!version || version.startsWith('0-')) {
      throw new Error(`${label}: ${kind} is not published (version ${JSON.stringify(version)}); publish it before the client can accept it`);
    }
  }
  const have = await svcSelect('consent_records',
    `user_id=eq.${clientId}&firm_id=eq.${firmId}&select=kind,version`);
  const accepted = [];
  for (const [kind, version] of Object.entries(versions)) {
    if (have.some((c) => c.kind === kind && c.version === version)) continue;
    await api('/rest/v1/consent_records', {
      method: 'POST', token: clientToken, headers: { Prefer: 'return=minimal' },
      body: { user_id: clientId, firm_id: firmId, kind, version },
    });
    accepted.push(`${kind} ${version}`);
  }
  console.log(accepted.length
    ? `  client accepted ${label}'s ${accepted.join(' and ')}`
    : `  client had already accepted ${label}'s current terms and privacy notice`);
}

// ---------------------------------------------------------------- the fixtures
const FIXTURES = {
  staff:      { email: 'staff.owner@docket-staging.invalid',   fullName: 'Ada Owner' },
  colleague:  { email: 'staff.colleague@docket-staging.invalid', fullName: 'Bode Colleague' },
  // The phone is overridable and its default is a placeholder, deliberately on both counts.
  // The client signs in by SMS OTP, so this number must be the one registered as a Supabase TEST
  // number (Authentication -> Providers -> Phone) — otherwise redeeming the fixed code mints a
  // BRAND NEW user with no matter, no message and no document, and the journeys fail looking like
  // a product fault rather than a mismatched fixture. Measured on 16 Sep 2026: exactly that.
  // It is not hardcoded to the real number because this file is committed and a working test
  // number is somebody's actual mobile. Pass FIXTURE_CLIENT_PHONE to match your dashboard.
  client:     { email: 'client@docket-staging.invalid', phone: process.env.FIXTURE_CLIENT_PHONE ?? '+2348000000001', fullName: 'Chidi Client' },
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
    // open_matter returns jsonb_build_object('matter_id', …, 'reference', …, 'tasks_created', …)
    // — supabase/migrations/20260910000039_workflow_packs.sql. Read the one key it documents and
    // fail loudly on anything else: a fallback chain would quietly pick up some other field the day
    // that shape changed, and the fixture would build the wrong thing without saying so.
    if (!r?.matter_id) throw new Error(`open_matter returned no matter_id: ${JSON.stringify(r).slice(0, 200)}`);
    return r.matter_id;
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
    // invite_matter_party returns 'token' among others — 20260910000018_staff_console.sql.
    if (!inv?.token) throw new Error(`invite_matter_party returned no token: ${JSON.stringify(inv).slice(0, 200)}`);
    const clientToken = await signInClientByMagicLink(FIXTURES.client.email);
    await rpcAs(clientToken, 'accept_invite', { p_token: inv.token });
    console.log('  client joined the matter');
  } else {
    console.log('  client already on the matter');
  }

  // 9. something to read. A thread the client started (messages_insert requires
  //    sender_id = auth.uid() and is_matter_party), and a document with real bytes behind it.
  const clientToken = await signInClientByMagicLink(FIXTURES.client.email);
  await acceptPolicies(clientToken, out.client.id, firm.id, FIXTURES.firm.slug);
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

  // A document row is written BEFORE its bytes, so "a document exists" is not "a document is
  // finished" — the first run of this script left one with no version when the upload was refused
  // 415. Left in place it would satisfy an "already has a document" check for ever and the fixture
  // would never complete, so a half-made one is cleared rather than counted.
  const halfMade = await svcSelect('documents', `matter_id=eq.${clientMatter}&current_version_id=is.null&select=id`);
  for (const stale of halfMade) {
    await admin(`/rest/v1/documents?id=eq.${stale.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    console.log('  cleared a half-made document left by an earlier run');
  }

  const docs = await svcSelect('documents', `matter_id=eq.${clientMatter}&current_version_id=not.is.null&select=id&limit=1`);
  if (docs.length === 0) {
    // The same three steps the portal takes: the row, then the bytes, then the version. The trigger
    // on document_versions sets documents.current_version_id, so it is never set by hand.
    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const storagePath = `${firm.id}/${documentId}/${versionId}.pdf`;
    const bytes = minimalPdf('Staging fixture document. Not a real client file.');
    await api('/rest/v1/documents', {
      method: 'POST', token: clientToken, headers: { Prefer: 'return=minimal' },
      body: { id: documentId, firm_id: firm.id, matter_id: clientMatter, name: 'staging-fixture.pdf',
              category: 'client_upload', client_visible: true, uploaded_by: out.client.id },
    });
    await putObject('documents', storagePath, bytes, 'application/pdf', clientToken);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const checksum = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    await api('/rest/v1/document_versions', {
      method: 'POST', token: clientToken, headers: { Prefer: 'return=minimal' },
      body: { id: versionId, document_id: documentId, storage_path: storagePath,
              mime: 'application/pdf', size_bytes: bytes.byteLength, checksum, uploaded_by: out.client.id },
    });
    console.log('  client uploaded a document, with a real checksum');
  } else {
    console.log('  the matter already has a document');
  }

  // 10. a SECOND firm acting for the same client, for the firm-switching journey. Built exactly as
  //     the first was — its own owner, its own second factor, opened and activated through the same
  //     RPCs — because "a client several firms act for" is only a real fixture if the second firm is
  //     as real as the first. This is also the shape that catches tenant bleed: the same person
  //     holds matters at two firms and must see each firm's only when they are in it.
  let firm2 = (await svcSelect('firms', `slug=eq.${FIXTURES.secondFirm.slug}&select=id,status`))[0];
  const { token: otherToken, secret: otherSecret } = await enrolTotp(FIXTURES.otherStaff.email);
  if (!firm2) {
    await rpcAs(otherToken, 'create_firm', {
      p_name: FIXTURES.secondFirm.name, p_slug: FIXTURES.secondFirm.slug, p_state_code: 'LA',
    });
    firm2 = (await svcSelect('firms', `slug=eq.${FIXTURES.secondFirm.slug}&select=id,status`))[0];
  }
  if (firm2.status !== 'active') {
    const { token: paToken2 } = await enrolTotp(FIXTURES.platform.email);
    await rpcAs(paToken2, 'set_firm_status', { p_firm: firm2.id, p_status: 'active' });
    firm2 = (await svcSelect('firms', `slug=eq.${FIXTURES.secondFirm.slug}&select=id,status`))[0];
  }
  await api(`/rest/v1/firms?id=eq.${firm2.id}`, {
    method: 'PATCH', token: otherToken, headers: { Prefer: 'return=minimal' },
    body: { policies: {
      terms:   { version: '2026-09', text: 'Staging terms, second firm.' },
      privacy: { version: '2026-09', text: 'Staging privacy notice, second firm.' },
    } },
  });

  const second = await svcSelect('matters', `firm_id=eq.${firm2.id}&select=id&limit=1`);
  let secondMatter = second[0]?.id;
  if (!secondMatter) {
    const r = await rpcAs(otherToken, 'open_matter', {
      p_firm: firm2.id, p_title: 'Staging matter at the second firm', p_type: 'advisory',
    });
    if (!r?.matter_id) throw new Error(`open_matter (second firm) returned no matter_id: ${JSON.stringify(r).slice(0, 200)}`);
    secondMatter = r.matter_id;
  }
  const p2 = await svcSelect('matter_parties', `matter_id=eq.${secondMatter}&user_id=eq.${out.client.id}&select=user_id`);
  if (p2.length === 0) {
    const inv2 = await rpcAs(otherToken, 'invite_matter_party', {
      p_matter: secondMatter, p_email: FIXTURES.client.email, p_role: 'client',
    });
    if (!inv2?.token) throw new Error('invite_matter_party (second firm) returned no token');
    const ct = await signInClientByMagicLink(FIXTURES.client.email);
    await rpcAs(ct, 'accept_invite', { p_token: inv2.token });
  }
  await acceptPolicies(await signInClientByMagicLink(FIXTURES.client.email), out.client.id, firm2.id, FIXTURES.secondFirm.slug);
  console.log(`  second firm ${FIXTURES.secondFirm.slug} (${firm2.status}), same client on a matter there`);

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
  console.log('# This number must be registered as a Supabase TEST number with the fixed code below,');
  console.log('# and it must be THIS account\'s number: an OTP signs in whoever owns it, so a mismatch');
  console.log('# yields a valid session for a stranger with none of the fixture data. Override the');
  console.log('# default with FIXTURE_CLIENT_PHONE.');
  console.log('# The client signs in with a phone OTP and nothing else: /auth/callback handles only');
  console.log('# ?code= with exchangeCodeForSession, and a magic link arrives as a URL fragment that');
  console.log('# nothing on /app reads. So register this number as a Supabase SMS TEST number with a');
  console.log('# fixed code (Authentication -> Providers -> Phone), then set both:');
  console.log(`E2E_CLIENT_PHONE=${FIXTURES.client.phone}`);
  console.log('E2E_CLIENT_OTP=<the fixed code you mapped to that number>');
  console.log('');
  console.log(`E2E_SECOND_FIRM_NAME=${FIXTURES.secondFirm.name}`);
}

main().catch((e) => die(`failed: ${e.message}`));
