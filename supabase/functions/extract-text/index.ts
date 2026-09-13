// Reading the words out of uploaded files, a bounded batch at a time.
//
// Called by pg_cron with the same x-cron-secret the dispatcher and the storage manifest use. It
// holds no rule: claim_document_text() decides which versions are next and record_document_text()
// decides what may be written, and both refuse any caller that has an auth.uid() at all. This
// function's whole job is to fetch the object and hand src/lib/extract.ts's answer back.
//
// WHY IT DOES NOT WRITE A DOCUMENT READ. Migration 30 requires a document_reads row before any
// bytes reach a PERSON. A machine hashing or reading a file for the firm's own index is not a
// person, the bytes do not leave, and writing a read record for it would put a receipt in the audit
// trail that names nobody — a fabricated reading. The storage manifest (migration 28) already works
// this way for the same reason.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { extractText } from '../../../src/lib/extract.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

/** A file bigger than this is not downloaded at all: the run has a memory budget and a deadline. */
const MAX_BYTES = 25 * 1024 * 1024;
/** How many objects one run will read. Small: a run that times out claims rows and finishes none. */
const BATCH = 5;

interface Claim {
  version_id: string;
  document_id: string;
  storage_path: string;
  mime: string | null;
  name: string;
  size_bytes: number | null;
}

/** documents/<firm>/<matter>/<file> — the bucket is the first segment of the stored path. */
function split(path: string): { bucket: string; key: string } {
  const at = path.indexOf('/');
  return at < 0 ? { bucket: 'documents', key: path } : { bucket: path.slice(0, at), key: path.slice(at + 1) };
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i]! ^ v[i]!;
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET') ?? '';
  const presented = req.headers.get('x-cron-secret') ?? '';
  if (!secret || !(await timingSafeEqual(secret, presented))) {
    return new Response('not found', { status: 404 });
  }

  const { data: claims, error } = await supabase.rpc('claim_document_text', { p_limit: BATCH });
  if (error) {
    console.error('extract-text claim', error.code, error.message);
    return new Response(JSON.stringify({ error: 'could not claim' }), { status: 500 });
  }

  const outcome: Record<string, number> = {};
  for (const c of (claims ?? []) as Claim[]) {
    // Each file is its own try: one unreadable object must not stop the batch, and the row it
    // belongs to must still be told what happened to it.
    let status = 'failed';
    let text: string | null = null;
    let detail: string | null = null;
    let truncated = false;
    try {
      if ((c.size_bytes ?? 0) > MAX_BYTES) {
        status = 'too_large';
        detail = `this file is ${Math.round((c.size_bytes ?? 0) / 1048576)} MB; Docket reads the words out of files up to 25 MB.`;
      } else {
        const { bucket, key } = split(c.storage_path);
        const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(key);
        if (dlErr || !blob) throw new Error(dlErr?.message ?? 'the file could not be downloaded');
        const r = await extractText(new Uint8Array(await blob.arrayBuffer()), c.mime, c.name);
        status = r.status;
        text = r.status === 'extracted' ? r.text : null;
        detail = r.detail || null;
        truncated = r.truncated;
      }
    } catch (e) {
      status = 'failed';
      detail = e instanceof Error ? e.message : 'the file could not be read';
    }

    const { error: recErr } = await supabase.rpc('record_document_text', {
      p_version: c.version_id, p_status: status, p_text: text, p_detail: detail, p_truncated: truncated,
    });
    if (recErr) console.error('extract-text record', c.version_id, recErr.code, recErr.message);
    outcome[status] = (outcome[status] ?? 0) + 1;
  }

  return new Response(JSON.stringify({ claimed: (claims ?? []).length, outcome }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
