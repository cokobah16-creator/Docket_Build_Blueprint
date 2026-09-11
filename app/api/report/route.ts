// Where a browser error goes.
//
// The error boundaries run in the browser, and captureException() reads SENTRY_DSN — a server
// variable, undefined in the client bundle — so a boundary calling it directly reports nothing
// at all. Exposing the DSN instead would mean shipping a key to every visitor AND widening
// connect-src to Sentry's origin, which is a worse trade than one route of our own.
//
// So the browser posts here and the server reports. connect-src already allows 'self', no key
// leaves the server, and nothing about this endpoint is worth abusing: it accepts three short
// strings, keeps nothing, and is rate-limited by the same limiter as everything else.

import { NextResponse } from "next/server";
import { z } from "zod";
import { captureException } from "@/lib/observability";
import { supabaseServer } from "@/lib/supabase/server";
import { allow } from "@/lib/rate-limit";

const reportSchema = z.object({
  name: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1).max(2000),
  where: z.string().trim().max(120).optional(),
  digest: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const supabase = await supabaseServer();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Anonymous reports are keyed on the caller's address; a signed-in one on their own id.
    if (!(await allow(supabase, "report", Boolean(user)))) {
      return NextResponse.json({ ok: false }, { status: 429 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const err = new Error(parsed.data.message);
  err.name = parsed.data.name || "BrowserError";
  await captureException(err, {
    where: parsed.data.where || "browser",
    tags: { runtime: "browser" },
    extra: parsed.data.digest ? { digest: parsed.data.digest } : undefined,
  });

  // Always 204, whatever happened upstream. A page that is already broken learns nothing useful
  // from being told the report failed too.
  return new NextResponse(null, { status: 204 });
}
