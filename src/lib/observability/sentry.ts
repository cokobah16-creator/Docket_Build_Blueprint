// Error reporting, with no dependency.
//
// @sentry/nextjs is a large package that also rewrites the build. Everything Docket needs is
// one HTTP POST to Sentry's envelope endpoint, so this is a first-party 30-line client instead:
// no install step, no build plugin, nothing to keep in step with Next.js releases.
//
// It is deliberately impossible for telemetry to break a request. With no DSN set it returns
// immediately; every failure is swallowed; nothing is awaited on the critical path unless the
// caller chooses to.

const SENTRY_VERSION = 7;

interface Dsn {
  host: string;
  projectId: string;
  publicKey: string;
}

/** https://<publicKey>@<host>/<projectId> */
function parseDsn(raw: string | undefined): Dsn | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !u.host || !projectId) return null;
    return { host: u.host, projectId, publicKey: u.username };
  } catch {
    return null;
  }
}

/** Sentry wants 32 lowercase hex characters, not a dashed UUID. */
function eventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function frames(err: Error): Array<Record<string, unknown>> {
  // Sentry renders a raw stack string fine; keeping it whole avoids guessing at a parser that
  // would be wrong for Next's bundled frames anyway.
  return err.stack ? [{ filename: "<stack>", function: err.stack }] : [];
}

export interface ErrorContext {
  /** Where it happened, in words: "booking wizard", "paystack webhook". */
  where?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  /** The signed-in person, if the caller already knows. Never looked up here. */
  userId?: string;
}

/**
 * Report an error. Returns the Sentry event id, or null when nothing was sent.
 *
 * Safe to call from a server component, a server action, a route handler or an error boundary.
 * Never throws.
 */
export async function captureException(error: unknown, ctx: ErrorContext = {}): Promise<string | null> {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return null;

  const err = error instanceof Error ? error : new Error(String(error));
  const id = eventId();
  const sentAt = new Date().toISOString();

  const event = {
    event_id: id,
    timestamp: sentAt,
    platform: "javascript",
    level: "error",
    logger: ctx.where ?? "docket",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
    server_name: undefined,
    tags: ctx.tags,
    extra: ctx.extra,
    user: ctx.userId ? { id: ctx.userId } : undefined,
    exception: {
      values: [{ type: err.name, value: err.message, stacktrace: { frames: frames(err) } }],
    },
  };

  const body =
    JSON.stringify({ event_id: id, sent_at: sentAt, dsn: process.env.SENTRY_DSN }) +
    "\n" +
    JSON.stringify({ type: "event" }) +
    "\n" +
    JSON.stringify(event) +
    "\n";

  try {
    await fetch(
      `https://${dsn.host}/api/${dsn.projectId}/envelope/?sentry_key=${dsn.publicKey}&sentry_version=${SENTRY_VERSION}`,
      { method: "POST", headers: { "Content-Type": "application/x-sentry-envelope" }, body },
    );
    return id;
  } catch {
    return null;
  }
}
