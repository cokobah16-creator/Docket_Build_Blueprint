// Content-Security-Policy, built fresh for every request.
//
// WHY THIS LIVES HERE AND NOT IN next.config.mjs
// next.config.mjs headers() are static strings baked at build time, and a static policy cannot
// carry a nonce. The App Router streams inline bootstrap scripts (self.__next_f.push(...)) into
// every HTML document; without a nonce the only way to allow them is 'unsafe-inline' on
// script-src, which is the same as having no script policy at all. So the policy is built in
// middleware.ts, one nonce per request, and this module is the builder.
//
// EVERY ORIGIN IN HERE IS JUSTIFIED IN A COMMENT NEXT TO IT. If a directive lists an origin and
// no line of this codebase reaches it, it should not be here.
//
// WHAT IS DELIBERATELY NOT HERE
//  · PostHog and Sentry (src/lib/observability): both are called from server code with fetch,
//    never from the browser. There is no browser SDK and no autocapture, so they need no
//    connect-src entry. Adding one would advertise an egress the browser never makes.
//  · Paystack: checkout is a TOP-LEVEL redirect out of Docket (src/lib/actions/booking.ts and
//    portal.ts both end in redirect(checkoutUrl)), never an iframe. That is form-action, not
//    frame-src — the form post that starts checkout is redirected to Paystack, and Chrome
//    checks the redirect target of a form submission against form-action.
//  · A report endpoint. Nothing in Docket collects CSP reports yet, so report-to would name a
//    URL that does not exist. Use CSP_REPORT_ONLY below to shake the policy out instead.

/** The request header the middleware stamps so a server component can read the nonce back. */
export const CSP_NONCE_HEADER = "x-nonce";

/**
 * THE ROUTES A NONCE CANNOT REACH.
 *
 * A nonce is minted per request. A page Next.js prerenders at BUILD time has no request, so the
 * inline flight-data scripts baked into its HTML (self.__next_f.push(...)) carry no nonce
 * attribute — and a nonce policy would block them, which stops React hydrating and leaves the
 * page as dead HTML. On the two sign-in pages that means nobody can sign in.
 *
 * These three routes are prerendered because they read no cookies, no headers, no search
 * params and no uncached data:
 *   /            app/page.tsx                      — the platform landing page
 *   /app/login   app/app/(auth)/login/page.tsx     — client sign-in ("use client", no data)
 *   /firm/login  app/firm/(auth)/login/page.tsx    — staff sign-in ("use client", no data)
 *
 * They are also the only three routes in Docket that render nothing a person supplied — no
 * firm, no matter, no query string, no database row — so relaxing script-src to 'unsafe-inline'
 * on exactly these three costs nothing that could be injected. Every other route reaches the
 * database through cookies() or an uncached fetch, is therefore rendered per request, and gets
 * the nonce.
 *
 * THIS LIST IS ONLY RIGHT IF THE BUILD AGREES WITH IT, and the build is the authority. Run
 * `npm run build` and read the route table: every row marked ○ (Static) must either be in this
 * set or be listed under the exception below. The first version of this file was written from
 * the three routes above and the build prerendered seven — /admin, /firm/start and
 * /firm/security/mfa were served the strict policy with un-nonced scripts, so the firm
 * registration form, the TOTP enrolment page and the whole platform console were dead HTML.
 * All three now carry `export const dynamic = "force-dynamic"`, which is the right answer for
 * them on their own merits: each decides what to show from the caller's session.
 *
 * THE ONE ○ ROUTE THAT CANNOT BE MATCHED HERE is /_not-found. A 404 is served for whatever
 * path was actually asked for, so the pathname this function is given is never "/_not-found"
 * and no entry could match it. It is left as it is on purpose: Next's built-in 404 is a
 * paragraph of static text with no control on it, so a blocked hydration costs a console
 * violation and nothing a visitor can see. Give Docket its own not-found screen and that
 * stops being true — make it dynamic at the same time.
 *
 * PREFER force-dynamic ON THE PAGE over another entry in this set. A new page that reads no
 * cookies, headers or uncached data will be prerendered too, and will break under the nonce
 * policy unless it opts out. An entry added here without the "renders nothing a person
 * supplied" reason above is a hole in the policy, not a fix.
 */
const PRERENDERED_SHELLS = new Set(["/", "/app/login", "/firm/login"]);

/**
 * Is this the platform-side path of one of those shells? `rewritten` is true when the middleware
 * has sent the request to a tenant's own pages, which are always rendered per request — a firm
 * host's "/" is app/(public)/[firm]/page.tsx, not the landing page.
 */
export function isPrerenderedShell(pathname: string, rewritten: boolean): boolean {
  if (rewritten) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PRERENDERED_SHELLS.has(path === "" ? "/" : path);
}

/**
 * Next.js finds the nonce for its own script tags by reading the CSP off the REQUEST headers
 * (it accepts either name). The middleware sets this one on the request in every mode, so the
 * bootstrap keeps its nonce even while the response is only reporting.
 */
export const CSP_REQUEST_HEADER = "content-security-policy";

/**
 * Set CSP_REPORT_ONLY=1 to serve the policy as Content-Security-Policy-Report-Only: browsers
 * log violations to the console and block nothing. That is the safe way to change any directive
 * below on a live deployment — turn it on, watch, turn it off.
 */
export function cspHeaderName(): string {
  return process.env.CSP_REPORT_ONLY === "1"
    ? "content-security-policy-report-only"
    : "content-security-policy";
}

/**
 * A fresh 128-bit nonce, base64. Edge runtime: crypto.getRandomValues and btoa are both there,
 * Buffer is not guaranteed, so neither is used.
 */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * The Supabase project origin, from the same variable the browser client is built with
 * (src/lib/env.ts). Self-hosted projects live on their own hostname, so this is read rather
 * than guessed at with a *.supabase.co wildcard.
 *
 * When it is unset the app renders a setup notice and makes no Supabase call at all, so the
 * origin is simply left out of the policy rather than replaced with a wildcard.
 */
function supabaseOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** https://x.supabase.co → wss://x.supabase.co, for Realtime. */
function websocketOrigin(httpOrigin: string | null): string | null {
  return httpOrigin ? httpOrigin.replace(/^https:/, "wss:").replace(/^http:/, "ws:") : null;
}

// Daily.co. The consultation room (src/components/video/consultation-room.tsx) imports
// @daily-co/daily-js and calls DailyIframe.createFrame(), which puts an iframe on
// https://<account>.daily.co/<room> — the URL src/lib/providers/video/daily.ts builds. The
// account subdomain is deployment configuration, so the frame origin is matched by wildcard.
const DAILY_FRAME = "https://*.daily.co";
// Daily's own published CSP guidance also names its media relays. In prebuilt mode the call
// itself runs inside the iframe, but daily-js still probes connectivity from the parent page.
// A blocked probe would cost a client their consultation, which is a far worse outcome than
// two extra origins on connect-src.
const DAILY_CONNECT = [
  "https://*.daily.co",
  "wss://*.daily.co",
  "https://*.pluot.blue",
  "wss://*.pluot.blue",
];

// Google Fonts. src/lib/brand.ts builds a fonts.googleapis.com stylesheet URL from the tenant's
// firms.brand.fonts; the faces it references are served from fonts.gstatic.com. Tenant font
// names cannot inject an origin: validate_brand() reduces them to letters, digits and spaces.
const FONT_CSS = "https://fonts.googleapis.com";
const FONT_FILES = "https://fonts.gstatic.com";

// Paystack's initialize call returns authorization_url on this host
// (src/lib/providers/payments/paystack.ts).
const PAYSTACK_CHECKOUT = "https://checkout.paystack.com";

function join(directive: string, sources: Array<string | null | false>): string {
  const list = sources.filter((s): s is string => Boolean(s));
  return `${directive} ${list.join(" ")}`;
}

export interface CspOptions {
  /**
   * True for the handful of routes Next.js prerenders at build time, whose inline scripts can
   * never carry a per-request nonce. See PRERENDERED_SHELLS above.
   */
  prerendered?: boolean;
  /**
   * Development relaxes exactly two things and nothing else: webpack's eval-based module
   * wrapper needs 'unsafe-eval', and upgrade-insecure-requests would rewrite every
   * http://localhost request to https and leave a developer with a dead site.
   */
  dev?: boolean;
}

/** Build the policy for one request. */
export function contentSecurityPolicy(nonce: string, options: CspOptions = {}): string {
  const dev = options.dev ?? process.env.NODE_ENV !== "production";
  const prerendered = options.prerendered ?? false;
  const supabase = supabaseOrigin();
  const supabaseWs = websocketOrigin(supabase);

  const directives = [
    // Anything not named below is same-origin only.
    join("default-src", ["'self'"]),

    // No 'unsafe-inline'. The App Router's own inline bootstrap carries the nonce (Next reads
    // it from the request header the middleware sets). 'self' covers the /_next/static bundles.
    // 'strict-dynamic' is deliberately NOT used: it would switch off 'self', so a single Next
    // release that emits one un-nonced script tag would take the whole product down.
    //
    // On a prerendered shell there is no nonce to give and 'unsafe-inline' takes its place.
    // The two must never appear together: a browser that sees a nonce IGNORES 'unsafe-inline'
    // entirely, so the pair would silently be the strict policy again.
    join("script-src", [
      "'self'",
      prerendered ? "'unsafe-inline'" : `'nonce-${nonce}'`,
      dev && "'unsafe-eval'",
    ]),

    // 'unsafe-inline' is required and cannot be avoided: tenant brand tokens are applied as a
    // React style attribute (brandStyle() in src/lib/brand.ts, used by the portal and tenant
    // layouts), and a style ATTRIBUTE can never carry a nonce. Note there is no nonce in this
    // directive — adding one would make browsers ignore 'unsafe-inline' and unbrand every
    // tenant page. The values themselves are hex colours and font names the database has
    // already validated.
    join("style-src", ["'self'", "'unsafe-inline'", FONT_CSS]),
    join("font-src", ["'self'", FONT_FILES]),

    // data: is the TOTP enrolment QR — Supabase returns it as a data URI
    // (app/firm/(auth)/security/mfa/mfa-setup.tsx). The Supabase origin serves signed document
    // previews and the firm logo from storage.
    join("img-src", ["'self'", "data:", supabase]),

    // 'self' is server actions and route handlers. Supabase is PostgREST, Auth and Storage over
    // https and Realtime over wss (postgres_changes subscriptions in the portal and console).
    join("connect-src", ["'self'", supabase, supabaseWs, ...DAILY_CONNECT]),

    // The preflight camera test attaches a MediaStream to a <video>; blob: and mediastream: are
    // what browsers check for that and for anything the Daily frame hands the page.
    join("media-src", ["'self'", "blob:", "mediastream:", DAILY_FRAME]),

    // Two things are framed by Docket and nothing else: the Daily consultation room, and a
    // signed Supabase Storage URL when a client or a lawyer previews a PDF in place.
    join("frame-src", ["'self'", supabase, DAILY_FRAME]),

    // /sw.js is the push and offline worker. blob: is for workers a bundled library spins up
    // in-page; no user content is ever served from this origin, so it cannot become a payload.
    join("worker-src", ["'self'", "blob:"]),
    join("manifest-src", ["'self'"]),

    // Nothing in Docket embeds a plugin, and no page sets a <base> tag. base-uri 'none' also
    // closes the classic way a nonce policy gets walked around.
    join("object-src", ["'none'"]),
    join("base-uri", ["'none'"]),

    // Forms post back to Docket, except the one that starts a Paystack checkout.
    join("form-action", ["'self'", PAYSTACK_CHECKOUT]),

    // Docket is never framed. This is the modern half of the X-Frame-Options: DENY that
    // next.config.mjs also sends for older browsers.
    join("frame-ancestors", ["'none'"]),
  ];

  if (!dev) directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}
