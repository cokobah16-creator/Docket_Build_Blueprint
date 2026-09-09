// Shared plumbing for Docket Edge Functions: PostgREST access under the
// service role. The service role is used HERE and nowhere else — never in
// the Next.js app (blueprint §6).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function serviceHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Call a database function (RPC) as the service role. */
export async function rpc<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`rpc ${fn} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/** Read rows as the service role. `query` is a PostgREST query string. */
export async function select<T = unknown>(
  table: string,
  query: string,
): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: serviceHeaders(),
  });
  if (!res.ok) {
    throw new Error(`select ${table} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T[];
}

/** Insert a row as the service role. */
export async function insert(
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`insert ${table} failed: ${res.status} ${await res.text()}`);
  }
}

/** Update rows as the service role. `filter` is a PostgREST filter string. */
export async function update(
  table: string,
  filter: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`update ${table} failed: ${res.status} ${await res.text()}`);
  }
}

/** Record every webhook delivery for the platform-admin health screen. */
export async function logWebhookEvent(row: {
  provider: string;
  event_type?: string;
  provider_ref?: string;
  status: "received" | "processed" | "ignored" | "failed";
  error?: string;
  payload?: unknown;
}): Promise<void> {
  try {
    await insert("webhook_events", { ...row, payload: row.payload ?? {} });
  } catch (err) {
    // Never let bookkeeping break webhook handling.
    console.error("webhook_events log failed:", err);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacHex(
  algorithm: "SHA-512" | "SHA-256",
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
  );
}
