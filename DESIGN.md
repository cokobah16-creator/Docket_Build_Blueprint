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

### The gray bridge, and why it is temporary

Tailwind's own `gray-*` is redefined warm and theme-aware, so the utilities
already spread across the app pick up the palette without every screen being
edited. It also corrected three failures that had been shipping:

| | uses | was | now |
| --- | --- | --- | --- |
| `text-gray-500` | 459 | 4.43:1 | 6.57:1 |
| `text-gray-400` | 11 | 2.33:1 | 5.22:1 |
| `border-gray-300` | 150 | 1.35:1 | 3.36:1 |

They all passed on a white card and failed on the warm page behind it, which is
why nobody noticed: Tailwind's grays are blue, the ground is warm, and the two
were never measured against each other.

It is a bridge. `gray-500` cannot say whether it means muted prose or a
placeholder, so it is being rewritten to the semantic names above, after which
the bridge is deleted and any straggler becomes a dead class the linter finds.
**Write new code against the semantic names.**

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

Radius: `rounded-chip` 4 · `rounded-control` 6 · `rounded-card` 8 ·
`rounded-sheet` 12. Tight on purpose: records software reads as a tool when
its geometry is close to square. Tailwind's own `rounded-md` (6) and
`rounded-lg` (8) land on this scale. `rounded-full` is for avatars, dots and
switches — not for status labels, tabs or filter chips.

Elevation: `shadow-e1` is **flat** — a panel is bounded by its `border-hairline`
and by `bg-raised` sitting on `bg-paper`, not by a shadow. `shadow-e2` a sticky
header · `shadow-e3` a sheet, a modal or a popover such as the New menu.
**A shadow is nearly invisible on a dark ground**, so depth in dark comes from
the surface step either way.

Motion: `duration-fast` 120ms state · `duration-base` 180ms enter and exit ·
`duration-slow` 240ms sheets. Nothing lifts, scales or glows on hover; a
clickable row changes its background (`bg-hover`) and nothing else.
`app/globals.css` disables animation globally under `prefers-reduced-motion`.

## Patterns

**Card, list or table.** Ask what the information is before reaching for
`Card`. Records with three or more attributes read as a `Table` from `md` up,
with a stacked `<ul>` below `md` (see `app/firm/(console)/matters/page.tsx` and
`tasks/page.tsx`). Facts about one record read as a ruled `<dl>` register (the
matter header, the client's matter summary). A `Card` is for a genuinely
separate object, such as the next appointment.

**Status.** Every status goes through `StatusPill` (appointments, invoices, the
filing and court lifecycle) or `MatterStatusChip` (a firm's own matter stages).
Never hand-roll a coloured span for a status: the same word must look the same
on every screen, and it always carries its label.

**Tabs.** An underlined strip (`border-b-2`), never a row of filled pills.

**Errors.** A person reads what was not done, whether anything was saved, and
what to do next — never Postgres. Server actions go through `userError()`
(`src/lib/user-error.ts`), client components through `userErrorMessage()`, and a
message that travels in `?error=` is shown only through `safeNotice()`.

**Empty states.** `EmptyState` answers what this is, why it is empty and what
to do next. No illustration and no encouragement.

**Icons.** `src/components/ui/icon.tsx` only. An icon helps a reader scan or
identifies an action; it does not decorate a heading. Never an emoji.

**AI.** If assisted features are added, name the task ("Summarise matter",
"Extract parties"), never a generic sparkle or "AI" label.

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
