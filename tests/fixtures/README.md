# `tests/fixtures/` — layout fixtures, not tests of authorisation

Everything in this directory exists to answer one question: **does a screen lay out and read
correctly at a given width?**

It answers that question by running the real screens in a real browser against
`supabase-mock.mjs`, a stand-in Supabase written for this purpose.

## Read this before you cite a green run

The stand-in **implements no row-level security** and **checks no session**. It hands out a user
because it was asked, and returns a fixed set of rows to whoever connects. Its own header says so
in as many words.

So a clean run here proves:

- the page renders at 360/390/768/1024/1440 and in landscape,
- nothing overflows its viewport horizontally,
- the browser logged no errors other than the named fixture gaps below,
- tap targets, focus rings, composer room and draft survival behave (`ergonomics.mjs`),
- every colour, size, radius and status affordance on it is one the design system named, in
  **both** themes (`design.mjs`).

A clean run here proves **nothing whatever** about:

- who is allowed to see a matter, a message, an invoice or a client,
- whether a session is real, expired, or belongs to a different firm,
- any row-level security policy, any server-side authorisation check, any tenant isolation.

Authorisation is the database's job and only a real Supabase project can demonstrate it. If you
need evidence about access control, this directory is the wrong place to look for it.

`tests/e2e/` is the separate suite that runs against a **real target** — a deployment, or a dev
server wired to a real Supabase project. That is where anything about real data and real sessions
belongs.

## Files

| File | What it does |
| --- | --- |
| `supabase-mock.mjs` | The stand-in Supabase. Answers the GoTrue and PostgREST calls the console and portal make while rendering, with fixed rows chosen to exercise the layouts. No RLS, no session check. |
| `shots.mjs` | Opens every screen at every breakpoint, writes a PNG per screen per width, and fails on horizontal overflow, HTTP >= 400, navigation failure, or a console error that is not a named fixture gap. |
| `ergonomics.mjs` | The checks a screenshot cannot make: 44x44 tap targets, visible focus, composer above the on-screen keyboard's line, and a half-typed draft surviving a phone to desktop resize. |
| `composer.mjs` | The first second of a form's life. Types, pastes and fills at the instant a field appears, before React has attached to it, and holds every character — in the client's message composer and in the lawyer's court-update form. Nothing in it waits for the page to settle: waiting is what hid the bug it exists to catch. |
| `navigation.mjs` | That the console keeps naming the firm on screen through a switch, a followed link, and Back and Forward; and that the phone's More sheet traps focus, closes on Escape, makes the page behind it inert, gives focus back, and lets go when a rotation crosses the tablet breakpoint. |
| `design.mjs` | The design linter, applied to every surface in both themes: contrast, control boundaries, the type ramp, the token set, the radius scale, the tenant-brand firewall and status affordances. Also carries `--inventory` / `--diff`, the semantic screenshot diff. See **The design linter** below. |
| `contrast.mjs` | The colour arithmetic `design.mjs` and `design/home/verify.mjs` share — parse, luminance, ratio, alpha compositing, the AA threshold, and the walk up to the ground an element is painted on. Not a runnable check; it exists so the landing gate and the app gate cannot come to disagree about what 4.5:1 means. |

All five checks **exit nonzero when they report problems**, so a failure cannot be mistaken for a
pass by CI or by a person rerunning them. `npm run test:fixtures` runs the lot in order.

`design.mjs` is last in that chain on purpose. It is **red today**, and that is the point of it —
see below — so the four that have always been green still run and report before it stops the run.

## Rerunning the layout fixtures

```sh
# 1. start the stand-in Supabase; it prints ANON_KEY=<key> on startup
node tests/fixtures/supabase-mock.mjs --port 54321 --role staff &

# 2. point the app at it (same <key> in both places)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<key> npm run dev &

# 3. run them
MOCK_TOKEN=<key> npm run test:fixtures      # all five, stopping at the first failure

# or one at a time
MOCK_TOKEN=<key> npm run test:layout        # === node tests/fixtures/shots.mjs
MOCK_TOKEN=<key> npm run test:ergonomics    # === node tests/fixtures/ergonomics.mjs
MOCK_TOKEN=<key> npm run test:composer      # === node tests/fixtures/composer.mjs
MOCK_TOKEN=<key> npm run test:navigation    # === node tests/fixtures/navigation.mjs
MOCK_TOKEN=<key> npm run test:design        # === node tests/fixtures/design.mjs
```

`shots.mjs` takes `--out <dir>` (default `/tmp/shots`), `--base <url>` (default
`http://localhost:3000`) and `--only <substring>` to run a subset of screens. It writes
`problems.txt` and `ignored.txt` next to the PNGs.

`design.mjs` takes those same three (its `--out` defaults to `/tmp/design`, and it writes
`design-problems.txt` and `ignored.txt` there) plus four of its own — `--viewports`, `--themes`,
`--inventory` and `--diff` — all described below.

In a sandbox with no bundled Playwright browser, set `PW_CHROMIUM` to a Chromium binary, e.g.
`PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. `playwright.config.ts` honours
the same variable. Unset, on a developer's machine or in CI, nothing changes.

## Rerunning the real tests

```sh
npm run test:e2e                                          # config starts next dev itself
PLAYWRIGHT_BASE_URL=https://<deployment> npm run test:e2e # against a real deployment
```

`tests/e2e/` reads public pages only; it signs nobody in. The journeys that need a real
session — sign-in, messaging, document access, firm switching, and being refused another
firm's records — are in `tests/integration/`, with their own README saying exactly what
configuration they need. They **skip** without it, and a skip is not a pass.

Authorisation itself is covered, and does pass, in the repository's SQL suite:

```sh
DATABASE_URL=postgres://postgres:<pw>@localhost:5432/postgres npm run db:test:local
```

## The named fixture gaps

`shots.mjs` waives two console errors, and only these two. Both are printed, with counts, under
an `ignored (known fixture gaps)` heading on every run, so what was excused is visible and can be
argued with. Neither counts toward the exit status.

1. **Realtime handshake.** The stand-in runs no Realtime server, so any screen with a live
   subscription logs a failed WebSocket handshake to
   `ws://127.0.0.1:54321/realtime/v1/websocket`. The pattern is pinned to that local endpoint —
   a WebSocket failure to any other host or path is reported as a problem.
2. **The tenant's Google Fonts stylesheet.** There is no outbound network in the sandbox these
   fixtures were repaired in. External requests are **aborted** rather than answered, because
   answering them with `200 text/css` (as an earlier version did) made a broken image or script
   look like a success and lied about content type. The abort makes the tenant's
   `fonts.googleapis.com` stylesheet fail to load, and that one console error is waived — matched
   by the message's source URL, not by a broad text pattern, so a failed image, script or API
   call still reports.

Every host whose requests were aborted is listed in the same section with a count, so anything
newly reaching for the network is visible.
