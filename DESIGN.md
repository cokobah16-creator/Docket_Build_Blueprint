# The Docket design system

What the app looks like, why, and which rules are enforced by a machine rather
than by memory.

`design/home/README.md` governs the platform landing page only, and is stricter
than this document in places. Where the two disagree about that page, it wins.

## Three colour systems, deliberately separated

| | what it is | who may change it |
| --- | --- | --- |
| `brand-*` | the tenant's own colours, from `firms.brand` via `src/lib/brand.ts` | the firm |
| `docket-*` | Docket's own green and gold, literal hex in `tailwind.config.ts` | us |
| the theme | neutrals and status tints, `--t-*` in `app/globals.css` | us |

**A firm's colour must never reach a Docket-owned surface** — the landing
(`app/page.tsx`), the staff console, the registry console. That is why
`docket-*` is literal rather than variable: a firm picking a brand colour must
not be able to repaint the platform's own pages. The staff console goes further
and overrides the tenant variables outright with its own near-monochrome set, so
the same tool looks the same to everyone using it.

## Neutrals are named for their role, not their lightness

`ink` is the text colour in **both** themes. It is near-black on paper and
near-white on a dark ground. The role is what stays constant; the value is what
flips.

That is the whole trick. Because the role is stable, one `text-ink` is correct
in both themes and **no `dark:` prefix is ever needed** — which matters when
the app carries roughly two thousand colour utilities.

| token | role |
| --- | --- |
| `bg-paper` | the page |
| `bg-raised` | a card sitting on the page |
| `bg-sunken` | a well inside a card |
| `border-hairline` | a decorative rule |
| `border-edge` | the boundary of a control — clears 3:1 |
| `text-ink` | primary text |
| `text-ink-strong` | headings |
| `text-ink-muted` | secondary text and placeholders — clears 4.5:1 |
| `text-ink-disabled` | disabled controls **only** |
| `bg-hover` / `bg-press` | interaction overlays, ink at 5% / 9% |

`text-ink-disabled` is the one token that does not meet AA, because WCAG 1.4.3
exempts a disabled control. Using it for placeholder or secondary text is a bug.
A placeholder is text and needs 4.5:1; use `text-ink-muted`.

Values live once each in `app/globals.css` as `--l-*` and `--d-*`. Four
selectors alias `--t-*` onto one set or the other: the default, the OS
preference, an explicit toggle, and `[data-theme-scope="light"]` which pins a
subtree to light. Nothing restates a value, so light and dark cannot drift.

### The gray bridge, and why it is gone

For one release Tailwind's own `gray-*` was redefined warm and theme-aware, so
the two thousand utilities already spread across the app picked up the palette
before any screen was edited. It also corrected three failures that had been
shipping:

| | uses | was | now |
| --- | --- | --- | --- |
| `text-gray-500` | 459 | 4.43:1 | 6.57:1 |
| `text-gray-400` | 11 | 2.33:1 | 5.22:1 |
| `border-gray-300` | 150 | 1.35:1 | 3.36:1 |

They all passed on a white card and failed on the warm page behind it, which is
why nobody noticed: Tailwind's grays are blue, the ground is warm, and the two
were never measured against each other.

Then the bridge came out. `gray-500` could not say whether it meant muted
prose or a placeholder, so every use was rewritten to the semantic names above
and the redefinition was deleted. Tailwind's stock gray is the blue one again,
unmeasured against the warm ground, so a `text-gray-*` in new code is not a
neutral — it is a bug, and it looks like one on the page. **Write against the
semantic names.**

## The primitives a screen does not restate

Each of these existed while a dozen screens typed its markup out by hand, and
each copy drifted from the original in a way a copy does: a heading without
the desktop size step, a link drawn as a button at 40px, a table with no
`scope` on its headers. The rule now is that a screen composes these and does
not restate them.

| for | use | not |
| --- | --- | --- |
| a screen title in the console or registry | `PageHeader tone="neutral"` from `src/components/shell/layout`, with `back` and `actions` | an `<h1>` carrying the class string, a "← Back" paragraph above it |
| a screen title in the portal | `ScreenTitle` from `src/components/portal/screen` | |
| a link that looks like a button | `buttonClasses(variant, size)` on the `<Link>` or `<a>` | a hand-rolled class string — it will be under 44px |
| a button that is working | `<Button pending>` | `disabled` plus a "Saving…" label swap |
| a table | `Table` and its parts, `density="compact"` for a log or a preview | `<table>` — except the two portal tables that fit a phone as they are |
| an empty list | `EmptyState` | a muted paragraph |
| a matter's status, as the firm coloured it | `StatusChip` from `src/components/firm/status-chip` | |

The console wears no firm's colour, so its buttons are `neutral` and `ghost`;
the portal wears the firm's, so its are `primary` and `ghost`.

## Type

Ten sizes, nothing between them: **11, 13, 15, 17, 21, 26, 32, 44, 56, 88**.

`text-11` micro and uppercase labels · `text-13` meta and secondary ·
**`text-15` body, the default** · `text-17` card and section titles ·
`text-21` screen title on a phone · `text-26` screen title on a desktop ·
`text-32` and above, display, landing only.

The landing's own eight-step ramp is a strict subset, so
`design/home/verify.mjs` keeps passing unchanged.

**16px is deliberately not on the ramp.** It is where inputs live, and it is a
platform constraint rather than a typographic choice: a real input under 16px
makes iOS Safari zoom the whole page on focus, and a client filling in an intake
form on a phone should not have to pinch back out after every question. Inputs
stay at `text-base`. Thirty-five files once copy-pasted a field style at 14px
and re-introduced exactly that.

## Shape, depth and motion

Radius: `rounded-chip` 6 · `rounded-control` 9 · `rounded-card` 12 ·
`rounded-sheet` 18. Named rather than `sm/md/lg/xl` because overriding
Tailwind's own scale would silently move existing callers.

Elevation: `shadow-e1` a card · `shadow-e2` a sticky header · `shadow-e3` a
sheet or modal. **A shadow is nearly invisible on a dark ground**, so depth in
dark comes from `bg-raised` sitting above `bg-paper`. Anything elevated must set
both a surface and a shadow, or it will look flat in one theme.

Motion: `duration-fast` 120ms state · `duration-base` 180ms enter and exit ·
`duration-slow` 240ms sheets. `app/globals.css` disables animation globally
under `prefers-reduced-motion`, but it only clamps duration — an animation that
must not simply freeze mid-way needs to be handled explicitly.

## Rules that are not negotiable

- **Tap targets are at least 44×44.** A button's sizes are minimum heights, not
  padding: the thumb does not get more accurate when the button is secondary.
- **Every control shows focus.** A 1px border colour change is not a focus
  indicator. `focus:outline-none` is only acceptable when a wrapper shows
  `focus-within` instead — which is the right pattern for a borderless input
  inside a styled box, and a bug otherwise.
- **Status never uses colour alone.** Every pill and alert carries an icon and a
  label. A reader who cannot separate the six tints still reads the status.
- **Inputs are at least 16px.** See above.
- **Warm, never white.** The ground is `#f6f5f2`, not `#ffffff`.

## What a machine checks, and what it does not

`design/home/verify.mjs` renders the landing artboard and fails on sub-AA text,
a control boundary under 3:1, a size off the ramp, gold used as text anywhere
but on green, a display heading ending on a one-word line, and clipped content.

`tests/fixtures/ergonomics.mjs` checks 44px targets, visible focus, composer
room above the on-screen keyboard, and a draft surviving a resize.
`tests/fixtures/shots.mjs` renders every screen at six viewports and fails on
horizontal overflow. Both run against a stand-in Supabase and prove nothing
whatever about who may see a screen.

**Nobody checks taste.** Rhythm, density, whether a screen reads as one thing or
several — those are review, and they are the part a green run does not cover.

## Dark mode

Authored from the token layer up rather than retrofitted, so every neutral and
status tint has both values from the start.

Two surfaces opt out, each for a stated reason:

- **The platform landing is light only.** Four of the six Nigerian brand-risk
  mitigations in `design/home/README.md` are phrased in terms of a warm light
  ground, and none has an agreed meaning on a dark one. It pins itself with
  `data-theme-scope="light"`. If a dark landing is ever wanted, re-argue all six
  there first.
- **A firm's public site opts in per firm, default off.** In dark the platform
  re-tones the firm's colour on a page the firm considers theirs. The signed-in
  surfaces — the client portal and the staff console — always support dark.

### A tenant's colour in the dark

A firm picks one colour, for a light page. Used raw on a dark ground, navy
`#0F2A44` reads at 1.20:1 — invisible, and `text-brand` appears 205 times.

The colour is lifted by raising HSL lightness only, holding hue and saturation
exactly, until it clears the contrast target. Navy becomes a lighter navy, not a
gray: a plain blend toward off-white also clears the target but desaturates it
to `#748391` and the firm loses its identity.

One lifted value serves both `bg-brand` fills and `text-brand`, because
`readableForeground()` recomputes the foreground against the lifted colour. No
existing utility needed renaming.

A pale fill is the remaining case to watch: pale gold on warm paper is a 1.49:1
boundary, which fails SC 1.4.11 even though the text on it is fine. A filled
control needs its own `border-edge` rather than a darkened fill — darkening it
would change the firm's colour on the firm's own site.
