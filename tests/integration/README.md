# Authenticated user journeys

`tests/e2e/smoke.spec.ts` covers public pages. Its own CI comment says it plainly:
"These tests only read public pages. They sign nobody in and write nothing."

This folder covers the other half — the journeys that only exist once somebody is
signed in, and the one that matters most, which is a person **not** being able to
read what is not theirs.

## Status: UNVERIFIED

`journeys.spec.ts` has never been executed. It was written in an environment with
no Supabase project to run it against, and every test in it is guarded to SKIP
when its configuration is absent. **A skip is not a pass.** Until a run reports
these as passed, nothing in this folder is evidence about the application — it is
a specification of the journeys, written in executable form so it runs the moment
configuration exists.

Why it could not be verified here, established by running the commands:

| Route to a real stack | Result |
| --- | --- |
| Local Postgres | **Works.** Cluster 16/main starts; the repo's whole SQL suite passes (31 suites, 1447 checks). But it is bare Postgres — no GoTrue, so no sign-in, no password, no OTP, no `aal2`. |
| `supabase start` (local stack) | **Blocked.** The CLI installs (npm reaches the registry) and the Docker daemon starts, but image layers are refused by the egress proxy: `production.cloudfront.docker.com … Forbidden`. Zero images can be pulled, so the stack cannot come up. |
| The hosted project | **Exists but unusable for this.** `Docket_Build_Blueprint` (`xgxuwimcxkpgtfkunwfe`) is ACTIVE_HEALTHY and its 51 applied migrations match `supabase/migrations/` exactly. It holds 1 firm, 1 firm member, and **0 matters, 0 messages, 0 documents** — nothing to sign in as and nothing to read. Seeding it would be a live database change. |
| The mock at `tests/fixtures/supabase-mock.mjs` | **Proves nothing here, by design.** Its own header: "It does not implement RLS, and it does not check the session against anything — it hands out a user because it was asked … Authorization is the database's, and only a real project can demonstrate it." It returns a fixed `aal2` session to any `/auth/v1/token` request, so every test below would pass against it whether or not authentication worked. |

## The journeys

1. **Client sign-in** — phone OTP at `/app/login`: `signInWithOtp({ phone })` then
   `verifyOtp({ phone, token, type: "sms" })`. Asserts the resulting token is one
   PostgREST accepts, not merely that a page changed.
2. **Staff sign-in with MFA** — email + password at `/firm/login`, then the TOTP
   challenge. Asserts `aal` is `aal2` **in the JWT**, because that claim is what
   the console layout and every staff-write policy key off.
3. **Navigation** — each primary portal destination renders for a signed-in
   client and does not bounce back to sign-in.
4. **Messaging** — a client opens a thread, posts a message, and it survives a
   reload (so it is the database's row, not optimistic UI).
5. **Document access** — a client opens a document on their own matter.
   `open_document_version()` must write a `document_reads` row before storage
   releases the bytes, so a 2xx is the whole policy chain working.
6. **Firm switching** — a client several firms act for switches between them and
   the choice survives a reload.
7. **Denial of access to another firm's restricted records** — asserted at
   **PostgREST with the client's own token**, not at the UI. A screen that hides
   a row says nothing about who may read it. Checks `matters` and then `messages`,
   `documents`, `updates`, `invoices` by the same foreign key, because a policy
   can be right on the parent and wrong on what hangs off it. The UI check is
   the last of the three, not the only one.

   **It now runs three positive controls first**, because every assertion in it
   passes by reading zero rows and there are three uninteresting ways to read
   zero rows. (i) The same query, same table, same headers, returns the client's
   *own* matters — so the request shape and the session are known good. (ii) The
   id under test is not one of the client's own, which would invert the test.
   (iii) The id names a row that really exists: the staff account is asked to
   read it, and if it cannot, the test **fails** rather than passing on a typo.
   A deleted or mistyped matter id behaves exactly like a wall — zero rows,
   "not found" in the UI, green all the way — and that is the failure this file
   exists to make impossible.

## What a person must supply

Nothing in this list can be inferred, and none of it exists in the repository.

### A project

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for a project whose
schema matches `supabase/migrations/`, with the app under test built against that
same pair. **Not a project any firm is using** — these tests read real matters and
post a message.

### Accounts, seeded and reachable

- **A client** with at least one matter at the firm named by `E2E_FIRM_SLUG`, and
  on that matter at least one message thread and one document version.
- **A second firm** that also acts for that same client, for journey 6.
- **A firm member** (a `firm_members` row) with **TOTP already enrolled**, and the
  base32 secret kept from enrolment. The secret cannot be recovered afterwards —
  if it was not kept, enrol again at `/firm/security/mfa` and keep it this time.
- **A matter for journey 7 that the client has no claim on but the STAFF account
  can see** — that is, a matter at the staff member's own firm to which the
  client is not a party. Both halves matter: the client's zero rows prove the
  wall, and the staff account being able to read the same row proves there was a
  row to be refused. The test enforces both, so a mistyped or since-deleted id
  now fails loudly instead of passing green.

  A matter at some unrelated third firm also works as far as the client is
  concerned, but nothing can then vouch that it exists, and the test says so.
  It is also the weaker choice: cross-firm isolation is already asserted 66
  times in `supabase/tests/10_rls_isolation.sql`, whereas the within-firm party
  wall is only ever exercised here.

### A way to sign in without a human

Staff are email + password, so a password is enough. **Clients are OTP only** —
there is no client password anywhere in this application. So one of:

- configure **test OTPs** on the project (Auth → Providers → Phone → test phone
  numbers: a fixed number mapped to a fixed six-digit code) and set
  `E2E_CLIENT_PHONE` / `E2E_CLIENT_OTP` to that pair; **or**
- give the runner mailbox access and rewrite journey 1 around the email magic
  link, which `sign-in-forms.tsx` also offers.

A service-role key is *not* wanted here and must not be supplied: these journeys
are meaningful only because they run as the person, under RLS.

### The variables

```sh
export PLAYWRIGHT_BASE_URL=https://<the deployment under test>
export NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>
export E2E_FIRM_SLUG=<slug of an ACTIVE firm in that project>

export E2E_CLIENT_PHONE=+234...        # a test phone number configured on the project
export E2E_CLIENT_OTP=123456           # the fixed code mapped to it

export E2E_STAFF_EMAIL=<firm member's email>
export E2E_STAFF_PASSWORD=<their password>
export E2E_STAFF_TOTP_SECRET=<base32 secret from enrolment>

export E2E_SECOND_FIRM_NAME="<name of a second firm acting for the client>"
export E2E_FORBIDDEN_MATTER_ID=<uuid of a matter the client is not a party to but the staff account can read>
```

## Commands

```sh
npx playwright test --config tests/integration/playwright.config.ts
```

A separate config because the root `playwright.config.ts` pins `testDir` to
`./tests/e2e` and Playwright has no CLI flag to override it.

One journey at a time:

```sh
npx playwright test --config tests/integration/playwright.config.ts -g "cannot read another firm"
```

In a sandbox whose Chromium is pre-installed and whose download is forbidden:

```sh
PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  npx playwright test --config tests/integration/playwright.config.ts
```

**Read the summary line.** `7 skipped` means the configuration above is missing
and the journeys remain unverified. Only `7 passed` is evidence.

## The SQL suite, which is verified

Separately from all of the above, the repository's own RLS tests **do** run here,
against a bare Postgres 16, and they pass:

```sh
pg_ctlcluster 16 main start
DATABASE_URL=postgres://postgres:<pw>@localhost:5432/postgres npm run db:test:local
# 31 suites, 1447 checks, ALL CHECKS PASSED
```

`supabase/tests/00_local_auth_stub.sql` supplies the `auth` schema, the
`anon`/`authenticated`/`service_role` roles and `auth.uid()`, so the policies can
be exercised without Supabase. That covers **authorization** thoroughly — it is
where the RLS guarantees are actually tested, and it is why journey 7 above is a
second opinion rather than the only one.

What it cannot cover is **authentication**: those tests reach `auth.uid()` by
`set_config('request.jwt.claims', …)`, so no password is ever checked, no OTP is
ever sent, no TOTP is ever verified and no JWT is ever signed. The journeys in
this folder are the only thing that would cover the join between a real sign-in
and those policies.
