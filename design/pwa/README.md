# Docket mobile app

The phone. One tappable prototype of both shells — the client app at `/app`
and the staff console at `/firm` — with real navigation between every screen.
It is a design artboard, not shipping code: the pages under `app/app/(portal)`
and `app/firm/(console)` are what actually serve; this is where the mobile
cleanup, the icon language and the three new behaviours were worked out first.

    Docket PWA.dc.html   the artboard: template, then the DCLogic component
    ios-frame.jsx        iPhone bezel and status bar (omelette starter copy)
    android-frame.jsx    Android bezel and status bar (omelette starter copy)
    canvas.json          frame size and launch view for the design canvas
    verify.mjs           runs the component headlessly and fails on the rules below

`.dc.html` is a Claude Design artboard. The `./support.js` line in the head and
the `<x-dc>` / `<helmet>` wrapper are the canvas runtime and must stay verbatim;
`verify.mjs` reads the component out of the file and runs it without them. The
two frame files are copied starters — re-copying the starter overwrites them,
which is fine, but both were patched to coalesce a `null` width/height, and that
patch has to survive.

## The controls above the phone

They belong to the prototype, not to the app.

| control | what it does |
| --- | --- |
| Client app · Lawyer app | which shell is on the phone |
| iPhone · Android | which bezel, status bar and safe areas |
| Good network · Weak network · Offline | what the network is doing to the person holding it |

Each has a prop for the canvas panel: `initialShell`, `initialFrame`,
`initialFirm` (`ak` Attorneys Klinique, `bc` Bello & Co), `initialNetwork`.

The network control is the only way to see three of the screens do their job:
Offline shows the saved copy on home (or the "nothing saved" notice if the
profile never took one); Weak makes the waiting room and the call say so and
offer audio-only rather than degrade silently. It is deliberately not a saved
preference — low-data mode is something the client chose, a weak connection is
something that happened to them, and the prototype must never conflate the two.

## The rules

**Two shells, two palettes.** The client app wears the firm's brand — `--pri`,
`--acc`, `--head` come from the firm on screen, and tapping the firm name
repaints the whole app. The staff console wears no firm's colours: ink is
`#141414`, ground is `#F5F4F1`, Archivo throughout. Colour there means one
thing — late, unpaid, or waiting on you.

**Status has four grounds.** Green (`#ECFDF3` / `#05603A`) is settled, amber
(`#FFFAEB` / `#92400E`) is waiting on someone, red (`#FEF3F2` / `#912018`) is
wrong, grey is over. Nothing new invents a fifth. These are Docket's own and do
not move with a firm's brand — "confirmed" must mean the same thing at every
firm.

**Data follows the firm.** Matters, appointments, notifications, documents,
threads, references and the service blurb are all keyed by firm. Switching
firms switches the rows, not just the paint.

**Every row opens its own thing.** An appointment row opens that appointment;
the detail screen renders its reference, service, date, format, duration,
invoice and status, and a completed one has no waiting-room card and no cancel
button.

**The call must be reachable.** After "Join and wait to be admitted" the client
is admitted after a moment (the lawyer does it from their own phone in the
real thing), so the in-call surface, the audio-only pane, the weak-connection
warning and the data-used readout can all be seen. Leaving the lobby cancels
the admission.

**Bandwidth honesty is in numbers.** Audio-only names its cost before the
client commits (about 0.5 MB a minute against 6), the weak-connection warning
offers the cheaper path, and the call ends by saying what it used.

## Screen map

| prototype screen | serves from |
| --- | --- |
| client / home | `app/app/(portal)/page.tsx` |
| client / notifs | `app/app/(portal)/notifications/page.tsx` |
| client / appts, appt | `app/app/(portal)/appointments/page.tsx`, `[id]/page.tsx` |
| client / waiting, call, ended | `[id]/waiting-room/page.tsx`, `src/components/video/consultation-room.tsx` |
| client / matters | `app/app/(portal)/matters/page.tsx` |
| client / messages | `app/app/(portal)/messages/page.tsx` |
| client / profile | `app/app/(portal)/profile/page.tsx` |
| client / book | `app/(public)/[firm]/book/booking-wizard.tsx` |
| client / pay, paid | `src/components/portal/pay-panel.tsx`, `appointments/[id]/payment-result/` |
| firm switcher | `src/lib/portal-firm.ts`, `src/components/portal/firm-switcher.tsx` |
| offline copy | `public/sw.js`, `src/lib/offline.ts` |
| lawyer / today | `app/firm/(console)/page.tsx` |
| lawyer / consults | `app/firm/(console)/appointments/page.tsx` |
| lawyer / lawAppt | `app/firm/(console)/appointments/[id]/page.tsx`, `notes-form.tsx` |
| lawyer / lawCall | `src/components/video/consultation-room.tsx` (owner role) |
| lawyer / clients | `app/firm/(console)/clients/page.tsx` |
| lawyer / me | `app/firm/(console)/me/page.tsx` |
| icons throughout | `src/components/ui/icon.tsx` |

## Working on it

Edit `Docket PWA.dc.html`, then:

    node design/pwa/verify.mjs

It needs nothing but Node. The component is run under a stub of the canvas
runtime, every shell × frame × firm × screen is rendered, every `{{ binding }}`
in the template is checked against what the component returns, and each rule
above has an assertion. A missing binding or a screen that throws is a failure.

To put it back on the canvas, seed a fresh payload with the `design` skill's
`seed-canvas.mjs`, passing `Docket PWA.dc.html` and `canvas.json`, then publish
the seeded file.
