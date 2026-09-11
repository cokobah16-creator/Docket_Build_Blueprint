// Docket — the Vercel Domains adapter behind custom-domain mapping.
//
// WHY THIS EXISTS AT ALL. Postgres cannot make an outbound HTTP request, so set_firm_domain()
// (migration 20) writes firms.custom_domain and nothing else: it has no way to ask whether the
// edge will actually answer for that hostname. Two systems therefore have to agree, and the
// order is not a preference — Vercel first, the database second. A hostname written into
// firms.custom_domain that the deployment does not serve is a firm's whole public site pointing
// at a host that never loads, and nobody finds out until a client tries to book.
//
// WHY PLAIN FETCH. The npm registry is closed to this project; every provider here (see
// src/lib/providers/video/daily.ts) is a hand-written fetch adapter, and this one follows it.
//
// WHY NOTHING THROWS. This is called from a server action that has to put the provider's own
// words on the operator's screen next to the database's own words. An exception loses the
// distinction between "the token is missing", "another Vercel project already owns this host"
// and "the API did not answer" — three problems with three different remedies. Each one comes
// back as a value the screen can read.
//
// SERVER ONLY. VERCEL_TOKEN is a deployment credential with write access to the project's
// domains. This module reads process.env directly and must never be imported by a "use client"
// file — import it from a server action or a server component only.

const API = "https://api.vercel.com";
const TIMEOUT_MS = 15_000;

/** One DNS record the firm has to add at its registrar before Vercel will serve the host. */
export interface DomainVerification {
  /** "TXT", "CNAME", "A" — as Vercel names it. */
  type: string;
  /** The record name to create. */
  domain: string;
  /** The value to put in it. */
  value: string;
  /** Vercel's own explanation of why the record is wanted, when it gives one. */
  reason?: string;
}

/** Vercel is holding this hostname for our project. */
export interface DomainOk {
  ok: true;
  host: string;
  /** True once Vercel has accepted ownership. Until then the records below are outstanding. */
  verified: boolean;
  /** What the firm must add at its registrar. Empty once verified. */
  verification: DomainVerification[];
  /**
   * True when DNS still does not point at this deployment, false when it does, and null when
   * the configuration endpoint could not be reached — an unknown is reported as an unknown
   * rather than guessed at.
   */
  misconfigured: boolean | null;
}

export type DomainFailureReason =
  /** VERCEL_TOKEN or VERCEL_PROJECT_ID is not set on this deployment. */
  | "not_configured"
  /** Vercel has no such domain on this project. */
  | "not_found"
  /** Another Vercel project or account holds the hostname. */
  | "taken"
  /** Vercel understood and said no — bad hostname, no permission, plan limit. */
  | "refused"
  /** The API did not answer, or answered with something unreadable. */
  | "unreachable";

export interface DomainFailure {
  ok: false;
  reason: DomainFailureReason;
  /** Vercel's own sentence wherever there is one, so the screen can quote it. */
  message: string;
  status?: number;
}

export type DomainResult = DomainOk | DomainFailure;

/** removed=false means Vercel was not holding the host in the first place: nothing to undo. */
export type RemoveDomainResult = { ok: true; host: string; removed: boolean } | DomainFailure;

interface VercelConfig {
  token: string;
  projectId: string;
  teamId: string | null;
}

function config(): VercelConfig | null {
  const token = process.env.VERCEL_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  if (!token || !projectId) return null;
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID?.trim() || null };
}

/**
 * Whether this deployment can talk to Vercel at all. Safe to call from a server component so a
 * screen can say what is missing instead of only finding out when somebody presses a button.
 * Returns a boolean and never the token.
 */
export function vercelConfigured(): boolean {
  return config() !== null;
}

const NOT_CONFIGURED: DomainFailure = {
  ok: false,
  reason: "not_configured",
  message:
    "VERCEL_TOKEN and VERCEL_PROJECT_ID are not set on this deployment, so Docket cannot ask " +
    "Vercel to serve a hostname. Set them, or map the domain wherever this deployment is hosted " +
    "and record it here deliberately.",
};

/** The same shape the middleware matches on: lowercase, no scheme, no port, no trailing dot. */
function normalise(host: string): string | null {
  const clean = host.trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(clean)) return null;
  if (clean.length > 255) return null;
  return clean;
}

function badHost(host: string): DomainFailure {
  return {
    ok: false,
    reason: "refused",
    message: `"${host}" is not a bare hostname. Give it as chambers.example.ng — no https://, no port, no path.`,
  };
}

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

/** One request. A network failure or an unreadable body comes back as "unreachable", never thrown. */
async function call(
  cfg: VercelConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Answer | DomainFailure> {
  const url = new URL(`${API}${path}`);
  if (cfg.teamId) url.searchParams.set("teamId", cfg.teamId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    let parsed: Record<string, unknown> = {};
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // A body we cannot read is only a problem when the call also failed; a successful
        // DELETE with an empty body is normal.
        if (!res.ok) {
          return {
            ok: false,
            reason: "unreachable",
            status: res.status,
            message: `Vercel answered ${res.status} with something Docket could not read.`,
          };
        }
      }
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    return {
      ok: false,
      reason: "unreachable",
      message: `Docket could not reach the Vercel API: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function isFailure(a: Answer | DomainFailure): a is DomainFailure {
  return (a as DomainFailure).ok === false;
}

function errorOf(body: Record<string, unknown>): { code: string; message: string } {
  const e = (body.error ?? {}) as Record<string, unknown>;
  return {
    code: typeof e.code === "string" ? e.code : "",
    message: typeof e.message === "string" ? e.message : "",
  };
}

/** Vercel's failure codes, mapped to the three remedies an operator actually has. */
function failureFrom(status: number, body: Record<string, unknown>): DomainFailure {
  const { code, message } = errorOf(body);
  const taken =
    code === "domain_already_in_use" ||
    code === "domain_taken" ||
    code === "not_transferable" ||
    status === 409;
  if (taken) {
    return {
      ok: false,
      reason: "taken",
      status,
      message: message || "Another Vercel project or account already holds that hostname.",
    };
  }
  if (status === 404) {
    return { ok: false, reason: "not_found", status, message: message || "Vercel has no such domain on this project." };
  }
  if (status >= 500) {
    return { ok: false, reason: "unreachable", status, message: message || `Vercel answered ${status}.` };
  }
  return { ok: false, reason: "refused", status, message: message || `Vercel refused the request (${status}).` };
}

function verificationOf(body: Record<string, unknown>): DomainVerification[] {
  const raw = body.verification;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const v = (r ?? {}) as Record<string, unknown>;
      return {
        type: String(v.type ?? ""),
        domain: String(v.domain ?? ""),
        value: String(v.value ?? ""),
        reason: typeof v.reason === "string" ? v.reason : undefined,
      };
    })
    .filter((v) => v.type && v.value);
}

/**
 * Whether DNS points at this deployment yet. A separate endpoint from the project domain, and a
 * separate failure: if it does not answer we report "unknown" rather than claiming the domain is
 * fine or claiming it is broken.
 */
async function misconfiguredOf(cfg: VercelConfig, host: string): Promise<boolean | null> {
  const answer = await call(cfg, "GET", `/v6/domains/${encodeURIComponent(host)}/config`);
  if (isFailure(answer) || answer.status >= 400) return null;
  const value = answer.body.misconfigured;
  return typeof value === "boolean" ? value : null;
}

async function okFrom(cfg: VercelConfig, host: string, body: Record<string, unknown>): Promise<DomainOk> {
  const verification = verificationOf(body);
  return {
    ok: true,
    host: typeof body.name === "string" ? body.name : host,
    verified: body.verified === true,
    verification,
    misconfigured: await misconfiguredOf(cfg, host),
  };
}

/**
 * Ask Vercel to serve this hostname for the project. Call this BEFORE set_firm_domain(): the
 * database write is only safe once the edge has agreed to answer.
 *
 * Adding is idempotent. A hostname this project already holds comes back as the domain it
 * already is, not as a failure, so an operator can press the button twice without harm.
 */
export async function addDomain(host: string): Promise<DomainResult> {
  const cfg = config();
  if (!cfg) return NOT_CONFIGURED;
  const clean = normalise(host);
  if (!clean) return badHost(host);

  const answer = await call(cfg, "POST", `/v10/projects/${encodeURIComponent(cfg.projectId)}/domains`, {
    name: clean,
  });
  if (isFailure(answer)) return answer;
  if (answer.status < 300) return okFrom(cfg, clean, answer.body);

  // "Already in use" is ambiguous: it means either another project holds it, or this one does.
  // Asking settles it, and only the first is a failure.
  const failure = failureFrom(answer.status, answer.body);
  if (failure.reason === "taken") {
    const existing = await getDomain(clean);
    if (existing.ok) return existing;
  }
  return failure;
}

/** What Vercel currently knows about this hostname on this project. */
export async function getDomain(host: string): Promise<DomainResult> {
  const cfg = config();
  if (!cfg) return NOT_CONFIGURED;
  const clean = normalise(host);
  if (!clean) return badHost(host);

  const answer = await call(
    cfg,
    "GET",
    `/v9/projects/${encodeURIComponent(cfg.projectId)}/domains/${encodeURIComponent(clean)}`,
  );
  if (isFailure(answer)) return answer;
  if (answer.status < 300) return okFrom(cfg, clean, answer.body);
  return failureFrom(answer.status, answer.body);
}

/**
 * Stop serving the hostname. A host Vercel was not holding is reported as removed=false rather
 * than as an error — the caller wanted it gone, and it is gone.
 */
export async function removeDomain(host: string): Promise<RemoveDomainResult> {
  const cfg = config();
  if (!cfg) return NOT_CONFIGURED;
  const clean = normalise(host);
  if (!clean) return badHost(host);

  const answer = await call(
    cfg,
    "DELETE",
    `/v9/projects/${encodeURIComponent(cfg.projectId)}/domains/${encodeURIComponent(clean)}`,
  );
  if (isFailure(answer)) return answer;
  if (answer.status < 300) return { ok: true, host: clean, removed: true };
  if (answer.status === 404) return { ok: true, host: clean, removed: false };
  return failureFrom(answer.status, answer.body);
}
