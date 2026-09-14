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

## The design linter

`design/home/verify.mjs` has judged the landing artboard since it was written, and has been green
throughout. The application had never been judged by anything. That is how `text-gray-500` reached
459 uses at 4.43:1 and `border-gray-300` reached 150 at 1.35:1 — nothing was watching.
`design.mjs` is the same linter pointed at the running app.

Both files now import their colour arithmetic from `contrast.mjs` rather than each keeping a copy.
Two copies of "what 4.5:1 means" is how the two gates would have drifted apart, and the only
symptom would have been a screen that passed one and failed the other for no reason a reader could
see. `verify.mjs` was refactored onto it with its output unchanged, byte for byte.

### What it checks

| Check | Fails on |
| --- | --- |
| contrast | Text below WCAG 2.2 AA against the ground **actually painted behind it**, not the one the class implies. 3:1 for large text — 24px, or 18.66px bold — and 4.5:1 for everything else. |
| boundary | A control's edge below 3:1 (SC 1.4.11). Inputs, selects, textareas, buttons, `[role=button]`, and anchors given a control's box. |
| ramp | A font size off `[11, 13, 15, 17, 21, 26, 32, 44, 56, 88]`. |
| field | An input, select or textarea under 16px, which makes iOS Safari zoom the whole page on focus. Fields are exempt from the ramp for exactly this reason and held to this instead. |
| token | A computed colour, background or border that came from **outside the token set**. This is the anti-decay check: it makes a stray hex impossible to land. |
| radius | A corner off `[6, 9, 12, 18]`, 0, or full. |
| brand | A **tenant's** brand colour on a surface Docket owns — the landing, the staff console, the registry console, the platform admin. This firewall had never had a test on it. |
| lonely | A status colour with no icon and no label beside it. Colour is not readable to everyone and is not readable in every light. |

Every one of them runs **twice per screen**, once with `data-theme="light"` on the root and once
with `data-theme="dark"`. That is what makes the dark theme an enforced fact rather than an
aspiration: it is the same sweep, not a reduced one.

The token set is read off the running page rather than copied into the linter — every `--t-*` and
`--dk-*` in play, from the root and from every element that re-declares either family, so the
consoles' monochrome `--dk-*` override and the landing's `[data-theme-scope="light"]` subtree are
both understood. Docket's own `docket-*` palette is literal hex in `tailwind.config.ts`, precisely
so a firm cannot reach it, and is lifted from that file at startup. The firm slug, the row ids and
the tenant's seed colours come out of `supabase-mock.mjs` the same way. All three readers throw if
they find nothing, because a linter that silently checks less than it claims is worse than one
that refuses to start.

### What it does NOT check, and must not be read as covering

`design/home/README.md` lists **six** mitigations for the Nigerian brand risk — dark green with
gold sits close to the flag and the passport. Three are arithmetic and are held by these two
files: the green's chroma stays below flag green, the ground is warm rather than white, gold is
never text off green. **Three are judgement, and nothing here touches them:**

- **no green-and-gold crest or card object** — a program cannot recognise a crest;
- **the layout is asymmetric** — nor can it tell deliberate asymmetry from a mistake;
- **no symmetric green-white-green thirds** — partly measurable, but only a person can say whether
  a given arrangement reads as the flag.

**A green run is not a statement that the brand-risk posture is intact.** It is a statement about
contrast, ramp, tokens, radii, the tenant firewall and status affordances. Those three remaining
mitigations are reviewed by a person or they are not reviewed at all.

Beyond that, and stated plainly so a green run is not over-read:

- it reads computed styles, so a colour inside a background-image gradient, an SVG `fill`, an
  `::after` pseudo-element or a raster asset is invisible to it;
- white and black pass the token check because they genuinely **are** token values
  (`--t-on-danger`, `--dk-on-primary`), so a stray `bg-white` is not caught here;
- a status conveyed by a coloured **background** alone is not caught by `lonely`, which reads
  `color`;
- it judges the mock's data, so a screen whose empty state never renders is never checked;
- and it inherits every limit at the top of this file: the stand-in implements no RLS and checks
  no session, so none of this says anything about who may see a screen.

### It is red today

The app has never been linted, so the first run is not a list of false alarms — it is the
inventory of the debt, and it is the work list for the consolidation ahead. The report is grouped
by check and then by identical finding, because one stray value in a shared component is usually
the same line seen from forty screens, and forty identical lines is a wall rather than something
to act on. Each group prints its count, one example route and one example selector path; the full
ungrouped list goes to `<out>/design-problems.txt`.

Its waiver list (`IGNORE`, the same contract `shots.mjs` keeps) is **empty**, deliberately.
Nothing should be added to it to quieten a genuine finding; the place for a rule the design has
decided against is the rule itself. One finding shape is a fair candidate for a named entry: a
settings screen showing a firm its own brand colour back as a swatch is a legitimate use of that
colour on a Docket surface. That is a decision for a person to write down, with a reason, not a
reason to weaken the firewall for every other element.

Next.js's development overlay is not waived — it is skipped inside the page, by element, before a
finding is ever made. It is the framework's furniture, not Docket's design.

### The inventory is a semantic screenshot diff

The consolidation of ~60 screens will change a great many elements on purpose. Image diffing is
the usual net for that and it is the wrong one: it is flaky across font rendering, and it reports
a wall of pixels rather than a cause.

`--inventory` writes one JSON row per text-bearing element per route × viewport × theme — a stable
selector path plus `fontSize`, `fontWeight`, `color`, `background`, `border`, `radius`, `shadow`,
`width` and `height`. `--diff` prints only the rows that moved, with the selector path attached.
The expected changes are then enumerable, and anything else is a regression that names itself.

```sh
MOCK_TOKEN=<key> npm run test:design:inventory -- /tmp/before.json   # baseline, before the change
# … make the change …
MOCK_TOKEN=<key> npm run test:design:inventory -- /tmp/after.json
node tests/fixtures/design.mjs --diff /tmp/before.json /tmp/after.json
```

`--inventory` and `--diff` **record; they do not gate**, and both exit 0. A nonzero exit while
capturing a baseline would fail the very shell capturing it, and gain nothing: the run that gates
is the one without the flag. `--diff` opens no browser and needs no dev server, no `MOCK_TOKEN`
and no Playwright — it is arithmetic over two JSON files.

Two honest caveats about reading a diff:

- **A selector path carries `nth-of-type`.** One element inserted among its siblings renumbers
  every later sibling, and each of those rows appears as one that disappeared and one that
  appeared. That is the cost of a path-keyed diff. It is still far cheaper to read than a pixel
  diff of the same change, and the summary line separates those rows from genuine changes.
- **Only the style fields are compared.** `text` travels with each row so a diff can be read
  without opening the app, but a copy edit is not a design change and does not make a row appear.
  Geometry is compared, so a `width` or `height` can move on its own when the mock's relative
  dates roll over a day boundary and a label gets a character longer.

### Flags

| Flag | Default | What it does |
| --- | --- | --- |
| `--out <dir>` | `/tmp/design` | Where `design-problems.txt` and `ignored.txt` land. |
| `--base <url>` | `http://localhost:3000` | The running app. |
| `--only <substring>` | all | Runs the routes whose name contains it. |
| `--viewports <names>` | `390,1440` | Comma-separated names from the same table `shots.mjs` uses, or `all` for its full six. |
| `--themes <names>` | `light,dark` | Comma-separated `light` and/or `dark`. |
| `--inventory <file>` | off | Record instead of gate. Needs a path; it refuses to run without one. |
| `--diff <a> <b>` | off | Print the rows that changed between two inventories, then exit. |

Two widths by default rather than six: what this file measures — a colour, a size, a radius —
changes with width only where a responsive utility changes it, and phone versus desktop is where
that split lives. The other four are one flag away.

The route list is deliberately much wider than `shots.mjs`'s ten screens. It covers all five
surfaces — the platform landing, the tenant's public site, the client portal, the staff console,
and the registry and platform-admin consoles — and it makes an **unauthenticated** pass over `/`,
`/[firm]`, `/[firm]/book`, `/[firm]/services`, `/[firm]/lawyers` and both sign-in flows, because
that is how a stranger meets Docket and a fixture that always arrives holding a session never sees
it. A route that returns HTTP >= 400 is reported as a problem rather than linted quietly, so a
green run can never be a green run over an error page.

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
