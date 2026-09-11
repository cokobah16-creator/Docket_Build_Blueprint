// Response headers that are the same on every request.
//
// The Content-Security-Policy is NOT here: it carries a per-request nonce and is built in
// middleware.ts from src/lib/csp.ts. Everything in this file is a constant, so it can be a
// static header — and static headers reach paths middleware deliberately skips (the matcher
// excludes anything with a dot, which is /sw.js, /offline.html and /manifest.webmanifest).

// Daily.co is the only third party Docket embeds, and it is embedded for exactly one reason:
// a video consultation needs the camera, the microphone and, for screen share, display capture.
// A cross-origin iframe gets none of those unless the PARENT page delegates them by origin —
// its own allow="camera; microphone" attribute can only narrow what we grant, never widen it.
// So the room origin has to be named here, and DAILY_DOMAIN is the same variable
// src/lib/providers/video/daily.ts builds the room URL from.
const dailyDomain = (process.env.DAILY_DOMAIN ?? '').trim().toLowerCase();
const dailyOrigin = dailyDomain
  ? `https://${dailyDomain.includes('.') ? dailyDomain : `${dailyDomain}.daily.co`}`
  : null;

// Permissions-Policy has no wildcard for subdomains: an allowlist item is 'self', '*', or an
// exact origin. If DAILY_DOMAIN is not set at build time we cannot name the room origin, and a
// policy naming only self would leave every consultation with a black square and a dead
// microphone. Losing video is a worse outcome than leaving these three features open to the
// frames Docket chooses to embed — which is Daily and nothing else — so the fallback is '*'.
// Set DAILY_DOMAIN and it narrows to one origin.
const media = dailyOrigin ? `(self "${dailyOrigin}")` : '*';

/**
 * Everything the browser lets a page ask for, decided once.
 *
 * ALLOWED, each because something in this codebase uses it:
 *  · camera, microphone   the consultation preflight (navigator.mediaDevices.getUserMedia in
 *                         src/components/video/consultation-room.tsx) and the Daily room
 *  · display-capture      screen share — the Daily room is created with enable_screenshare
 *  · autoplay             remote video and audio in the room start without a second click
 *  · fullscreen           the room is created with showFullscreenButton: true
 *  · screen-wake-lock     a phone must not sleep in the middle of a consultation
 *  · clipboard-write      "copy link" for invitations and payment links, on Docket's own pages
 *
 * DENIED, because nothing in Docket asks for them and a denied feature cannot be abused by
 * anything that ever gets injected into a page:
 *  · payment              Paystack is a redirect, not the Payment Request API
 *  · publickey-credentials-get   staff MFA is TOTP (migration 7), not WebAuthn
 *  · geolocation, the motion and environment sensors, bluetooth, serial, usb, hid, midi
 *  · idle-detection, window-management, local-fonts, picture-in-picture, encrypted-media
 *  · clipboard-read       nothing reads the clipboard; only writes to it
 *  · browsing-topics      Docket is not part of anybody's ad auction
 */
const permissionsPolicy = [
  `camera=${media}`,
  `microphone=${media}`,
  `display-capture=${media}`,
  `autoplay=${media}`,
  `fullscreen=${media}`,
  `screen-wake-lock=${media}`,
  'clipboard-write=(self)',
  'accelerometer=()',
  'ambient-light-sensor=()',
  'battery=()',
  'bluetooth=()',
  'browsing-topics=()',
  'clipboard-read=()',
  'encrypted-media=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'local-fonts=()',
  'magnetometer=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'publickey-credentials-get=()',
  'serial=()',
  'usb=()',
  'window-management=()',
  'xr-spatial-tracking=()',
].join(', ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,

  // DO NOT ADD serverActions.allowedOrigins.
  // Next 15 already refuses a Server Action whose Origin does not match the Host it arrived on,
  // and that check is the one that matters. An explicit allowedOrigins list would have to name
  // every host Docket answers on — and those are TENANT CUSTOM DOMAINS, added at runtime by a
  // platform admin through set_firm_domain() (migration 20). A build-time list can never
  // contain a domain mapped after the build, so the first firm to get its own domain would find
  // every form on its site refused. This is deliberate; leave it out.

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // NOTE: Strict-Transport-Security is NOT set here. It is set in middleware.ts, which
          // is the only place that knows whether this request arrived on one of Docket's own
          // hosts or on a tenant's custom domain. includeSubDomains on a firm's apex would pin
          // every one of that firm's other subdomains to HTTPS for two years, from a header they
          // never asked for and cannot take back.
          { key: 'Permissions-Policy', value: permissionsPolicy },
        ],
      },
    ];
  },
};

export default nextConfig;
