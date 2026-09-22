# Product and UX audit — September 2026

What the three Docket experiences (firm workspace, client portal, court registry) looked like
before the transformation pass on `claude/docket-product-uiux-transformation-q11r7i`, what the pass
changed, and what is still open. Each open item names the work it needs.

The backend is mature: 52 migrations, row-level security on every table, 31 SQL suites with
1,416 checks, and audited RPCs for every state change. This pass is almost entirely presentation,
information architecture and copy. It changed no migration and no RLS policy.

## 1. What exists and was kept

| Area | State | Notes |
| --- | --- | --- |
| Multi-tenant schema, RLS, audited RPCs | Kept as is | The authorization layer. No UI change relies on hiding anything. |
| Staff auth: password + TOTP (aal2) gate on the console and registry | Kept | Enforced in both layouts and by `staff_w()` in the database. |
| Client auth: phone OTP, email magic link, Google | Kept; copy fixed | See §3. |
| Token layer (`--t-*`, light and dark, AA-checked) | Kept; values tightened | Radii, card shadow. See `DESIGN.md`. |
| Primitives: Button, Input, Alert, Modal, Toast, Switch, dialog behaviour | Kept | Already careful about focus, `aria-busy` and 44px targets. |
| Line-icon set (`src/components/ui/icon.tsx`) | Kept | No Lucide and no sparkle icons anywhere. |
| Nav model (one list, arranged as sidebar / rail / bottom bar) | Kept; regrouped | See §2. |
| Matter workbench tabs and panels (timeline, documents, parties, conflicts, deadlines, counsel, collaboration, invoices) | Kept | Business logic untouched. |
| Global search (`search_docket`, SECURITY INVOKER) | Kept; now reachable | Was not in the nav and the command bar did not use it. |

## 2. What was redesigned or restructured in this pass

**Design system.**
- Radii tightened to 4, 6, 8 and 12. `rounded-lg` and `rounded-md` now fall on the scale.
- Panels are bounded by a border; `shadow-e1` is flat.
- Status labels are square-cornered.
- `StatusPill` gained the filing and court lifecycle: ready, submitted, received, under review, accepted, rejected, correction required, filed, scheduled, archived, urgent and confidential.
- One `MatterStatusChip` replaced three copies of a pastel Tailwind table. The same firm status is now the same colour on every page, and the label always carries the meaning.
- `Table` is denser, has a header band, and takes an optional caption.
- `EmptyState` says what the thing is, why it is empty and what to do next.
- `UpdateKindMark` replaced two tables of emoji used as timeline icons.

**Firm workspace.**
- The command bar searches every kind of record through `search_docket`, instead of only matter titles.
- A single **New** menu (`QuickActions`) replaced scattered create buttons. Every entry opens a real screen.
- The nav is grouped into Practice, Firm and You. Destinations are named for what they are: Search, Court diary, Billing, Reports, Firm settings. The phone's four thumbs are Today, Matters, Court diary and Messages.
- The **Matters** list is a register table: matter, client, suit number and court, lawyer, status, next hearing, next action.
  - It has saved views (All, My matters, Open, Upcoming hearings, Actions due) and sorting.
  - Phones get a stacked list instead of a table scrolled sideways.
- The **matter** header is a ruled facts register: client, suit number, court and division, judge, practice area, handling lawyer, next hearing, next action, latest client update, messages, outstanding balance and date opened.
  - It replaced seven lines of prose and a duplicate set of tiles.
  - Tabs are an underlined strip, ordered as a file is worked: Overview, Timeline, Parties, Documents, Hearings & deadlines, Tasks, Messages, Billing, Counsel, Working with, Details.
- **Today**: six counter tiles became one work-queue list.
- **Tasks** is a table with status, assignee and due date, plus a stacked list on phones.
- **Reports**: the tiles open the queue they count (five went to the bare matters list), and emoji are gone.

**Client portal.**
- **Home** opens on *Needs your attention*: a live call, something the lawyer asked for, money owed and unread notifications. When there is nothing, it says so in a sentence.
  - Then each matter shows its status, latest update, what happens next, next court date and lawyer.
  - The permanent **Join** tile now appears only while a call is open.
- The **matter** page leads with the same register and shows a banner when the lawyer needs something.
- The portal no longer selects `matters.description` or `matters.next_action`, which are the firm's working notes. "What happens next" comes from the lawyer's `next_step` on the latest client-visible update.

**Court registry.**
- The console is a registry workspace:
  - a queue summary
  - the cause list as a table for each sitting day, with a suit-number search
  - staged batches
  - withdrawals, with who, when and why
  - registry staff
  - an **audit trail**. The RLS policy for it had shipped in migration 49 but no screen read it.

**Authentication.** See §3.

**Errors.**
- Client portal server actions and uploads no longer surface Postgres, PostgREST or Storage text. `userError()` reports the detail to Sentry and returns a sentence saying what was not saved and what to do next.
- `?error=` is displayed only when it matches a sentence Docket wrote, word for word (`safeNotice()`).
- 34 screens told lawyers and clients to read `.env.example`. They now say the page is unavailable; the developer hint stays outside production.

**Public pages.**
- The landing page:
  - dropped the tilted fake screenshot, the background grids, the radial glow and the blurred header
  - dropped a real government body that had been used in an invented case
  - dropped the numbered three-column rows
  - now describes what firms, clients and registries can each do today, the security controls actually built (no certification is claimed), and pricing as it stands
- Firm sites stopped inventing an About page and dropped "let the firm match you", which booking does not support.

## 3. Authentication findings

| Finding | Fixed? |
| --- | --- |
| After an email sign-in, the panel said "we sent a sign-in link **and a 6-digit code**". A first-time address receives Supabase's *confirmation* email, which has the link only, and so does any project that has not run `scripts/configure-providers.sh`. For every new client, the screen promised a code that never arrived. | Yes. The panel promises the link and offers the code only "if the email also shows one". The resend button says "Send a new link". |
| The expired-link message told staff to "type the code from the same email". Staff reset emails carry no code, and the staff login has no code field. | Yes |
| The sign-in frame showed slogans on a decorative grid. | Yes. It now explains, step by step, what each sign-in method will do. |

## 4. Open items, in priority order

1. **A client can read the whole `matters` row through the API.** `matters_select` gives a matter party every column, including `description`, `judge`, `next_action` and `legacy_reference`.
   - The portal no longer *requests* them, but the REST API still *returns* them to a client who asks.
   - Column grants cannot fix this, because staff and clients share the `authenticated` role.
   - **Needs:** a `client_matters` view, or a SECURITY DEFINER read function, exposing only client-safe columns. The party arm of `matters_select` then moves off the base table, and `portal-data.ts`, `search_docket` and the RLS suite (`95_matter_walls.sql`, `10_rls_isolation.sql`) change with it. This is a migration plus test work; it was not done blind here.
2. **Matter messages have no internal flag.** Every message on a matter is visible to every party on it, so staff must never use matter messages for internal discussion.
   - **Needs:** either an explicit "internal notes" surface (the timeline already has internal updates) or an `internal` column with RLS.
3. **Staff-side server actions still return database text.** About 120 sites across `src/lib/actions/*` do this. It is deliberate in places (the header of `registry.ts` says so), and staff are the audience. Most RPC messages are terse developer phrases ("slot unavailable").
   - **Needs:** migrate these onto `userError()`, one action file at a time, keeping the authored refusals that are already sentences.
4. **There is no filing workflow.** Docket has no e-filing. The registry is a one-way cause-list publisher, and the court case, order and judgment entities do not exist. `StatusPill` now has the filing lifecycle vocabulary ready, but no screen claims a filing capability.
   - **Needs:** a schema design for filings, court cases and orders before any UI.
5. **Calendar views.** The court diary is a grouped list; there are no month or week grids.
   - **Needs:** a calendar component built on `firm_cause_list`, `firm_deadlines` and appointments. It should mark each entry's kind with a text label, not colour alone.
6. **The document module is per-matter only.** There is no firm-wide documents screen apart from Client uploads and the admin document settings. Documents appear in global search.
   - **Needs:** a `/firm/documents` table over `documents`, with type, size, uploader, dates, matter and client visibility.
7. **Remaining card lists.** The clients, invoices, appointments and messages lists still use the older card-row layout with some hard-coded hex colours.
   - **Needs:** the same move the matters list and tasks made, onto `Table`, the stacked phone list and semantic tokens.
8. **Staff console dark mode.** The console still pins itself to light (`data-theme-scope="light"`), as `DESIGN.md` records.

## 5. Placeholder or demo content

- The landing page's matter register is labelled **sample data** on the page. It uses invented names and suit numbers, and no real body.
- No testimonials, logos, customer counts or productivity figures appear anywhere.
- The firm site's About page now says plainly when the firm has not written one.

## 6. How this pass was verified

- The npm registry is blocked in the authoring environment, so nothing could be built or rendered locally.
- Every commit was pushed and checked by CI, which covers TypeScript, a real `next build` checked against the CSP route policy, the migrations with the full RLS suite, main's suite against this schema, the Edge Function checks and the mobile Playwright smoke run.
- The design fixtures in `tests/fixtures/` (contrast, radius scale, 44px targets, overflow) need a running app with the stand-in Supabase. They should be run before merge; `RADII` in `design.mjs` was updated to the new scale.
