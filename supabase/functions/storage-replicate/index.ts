// Supabase Edge Function — the second copy. pg_cron calls it every fifteen minutes with the
// x-cron-secret header (migration 50).
//
// Migration 28's manifest answers "do the bytes exist?". This answers the question after it: "is
// there a copy of them anywhere a compromise of this Supabase project cannot reach?" It takes a
// bounded batch of objects the manifest has verified, downloads each one, and PUTs it to an
// S3-compatible store — Cloudflare R2 — recording one row per object in storage_replicas.
//
// The service role is used here and nowhere outside Edge Functions; it reads the two buckets and
// writes storage_replicas, which no API role can touch.
//
// HOW A COPY IS PROVED TO HAVE LANDED. Not by trusting a 200. The upload carries
// x-amz-checksum-sha256, so the destination recomputes the digest itself and REFUSES the request if
// the bytes it received differ from the bytes we hashed. A 2xx that also echoes the checksum back
// is therefore the destination's own statement that it holds these exact bytes, and only that is
// recorded as 'ok'.
//
// The obvious alternative — compare the returned ETag, which for a single-part PUT is the MD5 —
// is not available: Deno's crypto.subtle implements SHA-1, SHA-256, SHA-384 and SHA-512 and NOT
// MD5, and hand-rolling MD5 to check a checksum would be a worse idea than not checking one. So
// where a destination answers 2xx WITHOUT confirming the digest, the row is written 'unconfirmed'
// rather than 'ok'. That distinction is the point: `unreplicated` counts everything that is not
// 'ok', so an unconfirmed copy is not allowed to look like coverage.
//
// WHAT IT DOES NOT DO. Restore. Reading the copy back is a runbook procedure that a person performs
// once a drill is called for, not a job that runs unattended against a store it can also write.
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Bounded exactly as the manifest is, and for the same reason: a firm with a large library is
// covered over hours rather than in one call that times out having copied nothing.
const MAX_OBJECTS = 25;
const MAX_BYTES = 100 * 1024 * 1024;

// R2 speaks the S3 API. "auto" is the region R2 expects in a SigV4 credential scope.
const R2_REGION = 'auto';
const R2_SERVICE = 's3';

type ManifestRow = { bucket: string; path: string; sha256: string | null; size_bytes: number | null };
type ReplicaRow = { bucket: string; path: string; sha256: string | null; status: string; replicated_at: string };

// ---------------------------------------------------------------- digests
async function sha256Bytes(data: ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf as BufferSource));
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

async function hmac(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const raw = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const k = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
}

/** Walks both strings whole, so the time taken says nothing about where they differ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** As the other functions: both sides hashed first, so not even the length leaks. */
async function cronSecretMatches(given: string | null, expected: string): Promise<boolean> {
  if (!given) return false;
  return timingSafeEqual(hex(await sha256Bytes(given)), hex(await sha256Bytes(expected)));
}

// ---------------------------------------------------------------- AWS SigV4, the part R2 needs
// Only what a single PUT requires. Written out rather than pulled in: an Edge Function that reaches
// for an SDK to sign one request is an Edge Function with a supply chain.
function amzDate(now: Date): { stamp: string; date: string } {
  const s = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20260913T201500Z
  return { stamp: s, date: s.slice(0, 8) };
}

/** Each path segment is escaped, but the separators are not: S3 signs the path, slashes and all. */
function encodeKey(key: string): string {
  return key.split('/').map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/');
}

async function signedPut(opts: {
  accountId: string; bucket: string; key: string; body: Uint8Array;
  accessKeyId: string; secretAccessKey: string; contentType: string; sha256Hex: string; sha256B64: string;
}): Promise<Response> {
  const host = `${opts.accountId}.r2.cloudflarestorage.com`;
  const path = `/${opts.bucket}/${encodeKey(opts.key)}`;
  const { stamp, date } = amzDate(new Date());

  // The destination recomputes this and refuses the write if the bytes differ. It is what makes a
  // 2xx mean something.
  const headers: Record<string, string> = {
    host,
    'content-type': opts.contentType,
    'x-amz-checksum-sha256': opts.sha256B64,
    'x-amz-content-sha256': opts.sha256Hex,
    'x-amz-date': stamp,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join('');
  const canonicalRequest = ['PUT', path, '', canonicalHeaders, signedHeaders, opts.sha256Hex].join('\n');

  const scope = `${date}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, hex(await sha256Bytes(canonicalRequest))].join('\n');

  let key = await hmac(`AWS4${opts.secretAccessKey}`, date);
  key = await hmac(key, R2_REGION);
  key = await hmac(key, R2_SERVICE);
  key = await hmac(key, 'aws4_request');
  const signature = hex(await hmac(key, stringToSign));

  return await fetch(`https://${host}${path}`, {
    method: 'PUT',
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: opts.body as BodyInit,
  });
}

// ---------------------------------------------------------------- the run
Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || !(await cronSecretMatches(req.headers.get('x-cron-secret'), secret))) {
    return new Response('forbidden', { status: 403 });
  }

  const accountId = Deno.env.get('R2_ACCOUNT_ID');
  const bucket = Deno.env.get('R2_BUCKET');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    // Not an error: the migration is applied before the bucket exists, and this says so plainly
    // rather than writing rows that would make the health screen look busy.
    return new Response(
      JSON.stringify({ configured: false, detail: 'set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // The inventory of what exists is the manifest, not a listing: a listing is a table read and
  // proves nothing about bytes. Only rows the manifest has actually downloaded and hashed.
  const { data: manifestRows, error: manifestError } = await supabase
    .from('storage_manifest')
    .select('bucket, path, sha256, size_bytes')
    .eq('status', 'ok')
    .limit(20000);
  if (manifestError) return new Response(JSON.stringify({ error: manifestError.message }), { status: 500 });
  const manifest = (manifestRows ?? []) as ManifestRow[];

  const { data: replicaRows, error: replicaError } = await supabase
    .from('storage_replicas')
    .select('bucket, path, sha256, status, replicated_at')
    .limit(20000);
  if (replicaError) return new Response(JSON.stringify({ error: replicaError.message }), { status: 500 });
  const replicas = (replicaRows ?? []) as ReplicaRow[];

  const k = (b: string, p: string) => `${b} ${p}`;
  const have = new Map(replicas.map((r) => [k(r.bucket, r.path), r]));

  // Needs copying: never copied, copied and not confirmed good, or copied before the source
  // changed. Never-copied first, then whatever was copied longest ago.
  const candidates = manifest
    .filter((m) => {
      const r = have.get(k(m.bucket, m.path));
      return !r || r.status !== 'ok' || r.sha256 !== m.sha256;
    })
    .sort((a, b) => {
      const ra = have.get(k(a.bucket, a.path))?.replicated_at ?? '';
      const rb = have.get(k(b.bucket, b.path))?.replicated_at ?? '';
      return ra.localeCompare(rb);
    });

  let attempted = 0, bytes = 0, ok = 0, unconfirmed = 0, mismatch = 0, failed = 0;
  for (const m of candidates) {
    if (attempted >= MAX_OBJECTS || bytes >= MAX_BYTES) break;
    const row: Record<string, unknown> = {
      bucket: m.bucket, path: m.path, replicated_at: new Date().toISOString(),
      sha256: null, size_bytes: null, replica_etag: null, error: null,
    };
    try {
      const { data: blob, error } = await supabase.storage.from(m.bucket).download(m.path);
      if (error || !blob) {
        // The manifest said these bytes were there. If they are not, that is the manifest's news
        // to report, not ours to overwrite — record the failure and move on.
        Object.assign(row, { status: 'error', error: (error?.message ?? 'no body').slice(0, 500) });
        failed += 1;
      } else {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const digest = await sha256Bytes(buf);
        const dHex = hex(digest);

        // The bytes changed between the manifest hashing them and this download. Copying them is
        // still right — they are the current bytes — but the row records what was actually sent.
        const res = await signedPut({
          accountId, bucket, key: `${m.bucket}/${m.path}`, body: buf,
          accessKeyId, secretAccessKey,
          contentType: blob.type || 'application/octet-stream',
          sha256Hex: dHex, sha256B64: b64(digest),
        });

        const etag = res.headers.get('etag');
        const echoed = res.headers.get('x-amz-checksum-sha256');
        if (!res.ok) {
          const text = (await res.text()).slice(0, 400);
          Object.assign(row, { status: 'error', error: `${res.status}: ${text}`, size_bytes: buf.byteLength });
          failed += 1;
        } else if (echoed && !timingSafeEqual(echoed, b64(digest))) {
          // The destination confirmed a digest, and it is not ours.
          Object.assign(row, { status: 'mismatch', sha256: dHex, size_bytes: buf.byteLength, replica_etag: etag,
                               error: `destination reported ${echoed}` });
          mismatch += 1;
        } else if (!echoed) {
          Object.assign(row, { status: 'unconfirmed', sha256: dHex, size_bytes: buf.byteLength, replica_etag: etag,
                               error: 'stored, but the destination did not confirm the sha256' });
          unconfirmed += 1;
        } else {
          Object.assign(row, { status: 'ok', sha256: dHex, size_bytes: buf.byteLength, replica_etag: etag });
          ok += 1;
        }
        bytes += buf.byteLength;
      }
    } catch (e) {
      Object.assign(row, { status: 'error', error: String((e as Error)?.message ?? e).slice(0, 500) });
      failed += 1;
    }
    await supabase.from('storage_replicas').upsert(row, { onConflict: 'bucket,path' });
    attempted += 1;
  }

  return new Response(
    JSON.stringify({ configured: true, inventory: manifest.length, candidates: candidates.length, attempted, ok, unconfirmed, mismatch, failed, bytes }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
