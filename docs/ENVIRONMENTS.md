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
| Migrations applied | **yes — all 52**, in order. Verified: all eight fingerprints match a local reference built from the same files, `functions` included, which hashes every function body. Migration 50 rehearsed here before production, which is what this project is for |
| `supabase/seed.sql` loaded | **yes** — 1 firm, 14 services, 1 intake form, 15 matter statuses, matching production's counts exactly |
| Edge Functions deployed | **yes — all ten**, each boot-proved over HTTP through a refusal only its own source can produce (`partner-api`'s 405/401/404 quartet against `docs/partner-api.v1.yaml`; `extract-text`'s deliberate 404 to both a missing and a wrong cron secret; `video-session`'s platform 401 *and* its own 405 and 401; `delivery-receipts` on each of its three provider doors). Seven bundle hashes match production exactly. `partner-api` differs by design (`DOCKET_SANDBOX`); `storage-replicate` is new; `paystack-webhook` and `extract-text` differ only because production carries hand-edited comments that are in no commit — see `docs/DEPLOYMENT_RUNBOOK.md` §3a |
| Edge Function secrets set | **no — none of them.** So anything needing one fails on staging: `paystack-webhook` 500s rather than 401s, and nothing that sends or replicates will work until `CRON_SECRET`, the provider keys and the four R2 values are set |
| `DOCKET_SANDBOX=true` on staging | **yes — verified 17 Sep 2026**: `GET /functions/v1/partner-api` answers `"sandbox": true` |
| Auth configured (site URL, redirect allow-list) | not yet — needs `scripts/configure-providers.sh` and a `SUPABASE_ACCESS_TOKEN` |
| Test accounts seeded | **yes — 14 Sep 2026, re-run 17 Sep**, by `scripts/seed-staging-fixtures.mjs`. In place and verified by query: five users; `staging-legal` and `second-staging` active with terms and privacy published at `2026-09`; a client matter, a second matter the client has no claim on, and a third at the second firm; the client a party with `can_view_docs`; the client's consent to both firms' current terms and privacy (four `consent_records` rows — without them the portal shows the consent gate in place of every page, which is how the first journeys run failed); one message; and one document whose stored bytes hash to exactly the checksum recorded against them. The staff owner's TOTP secret is printed by the script once; **re-run with `FIXTURE_STAFF_TOTP_SECRET` set to it** and the factor is kept, or it is replaced and the journeys go red until GitHub holds the new value |
| GitHub repository secrets set | **yes — all ten**, and the `journeys` job runs on every push. One of them, `E2E_STAFF_TOTP_SECRET`, is stale as of 17 Sep 2026 (the fixture was re-run twice without the secret and rotated it); until it is updated to the value the script last printed, the two staff-side journeys fail at the MFA challenge |

Nothing in the journeys skips any more: a missing row above is a red run that says what it lacks. As of 17 Sep 2026 five of the seven pass; the two that sign staff in wait on the secret above.

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

### One expected data difference, so nobody chases it

Staging's `firms.brand` and `firms.policies` differ from production's even though both came from the
same `supabase/seed.sql`, and neither is wrong. `validate_brand()` (migration 13) is an allow-list
normaliser: it lowercases hex colours and drops a `contact` whose values are all null, and the
`firms_brand` trigger applies it on insert. Staging was seeded *after* all 52 migrations, so its row
is normalised — `#0f2a44`, no `contact` key. Production's firm row was inserted before migration 13
existed, so it kept `#0F2A44` and an all-null `contact`, and `firms_policies` (migration 20) did not
touch it either.

Both represent the same thing. The consequence worth knowing is that **the first update of
production's `brand` column will silently normalise it** — the values are equivalent, but a diff
taken before and after will show a change nobody made deliberately.

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
