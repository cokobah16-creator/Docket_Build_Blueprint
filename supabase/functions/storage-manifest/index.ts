// Supabase Edge Function — the storage manifest. pg_cron calls it every ten minutes with the
// x-cron-secret header (migration 28).
//
// It answers one question the database cannot: do the bytes exist? A backup restores the
// storage.objects ROWS; the object BYTES are elsewhere, and listing them is itself a table read, so
// the only proof is to fetch each object. This function takes a bounded batch of objects — never
// verified first, then verified longest ago — downloads each one, hashes it, compares the hash to
// document_versions.checksum where the row has one, and writes one storage_manifest row per
// object. Over successive runs it covers everything and then keeps every row fresh.
//
// BOUNDED ON PURPOSE. Fifty objects or a hundred megabytes per run, whichever comes first, so a
// firm with a large library is verified over hours rather than in one call that times out and
// verifies nothing. The count returned says how far it got.
//
// The service role is used here and nowhere outside Edge Functions; it reads storage.objects and
// the two buckets, and writes storage_manifest, which no API role can touch.
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const BUCKETS = ['documents', 'intake-uploads'];
const MAX_OBJECTS = 50;
const MAX_BYTES = 100 * 1024 * 1024;
const FRESH_FOR_DAYS = 7;

type ObjectRow = { bucket_id: string; name: string; metadata: { size?: number } | null };
type ManifestRow = { bucket: string; path: string; verified_at: string };

async function sha256Hex(bytes: ArrayBuffer | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Walks both strings whole, so the time taken says nothing about where they differ. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** As dispatch-notifications: both sides hashed first, so not even the length leaks. */
async function cronSecretMatches(given: string | null, expected: string): Promise<boolean> {
  if (!given) return false;
  return timingSafeEqualHex(await sha256Hex(given), await sha256Hex(expected));
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || !(await cronSecretMatches(req.headers.get('x-cron-secret'), secret))) {
    return new Response('forbidden', { status: 403 });
  }

  // What should exist: the rows. Pilot scale, so the whole list fits one read; the day it does
  // not, page it — the bound below is on the work, not on the list.
  const { data: objectRows, error: objectsError } = await supabase
    .schema('storage')
    .from('objects')
    .select('bucket_id, name, metadata')
    .in('bucket_id', BUCKETS)
    .limit(10000);
  if (objectsError) return new Response(JSON.stringify({ error: objectsError.message }), { status: 500 });
  const objects = (objectRows ?? []) as ObjectRow[];

  // What has been verified recently, and what the manifest still lists that no longer exists.
  const { data: manifestRows, error: manifestError } = await supabase
    .from('storage_manifest')
    .select('bucket, path, verified_at')
    .limit(20000);
  if (manifestError) return new Response(JSON.stringify({ error: manifestError.message }), { status: 500 });
  const manifest = (manifestRows ?? []) as ManifestRow[];
  const key = (b: string, p: string) => `${b} ${p}`;
  const present = new Set(objects.map((o) => key(o.bucket_id, o.name)));
  const verifiedAt = new Map(manifest.map((m) => [key(m.bucket, m.path), m.verified_at]));

  // A manifest row for an object the store no longer lists was deleted legitimately (a retired
  // version, a firm removed); it is not "missing", it is gone. Drop it so the counts stay honest.
  const gone = manifest.filter((m) => !present.has(key(m.bucket, m.path)));
  for (const m of gone) await supabase.from('storage_manifest').delete().match({ bucket: m.bucket, path: m.path });

  const freshBefore = Date.now() - FRESH_FOR_DAYS * 86_400_000;
  const candidates = objects
    .filter((o) => {
      const v = verifiedAt.get(key(o.bucket_id, o.name));
      return !v || new Date(v).getTime() < freshBefore;
    })
    .sort((a, b) => {
      const va = verifiedAt.get(key(a.bucket_id, a.name)) ?? '';
      const vb = verifiedAt.get(key(b.bucket_id, b.name)) ?? '';
      return va.localeCompare(vb); // never verified ('') first, then oldest
    });

  // The expected hashes, for the documents bucket, from the row of record.
  const docPaths = candidates.filter((o) => o.bucket_id === 'documents').slice(0, MAX_OBJECTS).map((o) => o.name);
  const expected = new Map<string, string>();
  if (docPaths.length) {
    const { data: versions } = await supabase.from('document_versions').select('storage_path, checksum').in('storage_path', docPaths);
    for (const v of (versions ?? []) as Array<{ storage_path: string; checksum: string | null }>) {
      if (v.checksum) expected.set(v.storage_path, v.checksum);
    }
  }

  let verified = 0, bytes = 0, ok = 0, missing = 0, mismatch = 0, failed = 0;
  for (const o of candidates) {
    if (verified >= MAX_OBJECTS || bytes >= MAX_BYTES) break;
    const row: Record<string, unknown> = { bucket: o.bucket_id, path: o.name, verified_at: new Date().toISOString() };
    try {
      const { data: blob, error } = await supabase.storage.from(o.bucket_id).download(o.name);
      if (error || !blob) {
        const text = error?.message ?? 'no body';
        const notFound = /not found|404|does not exist/i.test(text);
        Object.assign(row, { status: notFound ? 'missing' : 'error', error: text.slice(0, 500), size_bytes: null, sha256: null });
        if (notFound) missing += 1; else failed += 1;
      } else {
        const buf = await blob.arrayBuffer();
        const hash = await sha256Hex(buf);
        const want = o.bucket_id === 'documents' ? expected.get(o.name) ?? null : null;
        const isMismatch = want !== null && !timingSafeEqualHex(hash, want);
        Object.assign(row, { status: isMismatch ? 'mismatch' : 'ok', error: null, size_bytes: buf.byteLength, sha256: hash, expected_sha256: want });
        bytes += buf.byteLength;
        if (isMismatch) mismatch += 1; else ok += 1;
      }
    } catch (e) {
      Object.assign(row, { status: 'error', error: String((e as Error)?.message ?? e).slice(0, 500), size_bytes: null, sha256: null });
      failed += 1;
    }
    await supabase.from('storage_manifest').upsert(row, { onConflict: 'bucket,path' });
    verified += 1;
  }

  return new Response(
    JSON.stringify({ objects: objects.length, candidates: candidates.length, verified, ok, missing, mismatch, failed, bytes, dropped: gone.length }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
