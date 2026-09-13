// Docket's partner API, v1. Read only.
//
// This function is a pipe and nothing more. It reads the Authorization header, hands the key to a
// database function, and returns what comes back. It never names a firm, never builds a query, and
// holds no rule of its own: api_authorize() decides whether the key is live, whether it carries the
// scope, and which firm it speaks for, and every v1 function calls it before reading a row. Rewrite
// this file badly and the worst outcome is a broken route — not a wider answer.
//
// It runs here rather than in the Next app because serving it needs the service role, and the
// service role belongs in supabase/functions and nowhere else in this codebase.
//
// WHAT IT IS NOT. There is no sandbox: a sandbox is a second environment with its own data, Docket
// has no staging project yet, and something called a sandbox that is really production with a
// different key would be worse than none. There are no writes in v1. Both are said in the OpenAPI
// document too, so a partner reads it before building rather than after.

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

/** The contract's version, in the path. A breaking change becomes /v2 beside /v1, never a change to it. */
const VERSION = 'v1';

interface Route {
  /** The path after /v1, exactly. */
  path: string;
  rpc: string;
  /** Query parameters this route passes through, and how to read them. */
  params: (url: URL) => Record<string, unknown>;
}

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** An ISO instant, or null. A malformed `since` is refused rather than silently ignored. */
function sinceParam(url: URL): string | null | undefined {
  const raw = url.searchParams.get('since');
  if (raw === null) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

const ROUTES: Route[] = [
  { path: 'matters',  rpc: 'api_v1_matters',  params: (u) => ({ p_since: sinceParam(u), p_limit: intParam(u, 'limit', 100) }) },
  { path: 'invoices', rpc: 'api_v1_invoices', params: (u) => ({ p_since: sinceParam(u), p_limit: intParam(u, 'limit', 100) }) },
  { path: 'clients',  rpc: 'api_v1_clients',  params: (u) => ({ p_limit: intParam(u, 'limit', 100) }) },
  { path: 'events',   rpc: 'api_v1_events',   params: (u) => ({ p_after: intParam(u, 'after', 0), p_limit: intParam(u, 'limit', 100) }) },
];

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

/** One shape for every refusal, so a partner can handle them without reading prose. */
function problem(status: number, code: string, detail: string): Response {
  return json({ error: { code, detail } }, status);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  // Supabase serves this at /functions/v1/partner-api/... — the contract's own version follows.
  const after = url.pathname.split('/partner-api/')[1] ?? '';
  const parts = after.split('/').filter(Boolean);

  if (req.method !== 'GET') {
    return problem(405, 'method_not_allowed', 'v1 of this API is read only. Only GET is served.');
  }
  if (parts.length === 0) {
    return json({
      version: VERSION,
      read_only: true,
      sandbox: false,
      resources: ROUTES.map((r) => `/${VERSION}/${r.path}`),
      documentation: 'https://github.com/cokobah16-creator/Docket_Build_Blueprint/blob/main/docs/PARTNER_API.md',
    });
  }
  if (parts[0] !== VERSION) {
    return problem(404, 'unknown_version', `This API serves ${VERSION}. Ask for /${VERSION}/…`);
  }
  const route = ROUTES.find((r) => r.path === parts[1]);
  if (!route || parts.length > 2) {
    return problem(404, 'unknown_resource', `No such resource. v1 serves: ${ROUTES.map((r) => r.path).join(', ')}.`);
  }

  const auth = req.headers.get('authorization') ?? '';
  const key = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!key) {
    return problem(401, 'unauthorized', 'Send your key as: Authorization: Bearer dk_live_…');
  }

  const params = route.params(url);
  if (Object.values(params).some((v) => v === undefined)) {
    return problem(400, 'bad_request', '`since` must be an ISO 8601 instant, for example 2026-09-01T00:00:00Z.');
  }

  const { data, error } = await supabase.rpc(route.rpc, { p_key: key, ...params });
  if (error) {
    // The database's own refusals, mapped to their HTTP shapes. 42501 is every key failure —
    // unknown, revoked, expired, wrong scope — and deliberately says nothing about which.
    if (error.code === '42501') {
      const scope = error.message.includes('scope');
      return problem(403, scope ? 'insufficient_scope' : 'unauthorized', error.message);
    }
    if (error.code === '53400') {
      return problem(429, 'too_many_requests', 'Too many calls on this key. Try again shortly.', );
    }
    console.error('partner-api', route.rpc, error.code, error.message);
    return problem(500, 'internal_error', 'The request could not be served.');
  }

  const rows = (data ?? []) as unknown[];
  return json({ version: VERSION, count: Array.isArray(rows) ? rows.length : 0, data: rows });
});
