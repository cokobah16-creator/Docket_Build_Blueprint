# The environments — which project is which, and what may point at each

*13 September 2026. Until today Docket had one Supabase project and no way to exercise anything
against a database that was not somebody's production. This says what exists now, what each thing
is for, and the two rules that must not be bent.*

---

## Status, 13 September 2026

Staging was created today and is **being provisioned as this is written**. What is true right now,
so nobody reads the table below as a description of a finished thing:

| | Done |
|---|---|
| Project created (`wtfxbmrrpwdbyrspeeka`, `us-east-2`) | yes |
| Migrations applied | **in progress** — the full set of 51, in order, verified afterwards by the eight-fingerprint comparison described below |
| `supabase/seed.sql` loaded | not yet |
| Edge Functions deployed | not yet |
| Auth configured (site URL, redirect allow-list) | not yet — needs `scripts/configure-providers.sh` and a `SUPABASE_ACCESS_TOKEN` |
| Test accounts seeded | not yet — see `tests/integration/README.md` for what the journeys need |
| GitHub repository secrets set | not yet — only a person can write those |

Until every row says yes, the authenticated journeys still skip and a skip is still not a pass.

## The two projects

| | **Production** | **Staging** |
|---|---|---|
| Name | `Docket_Build_Blueprint` | `Docket_Staging` |
| Ref | `xgxuwimcxkpgtfkunwfe` | `wtfxbmrrpwdbyrspeeka` |
| URL | `https://xgxuwimcxkpgtfkunwfe.supabase.co` | `https://wtfxbmrrpwdbyrspeeka.supabase.co` |
| Region | `us-east-2` | `us-east-2` — deliberately the same, so latency and behaviour match |
| Created | 10 Sep 2026 | 13 Sep 2026 |
| Holds | real firms and, in time, real client matters | seed data and test accounts only |
| PITR | off, by dated decision — RPO is 24 hours (`docs/RESTORE_RUNBOOK.md`) | off, and it does not matter |
| Cost | — | $10/month |

Both live in organisation `nldoibjkfdvueggiayoo`.

**Staging is the same region as production on purpose.** A staging project in a different region
would quietly differ in round-trip latency, which is exactly the sort of difference that makes a
timing-sensitive test pass in one place and fail in the other.

## What staging is for

Three things were each blocked on there being a second environment, and all three named it:

1. **The authenticated journeys.** `tests/integration/journeys.spec.ts` signs real people in and
   reads real rows. Its own README says: *"Not a project any firm is using."* Until today there was
   nowhere else to point it.
2. **The restore drill.** `docs/RESTORE_RUNBOOK.md` §4: *"An untested backup is a belief. Once a
   quarter, on a scratch Supabase project…"* There was no scratch project, and the drill has never run.
3. **The partner-API sandbox.** `docs/PARTNER_API.md` and
   `supabase/functions/partner-api/index.ts` both say, in as many words, that there is no sandbox
   because *"a sandbox is a second environment with its own data, and Docket has no staging project
   yet"*. That sentence is now out of date in its reason, and stays true in its fact until a
   sandbox is actually stood up on staging and given its own keys — **it is not one yet**.

It is also the rehearsal target for migration 50 and everything after it. Production spent three
merges running ahead of its own schema in September because nothing applied migrations anywhere
before they went live.

## The two rules

**1. The production service-role key never leaves Supabase's own secret store.** It is set with
`supabase secrets set` for the Edge Functions that need it and it goes nowhere else — not into
Vercel, not into GitHub Actions, not into a developer's shell profile. The wider law it serves is
stated at the top of every function that uses one — *"the service role belongs in
supabase/functions and nowhere else in this codebase"*
(`supabase/functions/partner-api/index.ts`) — so no key in `app/` or `src/` under any name.

STAGING's service-role key is a different matter and may be given to the test runner, because the
authenticated journeys have to create and tear down accounts. That is a considered exception with a
boundary: `tests/` is neither `app/` nor `src/`, the project holds no real client data, and the key
is scoped to a database nobody's practice depends on. It is not a precedent for production.

**2. No test ever points at production.** Not the Playwright journeys, not the layout fixtures, not
a drill. `tests/integration/journeys.spec.ts` posts a message and writes a `document_reads` row
merely by running; `shots.mjs` walks every screen. Both are harmless against staging and neither
belongs anywhere near a firm's matters. If a run needs `NEXT_PUBLIC_SUPABASE_URL`, it gets
staging's.

## Keeping the two in step

Staging is only useful while it is a faithful copy. The check is structural rather than a feeling:
eight fingerprints over the `public` schema — relations, columns, functions, policies, triggers,
indexes, constraints, and the grants held by `anon`, `authenticated` and `service_role` — compared
between the two projects and against a reference built locally from the migration files. Extension
-owned objects are excluded, because a local Postgres puts `btree_gist`, `pgcrypto` and `pg_trgm`
into `public` while Supabase puts them in `extensions`; that is packaging, not schema.

One difference is known and expected: seven functions first applied by migrations 18–21
(`rate_limit_hit`, `validate_policies`, `validate_notification_templates`, `set_member_role`,
`set_firm_domain`, `create_invoice`, `invite_matter_party`) carry no SQL comments in production.
Comment-stripped and whitespace-normalised, all seven are identical character for character to the
repository's copies, and their signatures match. It is recorded in `docs/DEPLOYMENT_RUNBOOK.md` and
is not a defect.

`.github/workflows/live-schema-drift.yml` watches PRODUCTION daily for the other kind of drift —
code naming something the database does not have, and migrations in the repository that were never
applied. See runbook §0c for the one secret it needs.

## Rebuilding staging from nothing

The migrations are the definition; nothing about staging is hand-made. From a checkout, against an
empty project:

```bash
supabase link --project-ref wtfxbmrrpwdbyrspeeka
supabase db push                       # every migration in supabase/migrations, in order
psql "$STAGING_DB_URL" -f supabase/seed.sql
```

`supabase/seed.sql` is idempotent on the firm slug and touches no `auth` table, so it is safe to run
against a real project and reproduces tenant #1 exactly as a firm owner would have entered it.

## Related

- `docs/DEPLOYMENT_RUNBOOK.md` — standing a deployment up, and the release record
- `docs/RESTORE_RUNBOOK.md` — what a backup covers, and the drill staging exists to make possible
- `tests/integration/README.md` — the authenticated journeys and the accounts they need
- `tests/fixtures/README.md` — the layout fixtures, which prove nothing about authorisation and say so
