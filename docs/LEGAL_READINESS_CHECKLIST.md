# Legal readiness checklist

*Audited 24 September 2026 against `main` at `fe0f2a2`. This checklist is not legal advice. It sits beside the [compliance pack](./COMPLIANCE_PACK.md), which records what the system does with personal data. Have a qualified Nigerian lawyer review every notice, term and agreement before relying on it.*

This checklist takes a common list of 20 things an app should do so it doesn't get sued, and checks each one against Docket as it is today. For each item it says where Docket stands, what to change and in which files, how to prove the change works, and what has to be decided first.

The findings were produced by reading the code, then checked a second time by opening every cited file. Line numbers are correct as of the commit above and will drift as the code changes.

Docket has two kinds of controller to serve. Each firm controls its clients' data, and Docket controls at least the accounts and its own visitor cookie (`COMPLIANCE_PACK.md:15-18`, still a working assumption). Several items below therefore need both a platform-level fix and something a firm fills in as data, never as code.

## Progress

*Updated 25 September 2026.* Some of the fixes that need no business or legal decision are now in the code, listed below. Others are still open. Examples: item 4's sign-out steps (5 to 7), item 5 step 15, item 7 steps 3 and 14 to 16, item 12 steps 3 and 4, and item 15. Items 1, 5, 6, 7, 10, 12 and 16 each have a **Done in the code** paragraph that says which steps are done and which remain. Item 3 step 13 is done too, as item 12 steps 6 and 7.

| Change | Items | Where |
|---|---|---|
| Firm policy text rendered, and the gate always links a page | 1, 6 | Lane dF, merge `42180c4`, in PR #40 |
| False video, message and guide claims removed | 12 | Lane dF, merge `42180c4`, in PR #40 |
| Analytics only with consent, cookie banner and settings control, `matter_opened` dropped | 5, 7 | Lane dE, merge `14c8fd0`, in PR #40 |
| VAT-inclusive totals, money claims removed, migration `051` | 10, 12, 16 | Lane dD, merge `4a11f82` |
| Booking consent on the review step, `record_consent()` in migration `052` | 6 | Lane dD, merge `4a11f82` |
| Sign-in panel repaired. A bad merge (`6147a96`, which reached `main` in PR #36) broke Typecheck and Build. CI passes with these commits, and `main` stays red until they land | none | `3a6bd85`, `92b0088` |
| Tenant sites and booking keep working if the app deploys before `051` or `052` | 6, 10 | `f9f7681` |
| A policy version needs text, a link or a page; the review step and gate link the same document | 1, 6 | `aa75837` |

Still waiting on a decision:
- the controller structure and the platform entity (items 1, 2, 4, 16, 19)
- the refund rule and late payments (items 3, 10)
- `transaction_charge` and the processing margin (items 10, 12)
- tenant fonts (item 5)
- two-way SMS (item 18)

Still waiting on a deployment: `053`, the enforcement pass for item 6, which follows once `052` and the app that calls `record_consent()` are live.

## Status at a glance

**P0** means live exposure today: someone's data or money is affected now, or a required disclosure is missing. **P1** means before public launch or the next release. **P2** is hygiene. Effort is **S** for under half a day, **M** for one to two days and **L** for more. 8 items are P0, 8 are P1 and 4 are P2.

| # | Item | Status | Priority | Effort |
|---|---|---|---|---|
| 1 | [Add a privacy policy](#1-add-a-privacy-policy) | Partial | P0 | M |
| 2 | [Add terms of service](#2-add-terms-of-service) | Partial | P0 | L |
| 3 | [Add a refund policy](#3-add-a-refund-policy) | Partial | P0 | M |
| 4 | [Add a cookie policy](#4-add-a-cookie-policy) | Missing | P1 | M |
| 5 | [Add a cookie consent banner](#5-add-a-cookie-consent-banner) | Partial (was Missing) | P0 | L |
| 6 | [Check your form consents](#6-check-your-form-consents) | Partial | P0 | L |
| 7 | [Don't collect unnecessary data](#7-dont-collect-unnecessary-data) | Partial | P0 | M |
| 8 | [Audit your third-party SDKs](#8-audit-your-third-party-sdks) | Partial | P1 | M |
| 9 | [Remove dark patterns](#9-remove-dark-patterns) | Partial | P1 | M |
| 10 | [Remove hidden fees](#10-remove-hidden-fees) | Partial | P0 | M |
| 11 | [Remove fake reviews](#11-remove-fake-reviews) | Partial | P2 | M |
| 12 | [Remove unsupported claims](#12-remove-unsupported-claims) | Partial | P0 | M |
| 13 | [Add accessibility alt text](#13-add-accessibility-alt-text) | Partial | P2 | M |
| 14 | [Fix your color contrast ratio](#14-fix-your-color-contrast-ratio) | Partial | P1 | L |
| 15 | [Add keyboard navigation](#15-add-keyboard-navigation) | Partial | P2 | L |
| 16 | [Add your business details](#16-add-your-business-details) | Partial | P1 | M |
| 17 | [Get age consent if you collect kids' data](#17-get-age-consent-if-you-collect-kids-data) | Missing | P1 | L |
| 18 | [Add an unsubscribe link to your emails](#18-add-an-unsubscribe-link-to-your-emails) | Partial | P1 | L |
| 19 | [License any fonts and images you use](#19-license-any-fonts-and-images-you-use) | Partial | P2 | M |
| 20 | [Add a data deletion request option](#20-add-a-data-deletion-request-option) | Partial | P1 | L |

## The 20 items

### 1. Add a privacy policy

**Status:** partial · **Priority:** P0 · **Effort:** M

**Where it stands.** Each firm site has a privacy route (`app/(public)/[firm]/privacy/page.tsx:8`), and the tenant footer links to it (`app/(public)/[firm]/layout.tsx:157`). `PolicyPage` never renders the `policies.privacy.text` that settings saves, so a firm with no URL shows a placeholder (`app/(public)/[firm]/_components/policy-page.tsx:26-46`, `src/lib/actions/firm-settings.ts:731-739`). The portal consent gate links the notice only when an external URL is set (`app/app/(portal)/layout.tsx:83-84`). Docket has no notice of its own. `AuthFrame`, the landing footer and firm sign-up link to nothing (`src/components/auth/auth-frame.tsx:88-93`, `app/page.tsx:280-312`, `app/firm/(auth)/start/firm-start.tsx:157-162`). Tenant #1's notice is still `0-draft` (`supabase/seed.sql:37`).

**How to add it.**
1. In `policy-page.tsx`, render `policy.text` with `ContentBody` (`page-shell.tsx:27`) when no CMS page exists and the version does not start with `0-`.
2. In the same file, hide the `Version 0-…` intro (line 25) for drafts. Reword lines 39-40 to say that consent is recorded when the client first opens the portal.
3. In `app/app/(portal)/layout.tsx:83-84`, fall back to `/${firm.slug}/privacy` and `/${firm.slug}/terms` when the URL is null.
4. Add one row per recipient to `src/lib/subprocessors.json` (new, defined in item 8): data sent, purpose, region and source file. Start from `docs/COMPLIANCE_PACK.md:231-242`. Then add Google OAuth (`src/components/auth/sign-in-forms.tsx:642`), Google Fonts (`src/lib/brand.ts:356`, `app/firm/(console)/layout.tsx:44`), Twilio WhatsApp codes (`scripts/configure-providers.sh:148`) and the Vercel Domains API (`src/lib/providers/domains/vercel.ts:23`).
5. In the same file, list the other recipients: firms reached through service of process and collaboration (migrations `20260910000011` and `20260910000045`), delegated representatives (`20260910000044`), `partner-webhooks` endpoints and `calendar-feed` subscribers.
6. Create `app/docket/privacy/page.tsx` (new) with `export const dynamic = "force-dynamic"`, as `src/lib/csp.ts:74` asks. Build it from `src/lib/subprocessors.ts`, the typed wrapper item 8 adds. Cover data categories (COMPLIANCE_PACK §1), purposes, recipients and transfers abroad (the Supabase region, and PostHog EU at `posthog.ts:14`). Also cover the one-year visitor cookie (`middleware.ts:171-178`), retention as the manual process in §5, rights through the §6 runbook, and the contact. Cover clients, staff, firm owners and registry users (`20260910000049`). Take the version from `PLATFORM_PRIVACY_VERSION` in `src/lib/legal/platform.ts` (new, item 2), and read the entity and contact from env or a config row.
7. Add `"/docket"` to `APP_PREFIXES` (`middleware.ts:53`) so tenant hosts do not rewrite it. `docket` is already a reserved slug (`20260910000009_platform_firms.sql:141-142`), so no migration is needed.
8. Link `/docket/privacy` from the `AuthFrame` footer. That footer serves every sign-in and sign-up page under `/app` and `/firm`.
9. Link it from the landing footer (`app/page.tsx:280-312`).
10. Link it next to the `acceptFirmAgreement` and `acceptDpa` checkboxes that item 2 puts in place of the sentence at `firm-start.tsx:158-162`.
11. Beside `SignInForms` (`booking-wizard.tsx:535`), link `/{slug}/privacy` and `/docket/privacy`.
12. Add a "Docket privacy" link next to the firm's own link (`app/(public)/[firm]/layout.tsx:157`).
13. Add `/docket/privacy` to the platform branch of `app/sitemap.ts:15`. Add it to `tests/fixtures/design.mjs` after line 220.
14. Update `docs/COMPLIANCE_PACK.md` §4 from `src/lib/subprocessors.json`.
15. Publish tenant #1's notice through `/firm/admin/settings`, not through `seed.sql`.

**Done in the code (lane dF, merge `42180c4` in PR #40; the last three points below in `aa75837`).** Steps 1 to 3 are done, for the terms page as well as the privacy page.
- `PolicyPage` renders the text a firm saves once its version is published, and a link given alongside it is shown beneath.
- A `0-` draft is skipped, and so is the seeded holding sentence "To be published by the firm before go-live."
- The placeholder says the version is accepted when the client books online or first opens the portal.
- The portal consent gate and the booking review step link the same document (`policyDocumentHref` in `src/lib/policy-text.ts`). They use the firm's URL when one is set. Otherwise they link the firm's own `/{slug}/terms` and `/{slug}/privacy` page on the current host. In production, when the portal is open on another firm's host, the gate uses the firm's own address instead.
- Settings refuses to publish a version with no text, no link and no published page. The check runs only when settings saves. The database does not enforce it, and the gate and the review step do not check again. So a version saved before this check, a version written outside settings, or a version whose page is later unpublished can still ask a client to accept a document they cannot read.

Steps 4 to 15, Docket's own notice and its links, wait on the controller and entity decisions. The exception is the firm half of step 11. Once the firm has published, the booking review step that holds `SignInForms` links the firm's privacy notice from its consent box. Only the `/docket/privacy` link is left.

**How to check it.**
- Extend `tests/e2e/smoke.spec.ts`. On `/`, `/app/login`, `/firm/start` and `/{slug}/book`, a privacy link must exist and return 200.
- Add `text` to the mock privacy policy (`tests/fixtures/supabase-mock.mjs:83`), then run `npm run test:design`. `site-privacy` must show that text.
- Run `node scripts/check-prerendered-routes.mjs build.log` (`ci.yml:383`).
- Manual: on a custom domain, `/docket/privacy` renders, and the gate's privacy link opens.
- Tenant #1 must not appear in the query at `docs/COMPLIANCE_PACK.md:471`.

**Decision needed.** The owner and a lawyer must settle the controller structure (`docs/COMPLIANCE_PACK.md:450-452`). The pack proposes Docket as the controller of accounts (`:17`). Blueprint §10 says each firm is the controller and Docket the processor (`Docket_Build_Blueprint_v0.2.md:439`). They must also name the legal entity, the Supabase region (`:33`), the retention periods (`:34`) and the DPO or contact (`:458-459`).

**Risk if left.** Docket and every firm collect identity, contact, payment and analytics data without a notice that names processors, transfers abroad, retention and rights, which exposes them to NDPC enforcement and fines under NDPA 2023 s.27 and the NDPC GAID. Not legal advice.

### 2. Add terms of service

**Status:** partial · **Priority:** P0 · **Effort:** L

**Where it stands.** Each firm has a terms page (`app/(public)/[firm]/terms/page.tsx:8`), and the portal gate records `terms` and `privacy` rows per firm (`app/app/(portal)/layout.tsx:42-88`). Docket has no terms, firm agreement or DPA of its own. `app/firm/(auth)/start/firm-start.tsx:159` says "By continuing you accept the Docket firm terms". Yet there is no page, link, checkbox or record, and `app/firm/(auth)/start/actions.ts:76` only calls `create_firm`. The Step 1 sign-up (`firm-start.tsx:52`), admin-created firms (`app/admin/actions.ts:100-109`) and invited staff show no terms, and `consent_kind` has no platform value (`supabase/migrations/20260909000001_schema.sql:22`).

**How to add it.**
1. Create `src/lib/legal/platform.ts` (new) with `PLATFORM_PRIVACY_VERSION` (used by item 1), `PLATFORM_TERMS_VERSION`, `FIRM_AGREEMENT_VERSION` and `DPA_VERSION`. Read the entity name from env or a config row.
2. Create `app/docket/terms/page.tsx` (new) with `export const dynamic = "force-dynamic"` (`src/lib/csp.ts:74-79`). Cover the service; accounts and MFA; acceptable use, with item 19's takedown clause; payments (client fees settle to the firm's Paystack subaccount, and Docket gives notice before charging, `app/page.tsx:252-257`); no legal advice from Docket; liability; suspension; notices; and Nigerian governing law with a named forum.
3. Create `app/docket/firm-agreement/page.tsx` (new) and `app/docket/dpa/page.tsx` (new). The DPA makes the firm the controller (`firm-start.tsx:159-160`) and Docket the processor, and lists item 1's sub-processors.
4. Add `"/docket"` to `APP_PREFIXES` (`middleware.ts:53`) if item 1 has not.
5. Create `supabase/migrations/20260910000054_platform_consents.sql` (new) with `alter type consent_kind add value if not exists` for `platform_terms`, `firm_agreement` and `dpa`. Use no new value in a `language sql` body in this file. Postgres rejects it in the transaction that adds it.
6. Leave `is_valid_firm_slug` alone: `docket` is already a reserved slug (`20260910000009_platform_firms.sql:141-142`), so no firm can take the `/docket` path.
7. In that file, add a plpgsql `security definer` function `record_platform_consent(p_kind consent_kind, p_version text, p_firm uuid default null)`. It inserts as `auth.uid()`, takes no firm for `platform_terms`, and needs an `owner` row in `firm_members` for the other two. It skips `mfa_ok()`, as self-serve `create_firm` does. Grant it to `authenticated` only, so it still works after item 6 revokes direct insert. Leave `ip` and `user_agent` null (`20260910000024_wave_zero_doors.sql:116-121`).
8. In Step 1 of `firm-start.tsx` (`:80-96`), add a required checkbox that links `/docket/terms`. Pass its version in `signUp` `options.data` (`:55-58`).
9. Replace the sentence at `firm-start.tsx:158-162` with required checkboxes `acceptFirmAgreement` and `acceptDpa`.
10. In `start/actions.ts`, require both with `z.literal("on")` (`:16-39`). After the `firm_id` check (`:90`), call `record_platform_consent` for all three kinds and return any error. Do not write inside `create_firm`: its `p_owner_email` branch runs as the admin (`20260910000015_second_firm_walkthrough.sql:42-47`).
11. In `app/firm/(console)/layout.tsx` after `:68`, add `platformGateFor()` modelled on `consentGateFor`. It requires the member's `platform_terms` row at the current version. For owners, it also requires the firm's `firm_agreement` and `dpa` rows.
12. Render the gate from `app/firm/(console)/platform-terms-gate.tsx` (new), modelled on `app/app/(portal)/consent-gate.tsx`. It posts to an awaited action in `src/lib/actions/platform-consent.ts` (new).
13. Add the kinds to `ConsentKind` (`src/lib/db/types.ts:13-18`) and `CONSENT_LABELS` (`app/firm/(console)/clients/[id]/page.tsx:45`).
14. Link `/docket/terms` from `app/page.tsx:303-311`, `src/components/auth/auth-frame.tsx:88-93` and the platform branch of `app/sitemap.ts:15`.
15. Document the function in `docs/RPC_REFERENCE.md` near `:838`. Point `docs/COMPLIANCE_PACK.md:467` at the `dpa` rows.

**How to check it.**
- Add `supabase/tests/99_platform_consents.sql` (new) using `t_check` (`supabase/tests/10_rls_isolation.sql:20-23`). Check that an owner records all three kinds, a non-owner cannot record `dpa` and `anon` cannot execute. Add its floor to `supabase/tests/expected-checks.tsv` and raise the counts in `README.md:7`.
- Add the `/docket/*` routes beside `site-terms` (`tests/fixtures/design.mjs:220`). Add platform rows to the mock `consent_records` (`tests/fixtures/supabase-mock.mjs:191-194`) so console routes clear the gate. `scripts/check-prerendered-routes.mjs` must pass.
- Manual check: `/firm/start` refuses to continue without the ticks and writes three rows with them. The owner of an admin-created firm meets the gate on their first console visit.

**Decision needed.** The owner and a Nigerian lawyer must name the contracting entity (`Docket_Build_Blueprint_v0.2.md:479`), the forum and any liability cap before the pages ship. The owner must also decide whether clients accept Docket's terms at sign-up, or only each firm's.

**Risk if left.** Firms and staff use Docket under terms that were never published or recorded. Its liability limits, and the controller-processor contract that NDPA 2023 and the GAID expect, may therefore bind no one. Not legal advice.

### 3. Add a refund policy

**Status:** partial · **Priority:** P0 · **Effort:** M

**Where it stands.** Clients pay before a booking completes (`app/(public)/[firm]/book/booking-wizard.tsx:579-580`, `src/lib/actions/booking.ts:176-186`). The platform's default cancellation text promises "free of charge up to 24 hours" (`supabase/migrations/20260910000012_platform_hardening.sql:140-141`, and for tenant #1 `supabase/seed.sql:31-32`). Clients see this text before paying, with no link (`booking-wizard.tsx:552-553`, `app/(public)/[firm]/services/[service]/page.tsx:44-45`). The portal also hard-codes it (`app/app/(portal)/appointments/[id]/page.tsx:223`, `app/app/(portal)/appointments/page.tsx:125-126`). But `cancel_appointment` ignores `free_cancel_hours`, voids only unpaid invoices and records no refund (`supabase/migrations/20260909000003_functions.sql:260-274`). The webhook also ignores refund events (`supabase/functions/paystack-webhook/index.ts:147-148`). There is no policy page, `PayPanel` shows no policy, and no console screen edits the cancellation document (`app/firm/(console)/admin/settings/page.tsx:195`).

**How to add it.**
1. Create `supabase/migrations/20260910000055_cancellation_and_defaults.sql` (new). In it, recreate `seed_firm_defaults` from its current body in `20260910000012_platform_hardening.sql`, with cancellation text that names no firm and promises no refund. Item 7's change to the same function goes in this migration too.
2. In the same file, use `jsonb_set` to put the new text on every firm whose cancellation text still matches the old default. Edit `supabase/seed.sql:32` to match.
3. In the same file, add `appointments.refund_due_minor` and recreate `cancel_appointment`, keeping its checks (`functions.sql:264-270`). When the invoice is `paid`, compare the time left with `free_cancel_hours`. Set `refund_due_minor` under the agreed rule and add it to the audit payload.
4. Set `refund_due_minor` the same way when `release_expired_holds` releases a paid booking (`20260910000035_pre_consultation_checkin.sql:614-633`).
5. Tell the firm. The client already gets `appointment_cancelled` from the `appointments_notify` trigger (`functions.sql:103-113`). Nobody at the firm is told. Queue a new `refund_due` event to `lawyer_id` with `enqueue_notification`. Add the event to `src/lib/notifications-copy.ts:79` and to the render switch in `supabase/functions/dispatch-notifications/index.ts`.
6. Show "Refund due" next to the no-show card in `app/firm/(console)/appointments/[id]/page.tsx:237-244`. Reword the credit-note promise at `app/firm/(console)/invoices/[id]/page.tsx:450-451`. In `src/lib/actions/invoices.ts`, map the `cancel_invoice` refusal (`20260910000018_staff_console.sql:111`) to new wording.
7. Add `freeCancelHours` to `PolicyDoc` (`settings-forms.tsx:55-60`), to `PolicyDocInput` (`src/lib/actions/firm-settings.ts:96-101`) and to `policyDoc()` (`settings/page.tsx:58-63`), which drops the value today. Pass the cancellation document from `settings/page.tsx:195`.
8. Build a `CancellationSection` in `settings-forms.tsx`. Leave out the "asks every client to accept again" hint (`settings-forms.tsx:1023`), because cancellation is not a `consent_kind`.
9. Add `updateCancellationPolicy` to `firm-settings.ts`, following the `updatePolicies` pattern. Read first and pass the other documents through unchanged. Send `free_cancel_hours` as a JSON number (`admin_surfaces.sql:251-252`), then run the read-back diff (744-765). Fix "four policy documents" at `settings-forms.tsx:947` and `docs/RPC_REFERENCE.md:1120`.
10. Give `PolicyPage` (`app/(public)/[firm]/_components/policy-page.tsx`) a `cancellation` branch. It must not show the placeholder about accepting a version at sign-in (36-46). Mark the text as a draft while its version starts with `0-`. Create `app/(public)/[firm]/cancellation/page.tsx` (new) from `terms/page.tsx`, titled "Cancellations and refunds".
11. Link the page in the footer (`app/(public)/[firm]/layout.tsx:155-158`) and in `app/sitemap.ts:20`. Add a `site-cancellation` route next to `tests/fixtures/design.mjs:220`.
12. Link the page before payment: at `booking-wizard.tsx:552-554`, at `services/[service]/page.tsx:44-45`, and in `src/components/portal/pay-panel.tsx` through new `policyText` and `policyHref` props. Fill both `PayPanel` callers (`appointments/[id]/page.tsx:127`, `payments/[invoice]/page.tsx:72`) from `firm_public`, which already exposes `slug` and `policies`.
13. Replace the hard-coded lines at `appointments/[id]/page.tsx:222-224` and `appointments/page.tsx:124-127` with the firm's own text. Remove the claim that clients can reschedule: only staff can call `reschedule_appointment` (`20260909000009_consultations.sql:61-68`).
14. Update `docs/RPC_REFERENCE.md:155`, `docs/CLIENT_GUIDE.md:112-116` and `docs/ADMIN_GUIDE.md:90`.

**How to check it.**
- Add `supabase/tests/99_cancellation.sql` (new), using `t_check` as `supabase/tests/99_pre_consultation.sql:13` does. Prove that a new firm gets the new text. Prove that a firm on the old default is updated and a firm that edited its text is not. Prove that a client cancelling a paid booking inside and outside `free_cancel_hours` gets the `refund_due_minor` the rule sets, and that a `refund_due` notification is queued. Add the suite's floor to `supabase/tests/expected-checks.tsv` and update the counts at `README.md:7`.
- Run the design fixture with the new `site-cancellation` route.
- `grep -rn "free of charge" app src` returns nothing.
- Manual check on tenant #1 in Paystack test mode. The link appears on the booking review step, the service page and both pay panels. Cancelling a paid booking shows "Refund due" in the console.

**Decision needed.** The business and a lawyer must set the refund rule. It must say what is refunded inside and outside the window, for no-shows and for released holds, and within how many days. They must also approve the default wording. Checkout runs on the platform's Paystack account with the firm as a subaccount (`booking.ts:176-186`). A refund through the Paystack API would therefore conflict with "Docket never holds it" (`booking-wizard.tsx:520-521`). Keep refunds manual, made by the firm, until this is decided. If a `record_refund` function is built later, model it on the current `record_payment` (`20260910000035_pre_consultation_checkin.sql:497-564`), not on the dropped version.

**Risk if left.** Telling paying clients that cancellation is free, when the system never refunds, risks being a misleading representation under the FCCPA 2018 and sits badly with the Rules of Professional Conduct on client fees. Not legal advice.

### 4. Add a cookie policy

**Status:** missing · **Priority:** P1 · **Effort:** M

**Where it stands.** No surface has a cookie or device-storage notice. The tenant privacy page renders only the firm's `firms.policies` text (`app/(public)/[firm]/_components/policy-page.tsx:8-50`). `middleware.ts:170-180` sets the analytics id `docket_did` for one year (`middleware.ts:66`) on every matched path, even when `POSTHOG_KEY` is unset (`src/lib/observability/posthog.ts:56-57`). The code also sets these, and none of them is disclosed:
- the `dk_staff_firm` cookie (`middleware.ts:158-168`)
- the `dk_firm` cookie (`src/lib/actions/portal.ts:328-334`)
- the Supabase `sb-*` cookies (`src/lib/supabase/server.ts:21-24`)
- four `docket:*` localStorage keys
- a `docket-booking:<firmId>` sessionStorage entry that holds intake answers (`app/(public)/[firm]/book/booking-wizard.tsx:96,177`)

`public/sw.js:5-8` says the saved copy `docket-saved-v1` is deleted at sign-out. It is not: neither `signOut` (`app/app/(portal)/actions.ts:53-59`) nor `signOutEverywhere` (`src/lib/actions/portal.ts:298-301`) removes it. Nothing uses IndexedDB, and `package.json` includes no browser SDK for analytics or error monitoring.

**How to add it.**
1. Create `src/lib/legal/device-storage.ts` (new). It exports one array of `{ name, kind, setBy, purpose, lifetime, essential }` entries.
2. Import the existing constants into it: `VISITOR_COOKIE`, `STAFF_FIRM_COOKIE`, `STAFF_FIRM_MAX_AGE`, `SELECTED_FIRM_COOKIE`, `LOW_DATA_KEY` and `SAVED_CACHE`. Move `VISITOR_MAX_AGE` from `middleware.ts:66` into `src/lib/observability/index.ts` so both files share it.
3. Export the private keys and import them too: `METHOD_KEY` (`src/components/auth/sign-in-forms.tsx:130`), `DISMISS_KEY` (`src/components/portal/pwa-hints.tsx:11`) and `PREFIX` (`src/lib/drafts.ts:13`). Add a new `BOOKING_STORAGE_PREFIX` for the literal at `booking-wizard.tsx:96`.
4. Add the entries that have no constant:
   - `sb-<ref>-auth-token`, with its `.0`/`.1` chunks and the PKCE `-code-verifier` cookie (`sign-in-forms.tsx:626,927`)
   - `docket-offline-v1` (`public/sw.js:11`)
   - the `/sw.js` registration (`src/components/portal/sw-registrar.tsx:9`)
   - the push subscription (`src/components/push/push-opt-in.tsx:70`)
5. Create `src/components/portal/sign-out-form.tsx` (new). It is a client form that awaits `forgetCopy()` (`src/lib/offline.ts:60`) before it submits. Use it for both forms at `app/app/(portal)/profile/page.tsx:161-162`.
6. Delete `SAVED_CACHE` next to `clearAllDrafts()` in `DraftSweeper` (`src/components/ui/connection.tsx:48-51`). Then correct the comment at `public/sw.js:5-8`.
7. Set `secure: true` on `dk_firm` (`src/lib/actions/portal.ts:331`). Delete `dk_firm` in `signOutEverywhere`. Delete `dk_staff_firm` (path `/firm`) in `staffSignOut` (`src/lib/actions/staff.ts:13-17`).
8. Create `app/(public)/[firm]/cookies/page.tsx` (new) under `PageShell`, and render the inventory as a table. This is platform text, not a `firms.policies` row. List the third-party requests to Google Fonts, Daily and Paystack checkout (`src/lib/csp.ts:149-169`). State that Sentry and PostHog run only on the server.
9. Create `app/docket/cookies/page.tsx` (new) from the same component. Give it `export const dynamic = "force-dynamic"`, as `src/lib/csp.ts:74-77` asks. Do not add it to `PRERENDERED_SHELLS`.
10. Add `"/docket"` to `APP_PREFIXES` (`middleware.ts:53`) if item 1 has not. Without it, a firm's custom domain rewrites the page to `/<slug>/docket/cookies`, which returns 404. `docket` is already a reserved slug, so no firm can collide with it.
11. Link `${base}/cookies` from the tenant footer (`app/(public)/[firm]/layout.tsx:157-158`). Link `/docket/cookies` from the landing footer (`app/page.tsx:280-312`, with the `min-h-[44px]` its other links use), the `AuthFrame` footer (`src/components/auth/auth-frame.tsx:88-93`) and the profile next to `LowDataToggle` (`app/app/(portal)/profile/page.tsx:123`).
12. Add `scripts/check-device-storage.mjs` (new). Run it in `.github/workflows/ci.yml`, next to `check-prerendered-routes.mjs` (line 383). It finds every cookie write (including `cookieStore.set`), every `setItem`, `caches.open`, `serviceWorker.register` and `indexedDB.open`. It resolves keys held in variables or template strings to their constants, and it fails on any key missing from the inventory.
13. Add a device-storage table, generated from the inventory, to `docs/COMPLIANCE_PACK.md`.

**How to check it.**
- `node scripts/check-device-storage.mjs` passes. It then fails after you add a throwaway `localStorage.setItem("x", "1")`.
- Extend `tests/e2e/smoke.spec.ts`, which CI runs (`.github/workflows/ci.yml:463`). Visit `/`, `/${firmSlug}` and `/${firmSlug}/book`. Assert that every name from `page.context().cookies()` and `page.context().storageState()` is in the inventory. Do not use `document.cookie`, which cannot see httpOnly cookies such as `docket_did`. Do not rely on `tests/integration/journeys.spec.ts`, which CI never runs.
- Manual: press "Save now" on the profile, then sign out. Confirm in DevTools that `docket-saved-v1` is gone from Cache Storage.
- Manual: `/cookies` on a custom-domain tenant returns 200 with no CSP violation. So does `/docket/cookies` on both the platform host and a custom domain.

**Decision needed.** The owner and a lawyer must decide one thing: does `docket_did` need opt-in consent, or can it rely on legitimate interest if it is set only on tenant pages and only when `POSTHOG_KEY` is set? They must also say who controls tenant-site analytics data: Docket or the firm.

**Risk if left.** A one-year analytics id is set on every visitor to a law firm's site, and intake answers sit in browser storage, with no notice; this conflicts with the transparency and lawful-basis duties in the NDPA 2023 and with the NDPC GAID's expectation of notice and consent for non-essential cookies. Not legal advice.

### 5. Add a cookie consent banner

**Status:** partial (missing at the audit) · **Priority:** P0 · **Effort:** L

**Where it stands.** No banner, cookie notice or opt-out exists anywhere. `middleware.ts:119-129` and `middleware.ts:170-180` set `docket_did` on every non-static path (`middleware.ts:187`). It is an analytics id that lasts one year (`middleware.ts:66`), and it is set even when `POSTHOG_KEY` is unset. PostHog events use that id, or an account uuid, at `app/(public)/[firm]/layout.tsx:47`, `src/lib/actions/booking.ts:47-49`, `src/lib/observability/stitch.ts:44`, `src/lib/actions/matters.ts:135` and `app/firm/(auth)/start/actions.ts:109`. The console and the tenant sites fetch Google Fonts at runtime (`app/firm/(console)/layout.tsx:43-44`, `src/lib/brand.ts:351-357`), and `docs/COMPLIANCE_PACK.md:227-242` does not list this. `consent_kind` has no analytics value (`supabase/migrations/20260909000001_schema.sql:22`).

**How to add it.**
1. Create `src/lib/consent-cookie.ts` (new) and keep it edge-safe. Export `CONSENT_COOKIE = "docket_consent"`, `CONSENT_VERSION`, and `parseConsent(value)`, which returns `{ analytics: boolean }`.
2. In `middleware.ts:119-129` and `:170-180`, set `docket_did` only when `parseConsent` grants analytics and `POSTHOG_KEY` is set. Leave `sb-*`, `dk_staff_firm` and `dk_firm` unchanged.
3. When there is no consent, remove `docket_did` from the forwarded `cookie` header. Then call `response.cookies.delete({ name: VISITOR_COOKIE, path: "/" })`.
4. Add `analyticsAllowed()` in `src/lib/observability/consent.ts` (new). It reads `docket_consent` through `cookies()`. It returns false when `POSTHOG_KEY` is unset.
5. Check `analyticsAllowed()` before the captures at `app/(public)/[firm]/layout.tsx:47`, `src/lib/actions/booking.ts:47-49`, `src/lib/observability/stitch.ts:43-44` and `app/firm/(auth)/start/actions.ts:109`. The `stitch.ts` check covers every sign-in path.
6. Create `supabase/migrations/20260910000056_analytics_consent.sql` (new). Add `'analytics'` to `consent_kind`. Add a `decision text not null default 'granted' check (decision in ('granted','withdrawn'))` column to `consent_records`. The table stays append-only (`20260910000024_wave_zero_doors.sql:15`), so each withdrawal is a new row.
7. In the same migration, add a `security definer` function `analytics_consented(p_user uuid, p_firm uuid) returns boolean`. It returns false unless the caller is `p_user`, or the caller passes `is_firm_member(p_firm)` and `p_user` has a `matter_parties` row in that firm. Write it in plpgsql, because the new enum value cannot be used until the migration commits.
8. Send `matter_opened` (`src/lib/actions/matters.ts:135`) only when `analytics_consented(clientId, firmId)` returns true.
9. Add `setAnalyticsConsent(granted)` in `src/lib/actions/cookie-consent.ts` (new). It sets `docket_consent` on path `/` for one year, without `httpOnly`. The banner has to read it in the browser, because `/` is prerendered (`src/lib/csp.ts:79`). When consent is withdrawn, it deletes `docket_did` on path `/`. For a signed-in user, it also records a `consent_records` row with `kind: 'analytics'` and `firm_id: null` through a `security definer` function in `056`, granted to `authenticated`. A direct insert fails, because item 6's `053` drops `consent_records_insert`.
10. Build `src/components/ui/cookie-banner.tsx` (new) as a client island that reads `document.cookie`. Give it two equal-weight `Button`s, "Allow analytics" and "Only necessary", plus a link to the cookie notice from item 4 (`${base}/cookies` on a firm's site, `/docket/cookies` elsewhere). Export a `CookieSettingsLink` that reopens the banner. Render nothing when `analyticsEnabled` is false.
11. Mount the banner once in `app/layout.tsx:46-48` and pass `analyticsEnabled={Boolean(process.env.POSTHOG_KEY)}`.
12. Use item 4's pages, `app/(public)/[firm]/cookies/page.tsx` and `app/docket/cookies/page.tsx`. Do not add `"/cookies"` to `APP_PREFIXES`: on a firm's host, `/cookies` must keep serving that firm's page.
13. Make sure item 4's inventory, which both cookie pages render, lists the purpose and lifetime of each item: `sb-*-auth-token` and the PKCE verifier, `dk_staff_firm`, `dk_firm`, `docket_did`, `docket_consent`, the localStorage keys `docket:sign-in-method`, `docket:low-data`, `docket:ios-hint-dismissed` and `docket:draft:*`, the booking `sessionStorage` key, the caches `docket-offline-v1` and `docket-saved-v1`, and the push subscription. Say that each site address stores its own choice. When `POSTHOG_KEY` is unset, say that only strictly necessary storage is used.
14. Put `CookieSettingsLink` next to item 4's cookie-notice links in the tenant footer (`app/(public)/[firm]/layout.tsx:153-159`), the portal profile card (`app/app/(portal)/profile/page.tsx:116-126`) and the footer of `app/page.tsx`.
15. Replace `CONSOLE_FONTS` (`app/firm/(console)/layout.tsx:43-44,154`) with `next/font/google`, as `app/not-found.tsx:21` does. Point the font tokens at lines 39-40 to the new font variable.
16. Self-host an allowlist of tenant fonts in `src/lib/brand.ts`, or name Google Fonts in the notice.
17. When nothing loads from Google any more, delete `FONT_CSS` and `FONT_FILES` from `src/lib/csp.ts:161-165,221-222`. Also delete the waivers at `tests/fixtures/shots.mjs:104,139` and `tests/fixtures/README.md:273`.
18. Update `docs/COMPLIANCE_PACK.md`. Mark the PostHog row in §4 as consent-only, add the list from step 13, and add `analytics` and `decision` to §2 (lines 151-152 and 184-192).

**Done in the code (merged in PR #40, lane dE).** Steps 1 to 5, 11 and 14 are done. So is step 10, except its link to the cookie notice, and so are the cookie parts of steps 9 and 18.
- `src/lib/consent-cookie.ts` and `src/lib/observability/consent.ts` exist, and `middleware.ts` mints `docket_did` only with consent and `POSTHOG_KEY`.
- Without consent, an id the browser still holds is dropped from the forwarded header and expired on the response.
- `booking_started`, `site_viewed`, `firm_registered` and the sign-in `$identify` send nothing without consent.
- Step 8 went further than planned: `matter_opened` and its `matter_type` are no longer sent at all.
- The banner (`src/components/ui/cookie-banner.tsx`) has two equal buttons, "Allow analytics" and "Only necessary". It shows only when `POSTHOG_KEY` is set.
- `CookieSettingsButton` reopens the banner. It is in:
  - the tenant footer
  - the portal profile
  - the landing footer
  - every sign-in and registration page
  - `/firm/me`
- The PostHog row in the compliance pack says what is sent and when.

Still open:
- Steps 6 and 7, and the signed-in record in step 9, need migration `056`.
- Steps 12 and 13 need item 4's cookie notice. The banner links none yet.
- Step 15, self-hosting the console's fonts with `next/font`, needs no decision and is still open. Steps 16 and 17 wait on the tenant fonts decision.

**How to check it.**
- Add `supabase/tests/99_analytics_consent.sql` (new) using `t_check`. Assert that a user can record an `analytics` row only for themself, that an invalid `decision` fails, that update and delete stay revoked, and that `analytics_consented()` returns false for an unrelated caller. Add its floor to `supabase/tests/expected-checks.tsv` and update the counts at `README.md:7`.
- `tests/e2e/smoke.spec.ts` already checks two things outside the Supabase skip: a first visit to `/` sets no `docket_did`, and a request carrying `docket_did` without consent gets back a `Set-Cookie` that expires it. Still to add: with `POSTHOG_KEY` set, the cookie appears after "Allow analytics".
- Add `/` and a tenant route to the list at `tests/fixtures/ergonomics.mjs:60`, so the 44px check covers the banner.
- Manual check: choose "Only necessary" as a client, have staff open a matter for that client, and confirm that PostHog live events show nothing for that user.

**Decision needed.** Choose whether tenant fonts are self-hosted from an allowlist or disclosed as a transfer to Google. A lawyer should confirm whether the notice names Docket or the firm as controller for analytics on a firm's site.

**Risk if left.** A one-year analytics id is set and used before anyone opts in, and visitor IP addresses reach Google without disclosure; this conflicts with the consent and transparency duties in the NDPA 2023 and the cookie rules in the NDPC GAID, and it exposes Docket and each firm to NDPC compliance orders and fines. Not legal advice.

### 6. Check your form consents

**Status:** partial · **Priority:** P0 · **Effort:** L

**Where it stands.** The portal gate shows two unticked, separately labelled boxes (`app/app/(portal)/consent-gate.tsx:43-71`). `recordConsent` then writes `terms` and `privacy` rows with the version, `user_id` and `accepted_at` (`app/app/(portal)/actions.ts:35-48`). The boxes have no `name`, and the insert policy checks only `user_id = auth.uid()` (`supabase/migrations/20260910000021_hardening.sql:63-65`), so any signed-in user can forge a row. The booking wizard takes intake answers, files and payment with no consent control on its review step (`app/(public)/[firm]/book/booking-wizard.tsx:552-581`). Sign-in, staff join and firm registration show no notice. `app/firm/(auth)/start/firm-start.tsx:159` treats firm terms as accepted, but nothing records that acceptance. The staff hint at `app/firm/(console)/clients/[id]/page.tsx:624` says consent is written "as they book", which is false.

**How to add it.**
1. In `booking-wizard.tsx`, before `:552`, add two unticked, separately labelled checkboxes backed by `acceptTerms` and `acceptPrivacy` state. Link `/${firm.slug}/terms` and `/${firm.slug}/privacy` and show each version.
2. Add `|| !acceptTerms || !acceptPrivacy` to `disabled` at `:573`. Leave the uploads at `:244-255` where they are, because they already run only on confirm. Check the versions against `firm_public` before uploading, so a refusal leaves no orphaned files.
3. In `src/lib/actions/booking.ts:52-94`, pass `p_terms_version` and `p_privacy_version` to the RPC.
4. In `supabase/migrations/20260910000053_booking_consent_enforcement.sql` (new), drop `book_appointment(uuid,uuid,uuid,timestamptz,appointment_mode,text,jsonb,uuid)` so no bypass overload survives.
5. Recreate it from `20260910000035_pre_consultation_checkin.sql:404` with the two version parameters. It refuses versions that differ from `v_firm.policies`, then inserts both `consent_records` rows as `v_client`. Revoke execute from `public, anon` and grant it to `authenticated`.
6. In `052`, add a definer `record_consent(p_firm, p_terms_version, p_privacy_version)`. It refuses stale versions and writes both rows for `auth.uid()`. Grant it at aal1, because clients never hold MFA.
7. In `053`, drop policy `consent_records_insert` and revoke insert on `consent_records` from `authenticated`.
8. In `consent-gate.tsx` and `actions.ts:14-48`, name both boxes and require `z.literal("on")` for each. Call `record_consent` instead of inserting, and return its error.
9. Apply `053` only once `052` and the app that calls `record_consent()` are live everywhere, because an older deployed gate still inserts directly. In that commit, change `supabase/tests/70_deployed_frontend_compat.sql:162-169` to assert that a direct insert is refused. Seed the rows for the read-back checks at `:170-173` through `record_consent()`, because those checks expect the two inserted rows.
10. Update `src/lib/db/database.types.ts:2227`, `docs/RPC_REFERENCE.md:134`, the 12 positional `book_appointment(` calls in `supabase/tests` and the direct insert at `supabase/tests/99_pre_consultation.sql:121`.
11. Docket's own notice, terms, firm agreement and DPA are built by items 1 and 2 at `/docket/privacy`, `/docket/terms`, `/docket/firm-agreement` and `/docket/dpa`. This migration adds no table for them.
12. Link those pages from the consent points below. Do not put them at `app/privacy`, because `middleware.ts:106-107` rewrites that path to the firm's site.
13. Add one plain `<a>` sentence that links the notice. Put it below the buttons in `src/components/auth/sign-in-forms.tsx`, in `app/firm/(auth)/join/join-form.tsx` and on `firm-start.tsx` step 1. Add no button and no label matching `/phone/i` (`sign-in-forms.tsx:774-803`).
14. In `firm-start.tsx` step 2, the "By continuing" sentence becomes the unticked boxes `acceptFirmAgreement` and `acceptDpa` that item 2 adds. Require both in `app/firm/(auth)/start/actions.ts`.
15. Leave `create_firm` unchanged in `052` and `053`. Item 2 records the firm agreement and DPA in `consent_records` through `record_platform_consent`, after `create_firm` returns. Owners of firms created in `app/admin/create-firm.tsx` accept on their first console visit.
16. Rewrite the hint at `clients/[id]/page.tsx:624` so it names booking and the client app, and remove "a recording".

**Done in the code (lane dD, first pass).** Steps 1, 2, 6, 8 and 16 are done. `docs/RPC_REFERENCE.md` now documents `record_consent()` and notes that `book_appointment()` does not yet check consent.
- The booking review step has two unticked, separately labelled boxes. They link the firm's terms and privacy pages and show each version.
- Confirm stays off until both are ticked.
- On confirm, the acceptance is recorded before any file is uploaded or any slot is taken (`recordBookingConsent` in `src/lib/actions/booking.ts`).
- Migration `052` adds `record_consent(p_firm, p_terms_version, p_privacy_version)`.
  - It reads the firm with `for share`.
  - It refuses with the "not published" error when the firm's stored version is missing, empty or a `0-` draft. It refuses with its own SQLSTATE `DKC01` when a shown version is stale or not given. Nothing is written in either case.
  - It is granted to `authenticated` at aal1.
- The portal gate names both boxes, requires `z.literal("on")` for each, and calls it too (`src/lib/consent.ts`).
- `supabase/tests/99_booking_consent.sql` makes 41 checks.
- `docs/DEPLOYMENT_RUNBOOK.md` says `051` and `052` go before the app.

Steps 3 to 5, 7, 9 and 10 are the enforcement pass, reserved as `053`. Until then, `book_appointment()` does not itself refuse a booking without consent, and a direct insert into `consent_records` still works. Steps 11 to 15 wait on items 1 and 2.

**How to check it.**
- `supabase/tests/99_consent.sql` (new, using `t_check`) proves four things. Null or stale versions are refused. A booking writes exactly two rows. The 8-argument overload is gone. A direct insert is refused. Add its line to `supabase/tests/expected-checks.tsv` and update the counts at `README.md:7` and `:135`.
- Add a new booking journey to `tests/integration/journeys.spec.ts`, with `available_slots` and `book_appointment` fixtures in `tests/fixtures/supabase-mock.mjs`. It asserts that confirm stays disabled until both boxes are ticked.

**Decision needed.** A lawyer should confirm that a notice is enough at sign-in and staff join. The owner must supply the wording and versions of the privacy notice, firm terms and DPA, and name the Docket entity that acts as controller.

**Risk if left.** The platform takes intake, files and payments before any recorded consent and accepts forged consent rows, so a firm cannot prove consent under NDPA 2023 s.26 or show that it gave notice at collection under s.27. Not legal advice.

### 7. Don't collect unnecessary data

**Status:** partial · **Priority:** P0 · **Effort:** M

**Where it stands.** There is no browser analytics SDK, autocapture or session replay (`src/lib/observability/posthog.ts:7-12`). Sentry gets only a user uuid (`src/lib/observability/sentry.ts:77`). But `src/lib/actions/matters.ts:137` sends `matter_type`, which can be `criminal` or `family`, to PostHog keyed to the client's uuid. `app/api/report/route.ts:18-23,47-53` also passes browser error text to Sentry unscrubbed. `profiles.address` feeds document templates (`supabase/migrations/20260910000040_document_templates_and_execution.sql:215`) but has no writer (`src/lib/actions/portal.ts:280-290`), so `docs/CLIENT_GUIDE.md:270` is wrong. Intake questions have no purpose field and no guard against sensitive fields (`src/lib/actions/services.ts:435-446`), and the default intake asks `how_heard` (`supabase/migrations/20260910000012_platform_hardening.sql:130-131`). Failed bookings leave uploads behind, because `intake-uploads` has no delete policy (`supabase/migrations/20260909000004_supabase_storage_cron.sql:37-45`). `push_subscriptions.user_agent` is dead data: `src/components/push/push-opt-in.tsx:32` writes it and nothing reads it.

**How to add it.**
1. Delete `matter_type: d.type` from the `matter_opened` event in `src/lib/actions/matters.ts:137`.
2. List every PostHog event property in `docs/COMPLIANCE_PACK.md:242`. Include `amount_minor` and `currency` from `src/lib/actions/booking.ts:105-110`.
3. Add `address` (trimmed, max 300 characters) to `profileSchema` and to the update in `updateProfile` (`src/lib/actions/portal.ts:252-290`). The `profiles_update` policy already allows this (`supabase/migrations/20260909000002_rls.sql:78`).
4. In `app/app/(portal)/profile/page.tsx`, add `address` to the select (line 33) and a field to the form (line 67).
5. Record each profile column's purpose in `docs/COMPLIANCE_PACK.md` §1.1. Leave `country` and `state` in place. `supabase/tests/70_deployed_frontend_compat.sql:199-203` pins them.
6. Add optional `purpose` and `sensitive_reason` to `IntakeQuestion` (`src/lib/db/types.ts:242-253`).
7. Add both to `KNOWN_FIELDS` (`src/lib/actions/services.ts:435-446`). In `checkSchema`, test the label against `/(^|[^a-z])(nin|bvn|dob|date of birth|passport|religion|tribe|ethnic|genotype|hiv|health)([^a-z]|$)/i`. Test the key too, with each `_` read as a space. Refuse a match that has no `sensitive_reason`.
8. Mirror the rule in `checkQuestions` (`app/firm/(console)/admin/intake/intake-editor.tsx:78`).
9. Show `purpose` under the existing `help` text in `IntakeField` (`app/(public)/[firm]/book/booking-wizard.tsx:612`).
10. In `supabase/migrations/20260910000057_intake_purpose.sql` (new), add a `before insert or update of schema` trigger on `intake_forms`. It enforces the same rule with `raise exception`. Borrow only the trigger wiring from `validate_policies()` (`supabase/migrations/20260910000020_admin_surfaces.sql:227-269`). Do not make the function `security definer`.
11. In the same migration, add a delete policy on `storage.objects` for `intake-uploads`. Limit it to the client's own folder, and only where no `intake_responses.answers` names the object. Copy the guarded `execute $p$` pattern from `supabase/migrations/20260910000016_storage_guards.sql:16-41`.
12. In `submit()` (`booking-wizard.tsx:235`), call `supabase.storage.from("intake-uploads").remove(paths)` on every failure after an upload. This includes the slot-unavailable retry (271-275).
13. In `supabase/migrations/20260910000055_cancellation_and_defaults.sql` (new, shared with item 3), recreate `seed_firm_defaults()` without `how_heard`. Add a `help` line to the `area` question (`20260910000012_platform_hardening.sql:113`) that says why the firm asks it. Existing firms keep their current intake forms.
14. Export `scrub()` from `src/lib/observability/sentry.ts`. Run it over `exception.values[].value`, the stack frame (37-41), `extra` and `logger`. Write new unanchored regexes for emails and for Nigerian and E.164 numbers. Do not reuse the helpers in `src/lib/nigeria.ts:47-60`: they match a whole string and cannot find a number inside text.
15. Stop writing `user_agent` in `src/components/push/push-opt-in.tsx:32`.
16. In `.github/workflows/ci.yml`, fail the build if `package.json` lists `posthog-js`, `@sentry/browser` or `@sentry/nextjs`.

**Done in the code (merged in PR #40, lane dE).** Step 1 went further than planned: `matter_opened` is no longer sent at all, so neither is `matter_type`. The client's own choice cannot be read from the lawyer's browser. Step 2 is done too: the PostHog row in `docs/COMPLIANCE_PACK.md` lists every event property, including `amount_minor` and `currency`. The rest of item 7 is open, including steps 3 and 14 to 16, which need no decision.

**How to check it.**
- Add `scripts/check-scrub.ts` (new) and run it with `deno run --node-modules-dir=none`, next to the PDF check (`.github/workflows/ci.yml:317-327`). An email, `+2348031234567` and `08031234567` must come out redacted in both the error message and the stack frame.
- Add `t_check` cases to `supabase/tests/60_admin_surfaces.sql`. A `client_nin` key without `sensitive_reason` raises an error. The same key with a reason saves. A new firm's default intake has no `how_heard`. Raise that suite's floor in `supabase/tests/expected-checks.tsv:22` and the counts in `README.md:7`.
- Manual: set a test `POSTHOG_KEY`, choose "Allow analytics" and open a matter. No `matter_opened` event is sent.
- Manual: save an address at `/app/profile`. Then generate a document from a template that uses `{{client.address}}`.
- Manual: force a slot-unavailable retry. The client's `intake-uploads` folder then holds only the files from the booking that went through.

**Decision needed.** The owner decides whether any firm needs `how_heard` in its default intake. A lawyer confirms the list of sensitive terms. The lawyer also decides whether "Criminal" stays a default area option.

**Risk if left.** Sending a client's criminal or family matter type to an analytics processor goes against NDPA 2023 purpose limitation and data minimisation. So does collecting fields with no stated purpose. Both also strain the confidentiality duty in the Rules of Professional Conduct for Legal Practitioners. Not legal advice.

### 8. Audit your third-party SDKs

**Status:** partial · **Priority:** P1 · **Effort:** M

**Where it stands.** `docs/COMPLIANCE_PACK.md:227-242` lists ten recipients and what each one receives. It has no region, transfer basis, DPA or disclosure column, and the Supabase region at `docs/COMPLIANCE_PACK.md:33` is blank. The list leaves out Google Fonts (`src/lib/brand.ts:351-357`, `app/firm/(console)/layout.tsx:43-44`), Google OAuth and Twilio Auth OTP (`scripts/configure-providers.sh:14-15,25-26`), WhatsApp OTP (`src/components/auth/sign-in-forms.tsx:111-120`), Resend SMTP (`scripts/configure-providers.sh:192`), staff `wa.me` links (`app/firm/(console)/invoices/[id]/page.tsx:162`), partner webhooks, calendar subscribers, the Vercel Domains API (`src/lib/providers/domains/vercel.ts:23`) and Daily's `*.pluot.blue` relays (`src/lib/csp.ts:157-158`). `@daily-co/daily-js` depends on `@sentry/browser` (`package-lock.json:52-63`), so a browser Sentry SDK ships even though the note at `src/lib/csp.ts:14-16` says none exists. `README.md:83` and `README.md:121-122` wrongly say the CSP names no third-party origin, and `README.md:214` promises a privacy notice and DPA template that does not exist.

**How to add it.**
1. Create `src/lib/subprocessors.json` (new) with one entry per recipient. Give each entry these fields: `id`, `entity`, `purpose`, `data_sent`, `region`, `transfer_basis`, `dpa`, `disclosed`, `source` and `csp_origins`. Name no firm. JSON lets the Node 20 scripts read it.
2. Create `src/lib/subprocessors.ts` (new) as a typed wrapper over the JSON. `resolveJsonModule` is already on at `tsconfig.json:12`.
3. Seed the file from the rows at `docs/COMPLIANCE_PACK.md:233-242`.
4. Add the missing rows: `google-fonts`, `google-oauth`, `twilio-auth-otp`, `whatsapp-otp`, `whatsapp-deeplinks`, `resend-smtp-auth`, `partner-webhooks`, `calendar-subscribers`, `vercel-domains`, `daily-browser`, `daily-bundled-sentry` and `web-push-services` (FCM, Mozilla, Apple).
5. Rewrite `docs/COMPLIANCE_PACK.md` §4 to mirror the JSON. Add these columns: Region, Transfer basis (NDPA Part VIII), DPA signed and Disclosed in notice. This also fixes the four-cell PostHog row at `docs/COMPLIANCE_PACK.md:242`.
6. Correct three rows. Daily: only the lawyer's owner token carries a user id (`supabase/functions/video-session/index.ts:152`), and the client's name is sent from the browser (`src/components/video/consultation-room.tsx:263-266`). Sentry: no caller sends a user id, but raw error text can carry personal data (`src/lib/user-error.ts:21`, `app/api/report/route.ts:47-52`). PostHog: add `firm_registered` (`app/firm/(auth)/start/actions.ts:109`) and `$identify` (`src/lib/observability/posthog.ts:84-86`).
7. Fill the disclosure column honestly. Clients are told only about Paystack (`docs/CLIENT_GUIDE.md:98`), so most rows read "no" today.
8. Fill in the region at `docs/COMPLIANCE_PACK.md:33`. Record the live Sentry DSN host and the `POSTHOG_HOST` value (`.env.example:79-81`).
9. Add a packages appendix to §4. List the version and licence of each dependency from `package-lock.json`, including the transitive `@sentry/browser`. Also list the floating edge-function imports, such as `npm:web-push@3` (`supabase/functions/dispatch-notifications/index.ts:26`).
10. Create `scripts/check-egress.mjs` (new), following `scripts/check-prerendered-routes.mjs:33-34`. It reads `src/lib/csp.ts` as text and extracts each `https://` and `wss://` origin. It exits 1 if any origin is missing from `csp_origins`. Do not import `csp.ts`, because CI runs plain Node 20.
11. Add an `egress` job next to the `routes` job at `.github/workflows/ci.yml:352`. It needs Node 20 and no build.
12. Update the comment at `src/lib/csp.ts:14-16` to name the `@sentry/browser` that daily-js bundles. Note that `connect-src` blocks it.
13. Correct `README.md:83` and `README.md:121-122`. The CSP names no analytics or error-reporting origin, and `src/lib/subprocessors.json` lists the others.
14. Correct `README.md:214`. `docs/COMPLIANCE_PACK.md` holds the data map and runbooks, not a notice or DPA template. The counts at `README.md:7` do not change.

**How to check it.**
- `node scripts/check-egress.mjs` exits 0. Add a dummy origin to `src/lib/csp.ts` locally and confirm it exits 1.
- The `egress` and `typecheck` jobs pass in `.github/workflows/ci.yml`.
- `npm ls @sentry/browser` shows the daily-js path that the inventory records.
- Manual: run `tests/fixtures/shots.mjs` locally and match every aborted host it prints (`tests/fixtures/shots.mjs:207`) to a row. CI does not run this file.

**Decision needed.** The owner must read the live Supabase, Sentry and PostHog regions and confirm a DPA and a transfer basis for each vendor. The business must choose between keeping runtime Google Fonts with disclosure and self-hosting them. To self-host in the console, use `next/font/google` as `app/not-found.tsx:21-23` does, and change `CONSOLE_TOKENS` at `app/firm/(console)/layout.tsx:39-40` to match.

**Risk if left.** Recipients and cross-border transfers that are not disclosed (Google Fonts, Twilio and WhatsApp OTP, Daily media and a PostHog that may be hosted in the US) could breach NDPA 2023 transparency duties, its Part VIII transfer rules and the NDPC GAID, which exposes each firm as controller and Docket as processor. Not legal advice.

### 9. Remove dark patterns

**Status:** partial · **Priority:** P1 · **Effort:** M

**Where it stands.** Consent and signature boxes start unticked (`app/app/(portal)/consent-gate.tsx:44`, `:59`; `src/components/portal/sign-dialog.tsx:37`), and the payment countdown reads the real hold expiry (`src/components/portal/pay-panel.tsx:57`). Notifications are opt-out: `preferred_channel` defaults to `'sms'` (`supabase/migrations/20260909000001_schema.sql:38`), and `enqueue_notification` adds email whenever `profiles.email` is set (`supabase/migrations/20260910000037_notifications_reliability.sql:109-110`). That includes the address typed into the checkout receipt field (`src/lib/actions/booking.ts:214-225`). `book_appointment` enqueues messages before the client reaches the portal (`supabase/migrations/20260910000035_pre_consultation_checkin.sql:482-487`). Messages carry no preferences link (`supabase/functions/dispatch-notifications/index.ts:345-353`), push has no off control (`src/components/push/push-opt-in.tsx:83-89`), firm sign-up uses "By continuing you accept" (`app/firm/(auth)/start/firm-start.tsx:159`), and the cancel screen hard-codes a 24-hour free-cancellation promise (`app/app/(portal)/appointments/[id]/page.tsx:223`).

**How to add it.**
1. Create `supabase/migrations/20260910000058_notification_opt_in.sql` (new). Add two nullable `timestamptz` columns, `profiles.email_opt_in_at` and `profiles.sms_opt_in_at`. Set the `preferred_channel` default to `'in_app'`. Then regenerate `src/lib/db/database.types.ts`.
2. In the same file, redefine `public.enqueue_notification`, starting from `20260910000037_notifications_reliability.sql:85-124`. Replace lines 109-110 so `sms` needs `sms_opt_in_at`, and `email` needs both `email` and `email_opt_in_at`. Change nothing else. Item 18's `062` migration builds on this body.
3. Add `saveChannelOptIn({ email, sms })` next to `savePreferences` in `src/lib/actions/portal.ts:239-249`. It sets or clears the two columns on the caller's own row, which `profiles_update` allows (`20260910000021_hardening.sql:133-134`).
4. On the booking review step (`app/(public)/[firm]/book/booking-wizard.tsx:540-549`), add two unticked boxes, "Also send updates by SMS" and "Also send updates by email". Put them next to item 6's consent boxes. Reword the hint at `:547` to say the address is used only for the receipt unless the email box is ticked.
5. Call `saveChannelOptIn` at `booking-wizard.tsx:240-243`, before `bookAppointment`.
6. Replace the "Channel" select at `app/app/(portal)/profile/page.tsx:91-98` with the same two boxes. Drop the `"sms"` fallback at `src/lib/actions/portal.ts:267`, and update the sentence at `app/app/(portal)/notifications/preferences/page.tsx:35`.
7. Add the two boxes to `app/firm/(console)/me/page.tsx:118`, next to `<PushOptIn />`, so staff can opt in to reminders.
8. In `supabase/functions/dispatch-notifications/index.ts:350` and `:353`, append `Change what you receive: ${APP_URL}/app/notifications/preferences`, with a short form for SMS. The link goes in after the firm-template override (`:331-343`), so a firm cannot remove it. Item 18 adds unsubscribe tokens later.
9. Add a "Turn off" `Button` to the subscribed state in `src/components/push/push-opt-in.tsx:83-89`. It calls `getSubscription()`, then `unsubscribe()`, then deletes the `push_subscriptions` row by `endpoint`. The `push_subscriptions_all` policy allows the delete (`20260910000021_hardening.sql:139-141`).
10. Replace the sentence at `app/firm/(auth)/start/firm-start.tsx:157-163` with item 2's unticked `required` checkboxes, `acceptFirmAgreement` and `acceptDpa`, as in `consent-gate.tsx:44`. Make `createFirm` (`app/firm/(auth)/start/actions.ts:43`) refuse the form when either box is not ticked. Item 2 adds the links and records the acceptance.
11. In `app/app/(portal)/appointments/[id]/page.tsx:88`, select `id, name, policies` from `firm_public` for the firm that owns the appointment. Do not use `firm` from `selectedFirm()` (`:57`), because it can be a different firm.
12. Replace the text at `:222-224` with that firm's `policies.cancellation.text`. Put the cancel button (`:221`) behind a confirm step that says a paid fee is not refunded automatically, as `app/firm/(console)/admin/settings/settings-forms.tsx:512` says. Item 3 fixes the default text and `app/app/(portal)/appointments/page.tsx:124-126`.
13. Correct `docs/CLIENT_GUIDE.md:272-273` to describe opt-in and the push off control.

**How to check it.**
- In `supabase/tests/99_notifications.sql`, add `t_check`s for three cases: a profile with an email and a phone but no opt-in gets only `in_app` rows; each opt-in adds its own channel; a disabled per-event preference still wins. Set `sms_opt_in_at` in the fixtures at `99_notifications.sql:31`, `80_doors.sql:61-62` and `97_document_requests.sql:28`. Rewrite the SMS checks at `80_doors.sql:93-105`. Raise the floors in `supabase/tests/expected-checks.tsv` and the counts at `README.md:7`.
- With `tests/fixtures/supabase-mock.mjs`, assert that the booking boxes start unchecked, that push shows "Turn off", and that `/firm/start` refuses an unticked box. Add signed-in versions of these to `tests/integration/journeys.spec.ts`.
- Manual: dispatch one email and one SMS for a firm that has a template override. Confirm the preferences link still appears.

**Decision needed.** The owner and a lawyer should decide what happens to existing clients and staff who never chose a channel. Either they keep email and SMS (backfill both timestamps), or those messages stop until they tick a box. Profiles already set to `'email'` did make that choice, so they can be backfilled. The owner and lawyer should also decide whether booking confirmations and reminders can go by SMS as service messages without a tick.

**Risk if left.** Email and SMS that are on by default, with no way to opt out from the message itself, plus accept-by-continuing terms, fall short of the NDPA 2023 and GAID rule that consent must be specific, unambiguous and as easy to withdraw as to give. An unkept free-cancellation promise also risks a misleading-representation claim under the FCCPA 2018. Not legal advice.

### 10. Remove hidden fees

**Status:** partial · **Priority:** P0 · **Effort:** M

**Where it stands.** `book_appointment()` adds the firm's VAT and returns the total as `amount_minor` (`supabase/migrations/20260910000035_pre_consultation_checkin.sql:464-465`, `:492`), and Paystack charges `invoice.total_minor` (`src/lib/actions/booking.ts:178`). The booking wizard shows only the pre-VAT `price_minor` on service cards, in its one "Fee" row and on the "Confirm and pay" button (`app/(public)/[firm]/book/booking-wizard.tsx:349`, `:514`, `:579-580`), because `firm_public` has no `vat_rate` (`supabase/migrations/20260910000013_security_review.sql:167-171`). `src/lib/services.ts:12` omits `requires_prepayment`, so an "invoiced after" service still shows "Confirm and pay" and a 15-minute hold notice (`booking-wizard.tsx:518-523`), then gets an invoice for price plus VAT (`20260910000035_pre_consultation_checkin.sql:463-475`). A payment that lands after `release_expired_holds()` cancelled the invoice (`:614-633`) is still applied by `record_payment()`, which never checks invoice status (`:535-542`). Portal invoices already itemise Subtotal, VAT and Total (`app/app/(portal)/payments/[invoice]/page.tsx:87-96`).

**How to add it.**
1. Create `supabase/migrations/20260910000051_firm_public_vat_and_rc.sql` (new, shared with item 16). Use `create or replace view public.firm_public with (security_invoker = false)`, keep the columns of `20260910000013_security_review.sql:167-171` in order, and append `vat_rate, rc_number`. Do not add `tin`.
2. In the same file, repeat `revoke insert, update, delete, truncate, references, trigger on public.firm_public from anon, authenticated;`, as `20260910000014_review_round_two.sql:35-38` and its note at `:47-48` require.
3. Create `supabase/migrations/20260910000059_late_payments_and_invoice_issuer.sql` (new, shared with item 16). In it, replace `record_payment()` (`20260910000035_pre_consultation_checkin.sql:497-565`) with the same signature, so its grants hold. After the settlement-mismatch branch (`:510-524`), add a branch for a succeeded payment on a `cancelled` invoice. It inserts the payment with `raw || '{"late_payment": true}'`, leaves the invoice and appointment alone, calls `audit('payment.late', ...)`, `enqueue_firm_notification(..., 'late_payment', ...)` and `enqueue_notification(..., 'late_payment_client', ...)`, and returns `late_payment: true`.
4. Add both template keys beside `settlement_mismatch` in `supabase/functions/dispatch-notifications/index.ts:187`. The client text says the booking lapsed and the firm will refund.
5. In `supabase/functions/paystack-webhook/index.ts:203-210`, record `late_payment` with an outcome other than `processed`, so it reaches the admin health screen.
6. Add `vat_rate` and `rc_number` to `FirmPublic` (`src/lib/db/types.ts:61-72`) and to the select at `src/lib/tenant.ts:22`. Regenerate `src/lib/db/database.types.ts`.
7. Add `requires_prepayment` to the select at `src/lib/services.ts:12` and to `ServiceRow` in `src/lib/db/types.ts`.
8. Add `vatMinor(priceMinor, rate)` and `totalWithVat(priceMinor, rate)` to `src/lib/money.ts`, using `Math.round(priceMinor * rate / 100)` like `book_appointment()`. Move the inline copies at `app/firm/(console)/admin/services/page.tsx:142` and `app/firm/(console)/invoices/new/invoice-composer.tsx:141` onto it.
9. At `booking-wizard.tsx:514`, render "Fee", "VAT at {rate}%" (when the rate is above zero) and "Total" rows with the existing `Row` component (`:603`).
10. Drive the button (`:579-580`) and the hold notice (`:518-523`) from `requires_prepayment`. Prepaid reads "Confirm and pay {total}". Invoiced-after reads "Confirm booking: {total} will be invoiced" and drops the 15-minute notice.
11. Show the total, marked "incl. VAT", at `booking-wizard.tsx:349`, `app/(public)/[firm]/page.tsx:74` and `:118`, `app/(public)/[firm]/services/page.tsx:35` and `app/(public)/[firm]/services/[service]/page.tsx:31`.
12. Rewrite `docs/CLIENT_GUIDE.md:73-74` to match the new display.
13. Add the new columns to the lists at `supabase/tests/70_deployed_frontend_compat.sql:117` and `:121`.
14. Add late-payment `t_check` cases to `supabase/tests/99_pre_consultation.sql`, which already calls `release_expired_holds()` (`:223`). Raise its floor at `supabase/tests/expected-checks.tsv:43`. Update the migration and assertion counts in `README.md:7`.

**Done in the code (lane dD).** Steps 1, 2 and 6 to 13 are done. Step 8 was done differently. `vatMinor()` uses whole-number arithmetic instead of `Math.round`. `formatPriceWithVat()` takes the place of `totalWithVat()`, and callers add `price + vatMinor(...)` inline.
- Migration `051` appends `vat_rate` and `rc_number` to `firm_public`, and repeats the revoke.
- `vatMinor()` in `src/lib/money.ts` rounds exactly as `book_appointment()` does. It was checked against Postgres on 20,010 amount and rate pairs. The admin services page and the invoice composer use it.
- The booking review shows Fee, "VAT at {rate}%" and Total. The pay button asks for the total.
- Service cards, the tenant home and the service pages show the total marked "incl. VAT".
- An invoiced-after service reads "Confirm booking: {total} will be invoiced" and drops the hold notice.
- Checkout opens only when the booking is awaiting payment, the review said the client would pay, and the invoice total matches the total shown. Otherwise the client goes to the appointment page, which says what changed.
- `CLIENT_GUIDE.md` matches.

Steps 3 to 5 and 14, the late-payment branch, are reserved as `059`.

**How to check it.**
- `supabase/tests/20_platform.sql:266-285` stays green: anon still cannot write through `firm_public`.
- The new checks prove that a late payment leaves the invoice `cancelled`, writes one `payment.late` audit row and queues both notifications.
- `scripts/check-suite-counts.sh` passes.
- Manual: set a test firm's VAT rate to 7.5 (`app/firm/(console)/admin/settings/settings-forms.tsx:373`) and book a ₦50,000 prepaid service. The review shows Fee ₦50,000, VAT ₦3,750 and Total ₦53,750. The button and the Paystack checkout both ask for ₦53,750. An invoiced-after service shows no pay notice, and its invoice matches the total shown.

**Decision needed.** The owner must choose between two options. One is `transaction_charge: 0` at `src/lib/providers/payments/paystack.ts:29`, so Docket takes nothing per payment. The other is the "processing margin" in `Docket_Build_Blueprint_v0.2.md:437`. Any margin must be disclosed to firms and never added unseen to the client's total. Record the choice in `docs/decisions/` beside `0002-payments-paystack-only.md`.

**Risk if left.** Asking a client to confirm one figure and then charging more at checkout, or keeping money for a lapsed booking, risks being treated as misleading pricing and an unfair practice under FCCPA 2018. Not legal advice.

### 11. Remove fake reviews

**Status:** partial · **Priority:** P2 · **Effort:** M

**Where it stands.** No shipped surface shows invented testimonials, ratings, logos or "trusted by" counts. The landing page says so at `app/page.tsx:9-10`, and the one count on a tenant home comes from real rows (`app/(public)/[firm]/page.tsx:64`). Tenant testimonials are ungoverned: `content_kind` includes `testimonial` (`supabase/migrations/20260909000001_schema.sql:23`), firm admins can write any `content` row (`supabase/migrations/20260910000021_hardening.sql:199-206`), and a published row is readable with the anon key (`supabase/migrations/20260910000014_review_round_two.sql:203`). No page renders them, and `publishedList` (`src/lib/public-data.ts:63`) is dead code. The seeded tagline at `supabase/seed.sql:24` is self-praise shown in every tenant footer (`app/(public)/[firm]/layout.tsx:143`), and the unshipped artboard names a real firm at `design/home/Main.dc.html:159`.

**How to add it.**
1. Create `supabase/migrations/20260910000060_testimonial_guard.sql` (new). Set any published `testimonial` row to `draft`, then add a `BEFORE INSERT OR UPDATE` trigger on `public.content` that raises when `new.kind = 'testimonial'` and `new.status = 'published'`. Raise an explicit error; do not copy `validate_policies` (`supabase/migrations/20260910000020_admin_surfaces.sql:226-269`), which strips silently.
2. Only if the owner chooses clearance over a block, extend the same migration. Add `subject_consent_at timestamptz`, `rpc_cleared_by uuid references profiles` and `rpc_cleared_at timestamptz`, plus a `security definer` function `publish_testimonial(uuid)` that checks `has_firm_role(firm_id, '{owner}')` and `mfa_ok()`, sets those columns and sets a transaction-local flag the trigger requires. The flag matters because `content_write_upd` lets any admin write the columns directly. Revoke `execute` from `anon`. Store consent as a timestamp: `consent_kind` has no `testimonial` value (`20260909000001_schema.sql:22`).
3. Add `t_check` refusals to `supabase/tests/60_admin_surfaces.sql`: an aal2 owner cannot insert a published testimonial or publish a draft one; a draft still saves; `anon` reads no testimonial rows.
4. Raise that suite's floor in `supabase/tests/expected-checks.tsv:22` (now `90`), or regenerate it with `bash scripts/check-suite-counts.sh --write db-test.log`.
5. Update the migration count and check total in `README.md:7`, or `scripts/check-suite-counts.sh:80-87` fails the `sql` job.
6. Create `scripts/check-claims.mjs` (new), with no dependencies. Scan JSX text and string literals outside `className` in `app/page.tsx`, `app/(public)/**`, `app/app/(auth)/**`, `app/firm/(auth)/**`, `src/components/auth/**`, `design/home/Main.dc.html` and `docs/CLIENT_GUIDE.md`. Match narrow phrases such as star counts, "rated N", "trusted by", "N+ clients", "award-winning", "No. 1" and "best law firm". Do not match bare `best` or `leading`: they hit Tailwind classes and `src/components/video/consultation-room.tsx:374`. Keep a small allow-list with a reason per entry.
7. Add `"test:claims": "node scripts/check-claims.mjs"` to `package.json` and run it after `Typecheck` in the `typecheck` job (`.github/workflows/ci.yml:276-277`).
8. Move `noAngles` and `plain` from `src/lib/actions/firm-settings.ts:297-302` into `src/lib/validation/copy.ts` (new) and add a soft `claimsWarning(text)` helper for superlatives, outcome promises and quoted client praise.
9. Call it from `updateBrand` (`firm-settings.ts:563`, into `notes`), from `createService` and `updateService` (`src/lib/actions/services.ts:235`, `:292`, into the existing `notice`), and from `updatePractitionerProfile` (`src/lib/actions/practitioner.ts:30`), adding `notes?: string[]` to `PractitionerProfileResult` (`practitioner.ts:24`).
10. Add a one-line advertising-rules hint beside the Tagline input (`app/firm/(console)/admin/settings/settings-forms.tsx:743`), the bio textarea (`app/firm/(console)/me/profile-editor.tsx:79-80`) and the description field (`app/firm/(console)/admin/services/services-editor.tsx:343`).
11. Replace the tagline at `supabase/seed.sql:24` with factual wording the firm confirms. It also feeds `app/manifest.ts:16` and `src/lib/site.ts:30`.
12. In `design/home/Main.dc.html`, replace the real firm (lines 159, 287, 300, 337) and the real public body (lines 191, 299) with invented names labelled as sample, as `SampleRegister` does (`app/page.tsx:86-135`). Soften the adoption claim at line 55. Re-run `node design/home/verify.mjs`.
13. When the platform firm terms are written (item 2), add a warranty that firm content complies with the Rules of Professional Conduct.

**How to check it.**
- The CI `sql` job passes with the new `t_check` rows, including `bash scripts/check-suite-counts.sh db-test.log` (`.github/workflows/ci.yml:130`).
- `npm run test:claims` passes, and fails once "Trusted by 500 firms" is added to `app/page.tsx`.
- `node design/home/verify.mjs` passes, and the artboard contains no real firm or public body.
- Manual: at aal2, save the tagline "The best law firm in Lagos". The save succeeds and shows the warning.

**Decision needed.** The owner must choose between blocking published testimonials and allowing them through `publish_testimonial()`. If allowed, a lawyer must confirm who clears them (`Docket_Build_Blueprint_v0.2.md:435` names one reviewer) and what client consent is needed. Tenant #1 must approve its new tagline.

**Risk if left.** A firm could publish testimonials or superlative claims on a Docket-hosted site, breaching the advertising rules of the Rules of Professional Conduct for Legal Practitioners and the FCCPA 2018 ban on misleading representations; naming a client without consent adds NDPA 2023 exposure. Not legal advice.

### 12. Remove unsupported claims

**Status:** partial · **Priority:** P0 · **Effort:** M

**Where it stands.** The landing page already says Docket holds no security certification (`app/page.tsx:232-233`). Four claims are false in code. "You hold the only owner token" (`src/components/video/consultation-room.tsx:571`) fails because any `aal2` staff member gets an owner token (`supabase/functions/video-session/index.ts:101-104`); "rescheduled or cancelled free of charge" (`app/app/(portal)/appointments/[id]/page.tsx:223`, also the platform default policy at `supabase/migrations/20260910000012_platform_hardening.sql:140-141`) fails because clients cannot reschedule (`20260909000009_consultations.sql:68`) and `cancel_appointment` refunds nothing (`20260909000003_functions.sql:271-272`); "Any fee is shown before you confirm" (`app/(public)/[firm]/page.tsx:158`) fails when VAT applies (`booking-wizard.tsx:580`); and "Nothing was charged" (`docs/CLIENT_GUIDE.md:287`) fails because `record_payment` still marks a cancelled invoice paid (`20260910000035_pre_consultation_checkin.sql:537-542`). "Not recorded" (`consultation-room.tsx:571,574`) is unverified: the live room never sets `enable_recording` (`video-session/index.ts:48-51`), and `src/lib/providers/video/daily.ts` is dead code. Nothing in the code backs "confirms in under a minute" (`src/components/portal/pay-panel.tsx:20`), "secure thread" (`app/app/(portal)/messages/page.tsx:38`) or "cannot touch it" (`docs/CLIENT_GUIDE.md:101`).

**How to add it.**
1. `src/components/portal/pay-panel.tsx:20`: change the hint to "Pay into a one-time account from your bank app".
2. `src/components/video/consultation-room.tsx:571,574` and `docs/CLIENT_GUIDE.md:136-137`: delete "you hold the only owner token", and replace "not recorded" with "Docket does not turn recording on".
3. `scripts/check-auth-readiness.sh`: add a Daily step that fails when the domain config sets `enable_recording`. Restore "not recorded" only after this check passes in production.
4. Delete the dead `src/lib/providers/video/daily.ts` and `src/lib/providers/video/index.ts`.
5. `app/app/(portal)/appointments/[id]/page.tsx:88`: add `policies` to the `ownerFirm` select on `firm_public`.
6. Same file, `:222-224`: render `ownerFirm.policies.cancellation.text` instead of the hard-coded sentence. Do not use `firm`, because it can be a different firm (`:85-87`).
7. `app/app/(portal)/appointments/page.tsx:125-126`: drop "Rescheduling" and "free of charge".
8. In step 6 and in `app/(public)/[firm]/book/booking-wizard.tsx:552-553`, hide cancellation text whose `version` is `'0-draft'`.
9. `supabase/seed.sql:31-32`: rewrite tenant #1's cancellation text so it promises no refund and no reschedule. New firms get the same default from `seed_firm_defaults`; item 3's `supabase/migrations/20260910000055_cancellation_and_defaults.sql` (new) fixes it at the source.
10. Apply item 10 steps 1-3. Then show price plus VAT in the fee row and on the pay button (`booking-wizard.tsx:514`, `:580`).
11. `docs/CLIENT_GUIDE.md`: at `:287`, tell the client to contact the firm, which makes any refund; at `:101`, say Paystack settles the money to the firm's account; at `:63`, say the record is deleted with the account or the firm (`20260909000001_schema.sql:422-423`); at `:14`, drop "safer"; at `:208-212`, say that operators can see an invoice number and amount (`app/admin/health/page.tsx:17-20`); at `:232` and `:290`, state 120 seconds for downloads and 600 seconds for signing (`src/components/portal/sign-dialog.tsx:48`).
12. `app/app/(portal)/messages/page.tsx:38,45` and `src/components/portal/thread-list.tsx:27`: say "only the firm and the people on this matter can read it". Never write "only you and {firm}", because co-clients and delegates can read the thread (`20260910000029_matter_walls.sql:195-196`, `20260910000044_verified_delegation.sql:199-203`).
13. Replace the remaining "secure" copy at `booking-wizard.tsx:714`, `src/components/auth/auth-frame.tsx:15`, `src/components/auth/sign-in-forms.tsx:939`, `src/components/portal/documents-tab.tsx:332`, `sign-dialog.tsx:72` and `app/firm/(console)/matters/[id]/staff-documents.tsx:618`. Use "private folder", "one-time link" or the link's lifetime.
14. `app/page.tsx:70` and `:73`: qualify both claims. Firms can deliberately share data across firms (`20260910000045_collaboration.sql`), and self-serve `create_firm` skips MFA (`20260910000015_second_firm_walkthrough.sql:42-47`).
15. `docs/decisions/0004-no-platform-share-of-client-payments.md` (new): record the decision below.
16. Following that decision, pass `transaction_charge: 0` with `subaccount` in `src/lib/providers/payments/paystack.ts:29`, or reword `pay-panel.tsx:156-157` and `booking-wizard.tsx:520-521`.
17. `scripts/check-claims.mjs` (new, shared with item 11): strip comments first, then fail on `secure|encrypt|compliant|certified|guarantee|under a minute|free of charge|not recorded|only owner|cannot (see|touch)|nothing was charged|safer` in `app/`, `src/components`, `docs/CLIENT_GUIDE.md`, `docs/ADMIN_GUIDE.md` and `supabase/seed.sql`. Keep an allow-list that cites `file:line` for each exception.
18. `.github/workflows/ci.yml`: item 11's `test:claims` step already runs the script after `npm run typecheck` (`:277`), so add no second step.

**Done in the code (lanes dD and dF, and the sign-in fix `92b0088`).** Steps 1, 2 and 5 to 8 are done, and so are step 12, most of step 11 and most of step 10. Step 10's done parts are item 10 steps 1 and 2, the Fee, VAT and Total rows, and the pay button.
- The pay panel hint no longer promises "under a minute".
- The consultation and waiting rooms say "Docket does not turn recording on", and "you hold the only owner token" is gone.
- The appointment pages show the owning firm's own published cancellation text, or nothing. Their hard-coded "Rescheduling" and "free of charge" copy is gone. Tenant #1's seeded published text still says "rescheduled or cancelled free of charge" until step 9 is done.
- Draft (`0-`) cancellation text is never shown to a client.
- Messages say only the firm and the people on the matter or consultation can read a thread.
- `CLIENT_GUIDE.md` drops "safer" and says what operators can see. It states the ten-minute signing link. Its expired-hold row no longer says "Nothing was charged", and its Paying section warns that a payment finished after the hold is released still reaches the firm.
- The email sign-in panel no longer calls its link "secure".
- The booking wizard's upload hint no longer says "Uploaded securely".

Still open:
- step 3 (the Daily recording check) and step 4 (the dead video provider files)
- step 9 and the rest of step 13 (`auth-frame.tsx:17`, `documents-tab.tsx:332`, `sign-dialog.tsx:72`, `staff-documents.tsx:618`)
- step 10's part of item 10 step 3 (the late-payment branch in `record_payment()`, reserved as `059`)
- step 11's line "Docket does not hold it and cannot touch it" (`CLIENT_GUIDE.md:121`), which waits on the payment decision
- step 14 (the landing page claims)
- steps 15 and 16, which need the payment decision
- the claims script in steps 17 and 18

**How to check it.**
- `node scripts/check-claims.mjs` passes on the tree. It fails after you add "secure" to any JSX string.
- Book a service at a firm with `vat_rate > 0`. The pay button must equal the invoice's `total_minor`.
- Run `npm run auth:check` against a Daily domain that has recording on. It must fail.
- Sign in as a client of two firms and open an appointment. The cancellation text must be the owning firm's.

**Decision needed.** The business must decide whether Docket takes any share of client payments. `Docket_Build_Blueprint_v0.2.md:437` plans a "processing margin", which would make "Docket never holds client money" untrue. A lawyer should also approve the default cancellation wording.

**Risk if left.** Copy that the code contradicts, on refunds, VAT-inclusive prices and charges after an expired hold, can be a false or misleading representation under the FCCPA 2018. Loose "secure" and "not recorded" claims also set the bar a regulator would apply to the NDPA 2023 security duty after a breach. Not legal advice.

### 13. Add accessibility alt text

**Status:** partial · **Priority:** P2 · **Effort:** M

**Where it stands.** Two images have good alt text: the MFA QR code (`app/firm/(auth)/security/mfa/mfa-setup.tsx:139`) and the logo preview (`app/firm/(console)/admin/settings/settings-forms.tsx:792`). Document previews fall back to the raw file name as alt (`src/components/portal/documents-tab.tsx:340`, `app/firm/(console)/matters/[id]/staff-documents.tsx:626`). The decorative initial circles are not `aria-hidden` (`app/(public)/[firm]/layout.tsx:91`, `app/(public)/[firm]/page.tsx:139`). The checklist's ✓, · and – marks show status with no text alternative (`app/firm/(console)/admin/checklist.tsx:114`, `:135`). Nothing enforces alt text. `package.json:5-21` has no lint script and there is no ESLint config, so the `eslint-disable` comment at `mfa-setup.tsx:138` points at a linter that never runs. The checks in `tests/fixtures/design.mjs:17-23` do not cover alt text, and CI never runs `design.mjs`.

**How to add it.**
1. In `package.json`, add `eslint`, `eslint-config-next` (matching `next` 15.5.x) and `@eslint/eslintrc` to `devDependencies`. Do not add `eslint-plugin-jsx-a11y` separately, because `eslint-config-next` already includes it.
2. Add `"lint": "eslint . --max-warnings 0"` to `scripts`. Do not use `next lint`, which Next 15.5 deprecates.
3. Create `eslint.config.mjs` (new). Use `FlatCompat` to extend `next/core-web-vitals`. Add `settings: { 'jsx-a11y': { components: { Link: 'a', Icon: 'svg' } } }` so the linter checks `next/link` as an anchor. Set `jsx-a11y/alt-text`, `img-redundant-alt`, `anchor-has-content`, `aria-props` and `aria-hidden-on-focusable` to `'error'`.
4. Run `npm install` and commit the updated `package-lock.json`. The `lockfile` job (`.github/workflows/ci.yml:223`) only regenerates a missing lockfile. A stale one just makes `npm ci` fail.
5. With an ESLint config in place, `next build` lints too, in both the `routes` job and Vercel. Fix every existing error first. If that is not practical, set `eslint: { ignoreDuringBuilds: true }` in `next.config.mjs` and leave enforcement to the lint job.
6. In `.github/workflows/ci.yml`, add a `lint` job copied from `typecheck` (`:259-277`) that runs `npm run lint`. In the header comment, change "Six things" to "Seven" and make e2e the eighth.
7. Add `aria-hidden="true"` to the initial circles at `app/(public)/[firm]/layout.tsx:91` and `app/(public)/[firm]/page.tsx:139`. Copy the pattern in `src/components/portal/firm-switcher.tsx:48`.
8. In `checklist.tsx:114` and `:135`, wrap each glyph in `<span aria-hidden="true">` and add `sr-only` text: "Done", "Set aside" or "To do". Copy the pattern in `app/firm/(console)/admin/services/page.tsx:291` and `:303`.
9. At `documents-tab.tsx:340` and `staff-documents.tsx:626`, change `alt={preview.doc.name}` to ``alt={`Preview of ${preview.doc.name}`}``. Add the same prefix to the iframe `title` at `:343`, `:629` and `src/components/portal/sign-dialog.tsx:75`.
10. When the firm logo ships, render it in the header home link at `layout.tsx:90-96` with `alt=""`, because `{firm.name}` appears right beside it. Add a `logo_alt` brand key only if the logo is ever shown without the name.
11. In `DESIGN.md:145` ("Rules that are not negotiable"), add this rule: every `<img>` carries `alt`, a mark shown beside its own name uses `alt=""` or `aria-hidden`, and `Icon` takes `label` only when it stands alone. The rule also covers lawyer photos, which will need it once something writes `lawyer_profiles.photo_path`. Nothing writes it today. Name the lint job in `DESIGN.md:158`.
12. Optional: in `design.mjs` `auditPage()` (`:434`), use `push()` (`:448`) with check `name`. Have it flag an `img` with no `alt`, a `[role=img]` with no label, and an `svg` that is neither hidden nor labelled. Add `LABELS.name` at `:703`. This stays a local check unless a CI job is added. Its routes never open the preview modal or the MFA enrol step.

**How to check it.**
- `npm run lint` passes locally and in the new `lint` job.
- Negative test: remove `alt` from `mfa-setup.tsx:139`. `npm run lint` must fail on `jsx-a11y/alt-text`. Then revert the change.
- Manual: in NVDA or VoiceOver, the tenant header link and each lawyer card read the name once. Each checklist row reads its status in words.
- Lint cannot catch an icon-only button with no name, because it treats `<Icon/>` as possible content. The audit found no such button today. Keep checking by hand, or run `npm run test:design` after step 12.

**Decision needed.** The product owner should decide whether uploads ask for a short description to use as alt text. If they do, that later work needs a migration (the next free number after `20260910000063`). It must extend the column grants at `20260910000040_document_templates_and_execution.sql:117-118` and `:130-131` and pass the value through `createDocument` (`src/lib/actions/portal.ts:96`).

**Risk if left.** Screen-reader users hear stray letters, unlabelled status marks and file names instead of descriptions, which cuts against the Discrimination Against Persons with Disabilities (Prohibition) Act 2018 and the NDPA 2023 duty to make information to data subjects easily accessible. Not legal advice.

### 14. Fix your color contrast ratio

**Status:** partial · **Priority:** P1 · **Effort:** L

**Where it stands.** A WCAG linter exists in `tests/fixtures/contrast.mjs:44-69` and `tests/fixtures/design.mjs`. No job in `.github/workflows/ci.yml` runs it, and its own README says "It is red today" (`tests/fixtures/README.md:164`). Tenant #1's seeded accent `#B08D57` (`supabase/seed.sql:25`) scores 2.84:1 on its surface. It is still used as small text at `app/(public)/[firm]/page.tsx:95` and as a focus ring at `src/components/ui/button.tsx:100`. The default accent `#8a6d3b` (`src/lib/brand.ts:10`) scores 4.30:1 behind the auth eyebrow at `app/firm/(auth)/start/page.tsx:51`. One `--dk-primary` serves both text and fill (`tailwind.config.ts:39`), and light-theme tenant colours are output exactly as the firm typed them (`src/lib/brand.ts:324`). The linter ignores `opacity`, it only ever sees one palette (`tests/fixtures/supabase-mock.mjs:91`), and nothing handles `forced-colors`.

**How to add it.**
1. Create `src/lib/colour.ts` (new) with no imports. Move `parseHex`, `relativeLuminance`, `contrastRatio`, `readableForeground` and `liftForDark` into it, and re-export them from `src/lib/brand.ts`.
2. Add `darkenForLight(colour, ground, need = 4.6)` to that file. Model it on `liftForDark()`, but have it lower HSL lightness instead of raising it.
3. In `brandStyle()` (`src/lib/brand.ts:301`), output `--dk-primary-text-l/-d` and `--dk-accent-text-l/-d`. The `-l` value is darkened against the lighter of the surface and `#FAF9F7`. The `-d` value is the lifted colour. Do not change `--dk-primary-l` or `--dk-accent-l`, because they also paint fills.
4. Register the new tokens: defaults at `app/globals.css:34-42`, aliases at `:282-286` and in all four blocks at `:488-525`, and `brand.text` and `brand.accent-text` in `tailwind.config.ts:38-45`.
5. Add a `text-brand-accent` rule to `scripts/codemod-classes.mjs` and run it over the nine files that use that class. Then do the same for `text-brand` where it sits on a surface.
6. Point `outline-brand-accent` (`src/components/ui/button.tsx:100`) and `outline-brand` (`src/components/ui/input.tsx:21,131`) at the new text tokens.
7. Set `DEFAULT_TOKENS.accent` (`src/lib/brand.ts:10`) and `app/globals.css:37` to a darker gold, for example `#7d6235` (5.08:1 on `#f5f1e8`).
8. In `brandStyle()`, adjust any fill whose `readableForeground()` result is below 4.5:1. That helper (`src/lib/brand.ts:72-81`) only picks a foreground colour, so it cannot fix this on its own.
9. Replace the raw status span at `app/app/(portal)/matters/page.tsx:49-54` with `MatterStatusChip` (`src/components/ui/badge.tsx:161`).
10. Change `text-white/40` (3.78:1) at `src/components/video/consultation-room.tsx:569,577` to `text-white/60` or higher.
11. Use `readableForeground()` for `accentText` at `consultation-room.tsx:222` and for `color` at `src/lib/brand-icon.tsx:14`.
12. Remove the `opacity-*` utilities from text at `app/(public)/[firm]/layout.tsx:85,143-163`. This includes the Privacy notice and Terms links.
13. Show live contrast ratios in `ColourField` and in the "How it looks" preview (`app/firm/(console)/admin/settings/settings-forms.tsx:832-907`). Show them beside the colour picker at `app/firm/(auth)/start/firm-start.tsx:153` too.
14. Return a warning and a suggested colour from `updateBrand` (`src/lib/actions/firm-settings.ts:563`) and from `app/firm/(auth)/start/actions.ts:32-37`.
15. In `auditPage()` in `tests/fixtures/design.mjs`, multiply the `opacity` of the element and each ancestor into `fg.a`. Make the same change in `contrast.mjs`.
16. Give `FIRM_2` (`tests/fixtures/supabase-mock.mjs:91`) its own brand, for example primary `#f2c94c`, surface `#ffffff` and `dark_mode: true`. Make the mock client a member of both firms.
17. Change `design.mjs:178,185` so they read every slug and every colours block. Run the public routes once per slug, and the portal once per firm using the selected-firm cookie (`src/lib/portal-firm.ts:86-101`).
18. Add a `@media (forced-colors: active)` block to `app/globals.css`. Use `CanvasText` for the Switch track, `currentColor` for pill borders and `Highlight` for the focus outline.
19. Add a `design.mjs` pass that runs under `page.emulateMedia({ forcedColors: 'active' })`.
20. Create `scripts/check-brand.ts` (new) that imports only `src/lib/colour.ts`. Run it in the `deno` job next to `check-pdf.ts` (`.github/workflows/ci.yml:327`).
21. Add a `fixtures` job to `ci.yml` that runs `npm run test:design` against the mock. Make it blocking once it is green, keep `IGNORE` empty, and update `docs/UX_AUDIT.md:120`.

**How to check it.**
- `deno run --node-modules-dir=none scripts/check-brand.ts` passes the named cases (`#B08D57` on `#F7F5F0`, `#8a6d3b` on `#f5f1e8`) and a grid of hex colours. Every text token must reach 4.5:1 and every focus token 3:1, in both themes.
- `npm run test:design` reports no contrast findings for either firm, in light, dark and forced-colours modes.
- Manual check: in a live call, DevTools shows the caption at `consultation-room.tsx:569` at 4.5:1 or more. The linter cannot reach it, because `design.mjs:371-374` blocks Daily.

**Decision needed.** The owner must decide what happens when a firm picks a colour below AA: warn, as planned, or refuse. A refusal would belong in the `validate_brand` trigger, not the app.

**Risk if left.** Gold text at 2.84:1 on tenant #1's site and dimmed privacy links weaken the case that notices are clear and accessible under NDPA 2023, the GAID and FCCPA 2018, and they exclude low-vision users protected by the Discrimination Against Persons with Disabilities (Prohibition) Act 2018. Not legal advice.

### 15. Add keyboard navigation

**Status:** partial · **Priority:** P2 · **Effort:** L

**Where it stands.** Only pages drawn by `AppShell` get a "Skip to content" link (`src/components/shell/app-shell.tsx:50-55`). The tenant site, landing page, admin and registry have none (`app/(public)/[firm]/layout.tsx:137`, `app/page.tsx:168`, `app/admin/layout.tsx:133`, `app/registry/layout.tsx:94`). `useDialogBehaviour` (`src/components/ui/dialog.ts:29`) traps Tab, makes the page inert and restores focus, but the firm switcher uses an Escape-only effect (`src/components/portal/firm-switcher.tsx:91-105`) and the call overlay has no dialog semantics (`src/components/video/consultation-room.tsx:437-442`). Six fields swap the outline for a border colour, which `DESIGN.md:149-152` forbids, and upload labels such as `src/components/portal/documents-tab.tsx:214-219` show no focus. The only keyboard test covers the More sheet (`tests/fixtures/navigation.mjs:168-229`), and the focus check at `tests/fixtures/ergonomics.mjs:111-114` is dead because Tailwind sets `--tw-ring-shadow` on every element.

**How to add it.**
1. Move the link at `app-shell.tsx:50-55` into `src/components/shell/skip-link.tsx` (new) and use it in `AppShell`.
2. Render `<SkipLink />` first in `app/(public)/[firm]/layout.tsx`, `app/page.tsx`, `app/admin/layout.tsx`, `app/registry/layout.tsx` and `src/components/auth/auth-frame.tsx`.
3. Give each target `<main>` `id="main" tabIndex={-1}`: the four above, the early returns at `app/admin/layout.tsx:51,77`, `app/registry/layout.tsx:45,60` and `app/firm/(console)/layout.tsx:50,72`, the auth pages, `app/not-found.tsx:76`, `app/app/not-found.tsx:60` and `app/error.tsx:45`.
4. Change the `<main>` at `app/app/(portal)/consent-gate.tsx:30` to a `<div>`, since it sits inside `app/app/(portal)/layout.tsx:107`.
5. Rebuild the firm switcher on `useDialogBehaviour`: delete the effect at `:91-105`, put `ref` and `tabIndex={-1}` on the dialog at `:128`, and make the backdrop `<button>` at `:122-127` an `aria-hidden` div, as at `src/components/shell/primary-nav.tsx:235`.
6. Add a `noEscape` option to `useDialogBehaviour` so Escape cannot end a call.
7. Give the overlay at `consultation-room.tsx:437-442` a ref, `role="dialog"`, `aria-modal="true"` and an `aria-label`, and call `useDialogBehaviour` with `open: inRoom` and `noEscape: true`.
8. Swap the six fields (`app/app/(portal)/profile/page.tsx:46`, `app/app/(portal)/search/page.tsx:110`, `app/firm/(console)/search/page.tsx:128`, `app/firm/(console)/appointments/[id]/notes-form.tsx:18`, `src/components/firm/collaboration-inbox.tsx:135`, `src/components/portal/accept-authority-form.tsx:35`) for `<Input>` or `<Textarea>` from `src/components/ui/input.tsx`, which carry `fieldClasses` (`:19-21`), not the private `focusRing`.
9. Create `src/components/ui/file-button.tsx` (new): a `<label>` with the `sr-only` file input inside it, the `focus-within:outline` classes from `src/components/portal/messages-thread.tsx:227`, and `min-h-11`. Pass through `onClick`, an input `ref`, `accept`, `multiple` and `disabled`.
10. Use `FileButton` at `documents-tab.tsx:214,298`, `app/firm/(console)/matters/[id]/staff-documents.tsx:465,509,574`, `app/firm/(console)/admin/import/import-wizard.tsx:289` and `app/(public)/[firm]/book/booking-wizard.tsx:698-712`, moving the wizard input inside its label.
11. Implement the APG tabs pattern (roving `tabIndex`, arrow, Home and End keys, `aria-controls` to a `role="tabpanel"`) in `src/components/auth/sign-in-forms.tsx:726-744` and `app/firm/(auth)/join/join-form.tsx:70-72`. Keep `role="tab"`, which `tests/e2e/smoke.spec.ts` and `tests/integration/journeys.spec.ts:110` select.
12. In `booking-wizard.tsx`, focus a `tabIndex={-1}` step title (`:319`) in a `useEffect` keyed on `stepIdx`.
13. Wrap the intake chips at `booking-wizard.tsx:650-656` in `role="radiogroup"` with a roving `tabIndex` and arrow keys.
14. Add focus-ring classes to the date, slot and Back buttons (`:421-433`, `:449-460`, `:309-317`), and raise Back and `src/components/portal/screen.tsx:71` from `size-9` to `size-11`.
15. Remove `autoFocus` at `app/app/(portal)/search/page.tsx:108` and `app/firm/(console)/search/page.tsx:126`.
16. Move `sessionCookie`, `newPage()` and `interactive()` (`navigation.mjs:23-83`) and `ROUTES` (`tests/fixtures/design.mjs:206`) into `tests/fixtures/lib.mjs` (new); both scripts exit on import today.
17. Write `tests/fixtures/keyboard.mjs` (new), driven by the real Tab key. Assert the first stop is "Skip to content", every stop is visible with a 3:1 outline via `browserInstallScript()` (`tests/fixtures/contrast.mjs:103`), and the `navigation.mjs:168-229` dialog checks pass for `Modal`, the firm switcher and the call overlay. Add `test:keyboard` to `package.json` and `test:fixtures`.
18. In `ergonomics.mjs`, drop the `--tw-ring-shadow` clause, compare focused against unfocused styles, then push failures at `:121` into `problems`.
19. Add `@axe-core/playwright` and `tests/e2e/a11y.spec.ts` (new) with tags `wcag2a`, `wcag2aa`, `wcag21aa` and `wcag22aa`. CI already runs `tests/e2e` (`.github/workflows/ci.yml:463`), and `src/lib/csp.ts` needs no new origin.
20. Add a keyboard-only booking journey to `tests/integration/journeys.spec.ts`.
21. Once item 13 adds ESLint, split the backdrop out of `src/components/ui/modal.tsx:28-43`, move the `onClick` at `documents-tab.tsx:215` onto the input, then make the `jsx-a11y` keyboard rules errors and add a fixtures job to `ci.yml`.
22. Record these rules beside `DESIGN.md:149-152`, naming `keyboard.mjs` as their check.

**How to check it.**
- `npm run test:keyboard` passes on every route and fails if a skip link, focus ring or trap is removed.
- `npm run test:e2e` reports no axe violations; `npm run test:integration` finishes the booking by keyboard.
- Manual: Tab through `/[firm]/book`, the documents tab, the firm switcher and a waiting room. Focus stays visible and returns to the opener.

**Risk if left.** Clients who rely on a keyboard or screen reader may be unable to book, pay, upload documents or join a call, exposing firms to complaints under the Discrimination Against Persons with Disabilities (Prohibition) Act 2018 and to FCCPA 2018 fair-dealing claims. Not legal advice.

### 16. Add your business details

**Status:** partial · **Priority:** P1 · **Effort:** M

**Where it stands.** Firms can already store a registered name, RC/BN, TIN and contact details (`src/lib/actions/firm-settings.ts:310-334`), and the tenant footer shows the legal name (`app/(public)/[firm]/layout.tsx:164`). `firm_public` has no `rc_number` column (`supabase/migrations/20260910000013_security_review.sql:167-171`), so no public page shows an RC/BN. The client invoice PDF prints no RC or TIN either (`app/app/(portal)/payments/[invoice]/pdf/route.ts:46-49`). No page identifies the platform operator: the landing footer says only "© Docket" (`app/page.tsx:306`), the shared auth footer is the same (`src/components/auth/auth-frame.tsx:89`), and the tenant footer says "by Docket" (`app/(public)/[firm]/layout.tsx:165`). Nobody has decided which entity operates the platform yet (`Docket_Build_Blueprint_v0.2.md:479`), and tenant #1's seed row has no RC/BN and null contact details (`supabase/seed.sql:13`, `:27`).

**How to add it.**
1. Record the platform entity in `docs/decisions/0005-platform-entity.md` (new), next to `0003-platform-first.md`.
2. Add a server-only `platformOperator()` helper to `src/lib/env.ts`. It reads `PLATFORM_LEGAL_NAME`, `PLATFORM_RC_NUMBER`, `PLATFORM_ADDRESS`, `PLATFORM_EMAIL` and `PLATFORM_PHONE`, and returns `null` when the name is unset. Do not use a `NEXT_PUBLIC_` prefix. Document the variables in `.env.example`.
3. Render an operator block in the landing footer at `app/page.tsx:305-308`. The `/` page is a prerendered shell (`src/lib/csp.ts:79`), so the values are fixed at build time and changing them needs a redeploy.
4. Render the same block once in the `AuthFrame` footer (`src/components/auth/auth-frame.tsx:88-93`). It is a server component used by `app/app/(auth)/layout.tsx` and `app/firm/(auth)/layout.tsx`, so it covers every client and staff auth page.
5. In `supabase/migrations/20260910000051_firm_public_vat_and_rc.sql` (shared with item 10), append `rc_number` to `firm_public` after `vat_rate`, as item 10 step 1 does. Do not add `tin`. Keep `security_invoker = false` and the `status = 'active'` filter. Then repeat the revoke from `20260910000014_review_round_two.sql:35-38`.
6. Add `rc_number` to `FirmPublic` (`src/lib/db/types.ts:61-72`), to the select in `src/lib/tenant.ts:22`, and to the `FIRM` fixture (`tests/fixtures/supabase-mock.mjs:74-90`).
7. At `app/(public)/[firm]/layout.tsx:164-165`, show the legal name, RC/BN and the `brand.contact` address, email and phone. Replace "by Docket" with the operator's name and RC from `platformOperator()`. Add an `identifier` field holding the RC/BN to `legalServiceJsonLd` (`src/lib/site.ts:22-35`).
8. In `supabase/migrations/20260910000059_late_payments_and_invoice_issuer.sql` (shared with item 10), add `invoice_issuer(p_invoice uuid)` as `security definer`. It refuses the call unless `can_access_invoice(p_invoice)` is true (`20260910000044_verified_delegation.sql:302`). It returns `legal_name` and `rc_number`, plus `tin` only when `vat_minor > 0`. Revoke execute from `public, anon` and grant it to `authenticated`. Add it to `docs/RPC_REFERENCE.md`.
9. Call `invoice_issuer` beside `firmById` (`pdf/route.ts:29-34`). Print the RC/BN line and "VAT charged under TIN …" under the legal name at `:46`, matching `app/firm/(console)/invoices/[id]/page.tsx:266-267`. Add the RC/BN to `app/app/(portal)/payments/[invoice]/page.tsx:65`.
10. In `059` too, run `create or replace function public.firm_readiness`, copied from `20260910000034_onboarding_and_import.sql:69-130`. Add an `identity_published` fact that is true only when `legal_name`, `rc_number` and the `brand.contact` email, phone and address are all non-empty. Do not edit the applied `034` migration.
11. Add `identity_published` to `FirmReadiness` (`src/lib/db/types.ts:702`). In `app/firm/(console)/admin/checklist.tsx`, add an `identity` step after `policies` (line 30) with `skippable: false` and `href: "/firm/admin/settings"`. A non-skippable step needs no change to the check constraint at `034:35`.
12. Add `rc_number` to the column list at `supabase/seed.sql:13`, and fill `contact` at `:27` with the values tenant #1 supplies. The seed uses `on conflict (slug) do nothing` (`:40`), so a live database gets these values through `/firm/admin/settings`.

**Done in the code (lane dD).** Steps 5 and 6 are done. Migration `051` puts `rc_number` on `firm_public`, and `FirmPublic`, the `src/lib/tenant.ts` select and the `FIRM` fixture include it. Nothing displays it yet. Steps 1 to 4 and 7 to 12 are still open. Most of them wait on migration `059` or the platform entity decision.

**How to check it.**
- `supabase/tests/70_deployed_frontend_compat.sql` already selects `rc_number` in the tenant-resolver column list (`:117-118`), checks that anon reads it (`:221-223`), and checks that `firm_public` has no `tin` column (`:254-256`).
- `supabase/tests/20_platform.sql`: add `t_check` cases. The invoice's client gets `rc_number` from `invoice_issuer`, a stranger gets `42501`, and `tin` is null when `vat_minor = 0`. The read-only loop at `:270-271` already covers `firm_public`.
- `supabase/tests/99_onboarding_import.sql`: `identity_published` is false for a new firm and true once all fields are set.
- Raise the floors in `supabase/tests/expected-checks.tsv` and update the counts at `README.md:7`.
- `tests/e2e/smoke.spec.ts`: assert that the tenant footer shows "RC/BN". With the `PLATFORM_*` variables set, assert that the landing and `/app/login` footers show the operator's RC.
- Manual: download a VAT invoice PDF and confirm it shows the RC/BN and TIN lines.

**Decision needed.** The owner must decide which company operates Docket (blueprint §14.2) and supply its registered name, RC number, address, email and phone. Tenant #1 must supply its real RC/BN and public contact details. Do not invent them.

**Risk if left.** With no identified operator and no tenant RC/BN, the platform and its firms fall short of the NDPA 2023 and NDPC GAID rule that a controller must be identifiable and contactable. They also fall short of CAMA 2020 and FCCPA 2018 expectations that a trader discloses its registered identity. Not legal advice.

### 17. Get age consent if you collect kids' data

**Status:** missing · **Priority:** P1 · **Effort:** L

**Where it stands.** `consent_kind` has no age or guardian value (`supabase/migrations/20260909000001_schema.sql:22`), and `profiles` has no birth date (`:26-40`). The booking steps are service, mode, when, intake and review (`app/(public)/[firm]/book/booking-wizard.tsx:126-131`), and `book_appointment()` only checks that policies are published (`supabase/migrations/20260910000035_pre_consultation_checkin.sql:423`). The portal gate checks only terms and privacy rows (`app/app/(portal)/layout.tsx:67-74`), and `consent_records_insert` allows only `user_id = auth.uid()` (`supabase/migrations/20260910000021_hardening.sql:64-65`). Tenant #1 sells custody work (`supabase/seed.sql:52`), yet `representations` has no guardian capacity (`supabase/migrations/20260910000044_verified_delegation.sql:77,87`).

**How to add it.**
1. Create `supabase/migrations/20260910000061_minors.sql` (new). Add `age_confirmation` and `guardian` to `consent_kind` with `add value if not exists`, as at `20260910000010_nigeria_reference.sql:245`. Use the new values only inside plpgsql bodies in that file.
2. In that file, add `consent_records.on_behalf_of uuid references public.profiles(id) on delete cascade`.
3. Item 6's `053` drops `consent_records_insert` and revokes direct insert. Recreate item 6's `record_consent` instead, so a non-null `on_behalf_of` needs a live, accepted `parent_guardian` representation with `representative_id = auth.uid()` and `principal_id = on_behalf_of`.
4. Widen the `representations` checks at `44:77` (add `parent_guardian`) and `44:87` (add `birth_certificate` and `guardianship_order`).
5. Recreate `accept_representation()` (`44:421`) to write a `guardian` row, `on_behalf_of` the principal, when a `parent_guardian` representation is accepted.
6. Drop and recreate `book_appointment()` (latest in item 6's `053`, which starts from `35:404`) with `p_age_basis` (`adult` or `guardian`). It refuses a null basis and writes the matching consent row at the current privacy version. Repeat the revoke and grant.
7. Add `matters.involves_minor` and `matter_adverse_parties.is_minor`, both `boolean not null default false`.
8. Drop and recreate `open_matter()` (latest at `20260910000039_workflow_packs.sql:254`) with `p_involves_minor`, reading `is_minor` from `p_adverse_parties`. Repeat the revoke and grant as at `20260910000032_conflict_checks.sql:345-346`.
9. Regenerate `src/lib/db/database.types.ts`.
10. Add the new capacity and both authority kinds to `src/lib/delegation-copy.ts:8-25`. It feeds the zod enums (`src/lib/actions/delegation.ts:25-26`) and the console select (`src/components/firm/representations-panel.tsx:129-133`). `grant_representation()` (`44:351-357`) accepts only an existing client, so this route serves minors who hold an account.
11. Create `src/components/auth/age-basis-field.tsx` (new): a required choice between "I am 18 or older" and "I am a parent or guardian acting for someone under 18". Anyone else is told a parent or guardian must act.
12. Add it to `app/app/(portal)/consent-gate.tsx`. Extend `consentSchema` and `recordConsent` (`app/app/(portal)/actions.ts:14-48`) to write the row.
13. Require that row in the gate condition at `app/app/(portal)/layout.tsx:67-74`, so existing clients are asked.
14. Add it to the review step of `booking-wizard.tsx` (`:496-566`) and pass it through `bookAppointment` (`src/lib/actions/booking.ts:78-90`).
15. Extend the zod schemas in `src/lib/actions/matters.ts` (`:69`, `:542-560`). Add a minor checkbox to `app/firm/(console)/matters/new/new-matter-form.tsx` and `app/firm/(console)/matters/[id]/conflicts-panel.tsx`.
16. Show an `Alert` on `app/firm/(console)/matters/[id]/page.tsx` when `involves_minor` is true.
17. Add firm-neutral children's-data guidance to the privacy hint in `app/firm/(console)/admin/settings/settings-forms.tsx:934-963` and to `docs/ADMIN_GUIDE.md` §1 (`:337`). The firm writes the paragraph. It shows publicly only once item 1 makes `policy-page.tsx` render `policies.privacy.text`.
18. Update `docs/COMPLIANCE_PACK.md` §1.3 and §2. Rewrite the "nobody can consent on somebody else's behalf" line (`:154`).

**How to check it.**
- `supabase/tests/99_minors.sql` (new), using `t_check`: `book_appointment()` refuses a null basis; an `on_behalf_of` insert fails without a live `parent_guardian` representation; `accept_representation()` writes the `guardian` row; `open_matter()` stores both flags.
- Add a new line `tests/99_minors.sql<TAB>N` to `supabase/tests/expected-checks.tsv`. Update the counts in `README.md:7` (one more migration, one more suite and the new check total).
- Re-run `99_delegation.sql`, which inserts literal capacities at `:332`.
- Manually, sign in as a client who accepted only terms and privacy. The gate must ask for the age basis.

**Decision needed.** A lawyer should confirm the age of 18 and the wording. The owner must decide whether a minor may revoke a guardian's authority (`44:483`) or receive its notifications. The owner must also decide which documents prove guardianship, and whether any MFA member under `staff_w` (`20260910000013_security_review.sql:127-129`) or only a lawyer may verify it.

**Risk if left.** Docket takes custody work but has no age check and cannot record a parent's consent, which NDPA 2023 s.31 and the GAID require before a child's personal data is processed. Not legal advice.

### 18. Add an unsubscribe link to your emails

**Status:** partial · **Priority:** P1 · **Effort:** L

**Where it stands.** `enqueue_notification` skips an event and channel the person switched off (`supabase/migrations/20260910000037_notifications_reliability.sql:111-113`). `claim_notifications` never re-checks, so a row queued before an opt-out still goes out (`20260910000037_notifications_reliability.sql:157-187`). `sendEmail` sets no headers and adds no footer, and no event is classed transactional (`supabase/functions/dispatch-notifications/index.ts:208-213`). Nigerian texts go on Termii's `dnd` route from an alphanumeric sender ID, so a STOP reply cannot arrive (`index.ts:227`, `.env.example:128-130`), and a Resend complaint is only noted (`supabase/functions/delivery-receipts/index.ts:156`). `src/lib/providers/messaging/resend.ts` is dead code: nothing imports `emailProvider()` (`src/lib/providers/messaging/index.ts:10`).

**How to add it.**
1. In `src/lib/notifications-copy.ts`, add a `NOTIFICATION_EVENTS` registry (`event`, `label`, `audience`, and `category`, which is `transactional`, `service` or `marketing`). It must cover every case in `render()` (`dispatch-notifications/index.ts:142-191`). Keep every `PREFERENCE_EVENTS` row. Point `TemplatesSection` (`app/firm/(console)/admin/settings/settings-forms.tsx:1181`) at the full client registry, so firms can still reword transactional messages.
2. Create `supabase/migrations/20260910000062_notification_unsubscribe.sql` (new). Add `notification_events` seeded from step 1, `notification_suppressions(user_id, channel, reason)` and `notification_unsubscribe_tokens(user_id, event, channel, token_hash unique, revoked_at)`. Copy the `calendar_feeds` token pattern (`20260910000047_calendar_feed.sql:71-75, 119-122`).
3. In the same migration, add `unsubscribe_via_token(p_token, p_all)`. It raises `42501` on a short or unknown token and calls `rate_limit_hit`. It turns off only non-transactional events and calls `audit('notification.unsubscribed', …)`. Grant it to `anon`, because the Next app holds no service role.
4. In the same migration, run `drop function public.claim_notifications(int)`. Then recreate it with `category` and `unsubscribe_token` columns, because `create or replace` cannot change a `RETURNS TABLE` definition. Repeat the revoke at `037:188`. Skip rows that match a disabled preference or a suppression, as the WhatsApp skip does at `037:165-166`. For each optional email, mint a token, store its hash and return the plaintext. Never return the row id.
5. In the same migration, start from 058's `enqueue_notification` body and add the suppression check. Keep honouring saved opt-outs for transactional events (`docs/COMPLIANCE_PACK.md:375-377`). Add `suppress_email_for_ref` and `record_sms_opt_out`, callable by the service role only.
6. Create `supabase/functions/unsubscribe/index.ts` (new), reading the token from the path as `calendar-feed/index.ts:35` does. It accepts only a POST of `List-Unsubscribe=One-Click` and returns 200 `text/plain`. Add it to `docs/DEPLOYMENT_RUNBOOK.md:240-252` with `--no-verify-jwt`, and update the function count.
7. Create `app/app/(auth)/unsubscribe/[token]/page.tsx` (new). The `/app` prefix escapes the tenant rewrite (`middleware.ts:53`), and the page needs no sign-in. A GET only shows a confirm button. Its server action posts to `'self'` (`src/lib/csp.ts:252`) and calls the RPC.
8. In `sendEmail`, add Resend `headers` to optional mail: `List-Unsubscribe` set to the function URL, and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. After the override block (`index.ts:331-343`), append an escaped footer that names `r.firm_name` and links to preferences and to `/app/unsubscribe/TOKEN`. Transactional mail gets the preferences link only.
9. Delete `src/lib/providers/messaging/resend.ts` and its export.
10. Do not add "Reply STOP" to Termii texts. Append a preferences link to optional SMS instead (`index.ts:353`). Add a `/twilio-inbound` route to `delivery-receipts/index.ts:211-218`, signed against a new `TWILIO_INBOUND_URL`, that calls `record_sms_opt_out`. Treat Twilio error 21610 (`index.ts:251`) as a suppression.
11. In `handleResend` (`delivery-receipts/index.ts:136`), call `suppress_email_for_ref` on complaints and on hard bounces.
12. In `preferences-form.tsx`, add "All optional emails" and "All optional SMS" rows. Show transactional rows as always sent. Fix the "always on" copy at `page.tsx:35`. Add a staff notifications card to `app/firm/(console)/me/page.tsx`.
13. Update `docs/COMPLIANCE_PACK.md` §6d, `docs/CLIENT_GUIDE.md:272` and `docs/RPC_REFERENCE.md`.

**How to check it.**
- Add `t_check` rows to `supabase/tests/99_notifications.sql`. Assert that a row queued before an opt-out is skipped at claim, that a suppression skips the send, that a bad token raises `42501`, and that a token never turns off a transactional event. Raise the floor at `supabase/tests/expected-checks.tsv:40` (currently 47) and the counts at `README.md:7`.
- POST `List-Unsubscribe=One-Click` to the function with `curl` and expect a 200. Confirm that a GET changes no row in `notification_preferences`.
- Add `/app/unsubscribe/…` to `tests/fixtures/design.mjs` near line 237, then run `npm run test:design`.
- Send one optional email to Gmail. "Show original" must list both headers.

**Decision needed.** The owner or a lawyer must sign off the list of transactional events. The business must decide whether to buy a two-way Nigerian number, so that +234 texts can accept STOP replies.

**Risk if left.** Without one-click unsubscribe, a claim-time re-check and complaint suppression, a client's objection to messages under NDPA 2023 s.36 and the NDPC GAID may go unhonoured, and any non-transactional text on the DND route invites NCC and FCCPA 2018 complaints. Not legal advice.

### 19. License any fonts and images you use

**Status:** partial · **Priority:** P2 · **Effort:** M

**Where it stands.** Every font in use is openly licensed, but no `LICENSES/` directory or notices file records it. The console loads Archivo and Inter from Google Fonts (`app/firm/(console)/layout.tsx:43-44`). Tenant #1 ships Fraunces and Inter (`supabase/seed.sql:26`) through `brandFontsUrl` (`src/lib/brand.ts:351-357`). No images or audio are bundled, but the icon set cites a `design/pwa` prototype that does not exist (`src/components/ui/icon.tsx:7`, and again at `src/components/video/consultation-room.tsx:10`). Logos go to the public-read `firm-assets` bucket (`supabase/migrations/20260909000004_supabase_storage_cron.sql:14-15`), no upload surface says the uploader must hold the rights, and the "Docket firm terms" cited at `app/firm/(auth)/start/firm-start.tsx:159` do not exist.

**How to add it.**
1. Create `docs/THIRD_PARTY_NOTICES.md` (new) with one table: asset, where used (`path:line`), source, licence and copyright holder.
2. Add SIL OFL 1.1 rows for Archivo (`app/firm/(console)/layout.tsx:44`, `app/not-found.tsx:21`), Inter (`layout.tsx:44`, `supabase/seed.sql:26`) and Fraunces (`seed.sql:26`, loaded at `app/(public)/[firm]/layout.tsx:80` and `app/app/(portal)/layout.tsx:101`). Archivo and Fraunces also load in `design/home/Main.dc.html:10`. `app/marketing-os.css:8` and `app/registry/layout.tsx:35` only name Inter and never load it.
3. Add one generic row for tenant-chosen families (free text, `src/lib/brand.ts:351`). Google Fonts serves them under OFL, Apache 2.0 or UFL, and Docket never redistributes them.
4. Add a row for the fallback font that `next/og` uses when `src/lib/brand-icon.tsx:14` asks for `serif`. After `npm ci`, read its name and licence in `node_modules/next/dist/compiled/@vercel/og`.
5. Add a row for `src/components/ui/icon.tsx` as original work, with the author and licence the owner confirms.
6. Add `LICENSES/OFL-1.1.txt` (new) with the unmodified OFL text, and link it from the notices file.
7. Replace the comment at `src/components/ui/icon.tsx:7` with a pointer to `docs/THIRD_PARTY_NOTICES.md`.
8. Delete `(design/pwa)` from the comment at `src/components/video/consultation-room.tsx:10`.
9. Extend the Icons rule at `DESIGN.md:139-140`. Any new font, icon, image, audio file or illustration must be original or have a notices row.
10. Add a user-content clause to the platform terms and firm agreement from item 2. The firm warrants it holds the rights in every logo, photo and document that it, its staff or its clients upload. It grants Docket a limited hosting licence and an indemnity. A notice-and-takedown procedure names a contact. Name only Docket or its entity, never a firm.
11. Put the clause in item 2's `app/docket/terms/page.tsx` (new) and `app/docket/firm-agreement/page.tsx` (new). Do not use `app/terms/page.tsx`: on a firm host, `/terms` serves that firm's own terms.
12. Item 2 replaces "the Docket firm terms" at `firm-start.tsx:159` with a linked checkbox and records acceptance in `supabase/migrations/20260910000054_platform_consents.sql` (new).
13. Add the same link to the footers at `app/page.tsx:306` and `src/components/auth/auth-frame.tsx:89`.
14. Append to the logo hint at `app/firm/(console)/admin/settings/settings-forms.tsx:787`: "Upload only a logo your firm owns or is licensed to use."
15. Add a one-line rights notice at `app/firm/(console)/matters/[id]/staff-documents.tsx:463`, `src/components/portal/documents-tab.tsx:219`, `app/(public)/[firm]/book/booking-wizard.tsx:714` and `src/components/portal/messages-thread.tsx:229`, which serves both the console and the portal. Extend the existing muted hint, or use the shared `Alert` (`src/components/ui/alert.tsx:23`). Do not import `Labelled`: it is private to `settings-forms.tsx:155`.
16. In `docs/ADMIN_GUIDE.md`, add two notes. Section 1 (line 337) says a firm's client terms should make clients responsible for their uploads. Section 7 (line 564) says the logo and fonts must be ones the firm may use. Leave the firm-authored placeholder at `supabase/seed.sql:36` alone.
17. Create `scripts/check-asset-licences.mjs` (new). It walks `app/`, `public/`, `src/` and `design/`, and it fails on any regular font, image, audio or video file that has no notices row. It skips directories, because `app/icon-192.png` and `app/icon-512.png` are route folders. It also fails on any unlisted `family=` in a `fonts.googleapis.com` string and on any unlisted `next/font/google` import.
18. Run it as a step in `.github/workflows/ci.yml`, next to the OpenAPI route check (`ci.yml:315`). Do not put it in `test:fixtures` (`package.json:19`), because CI never runs that script.

**How to check it.**
- `node scripts/check-asset-licences.mjs` exits 0 on the clean tree. It exits 1 after you add an unlisted `public/test.png` locally.
- `grep -rn "design/pwa" src app` returns nothing.
- `/docket/terms` and `/docket/firm-agreement` show Docket's terms, with the user-content clause, on both the platform host and a firm host, and the prerendered-route check in CI passes.
- Open the logo form and the four upload points by hand. Each one shows the rights line.

**Decision needed.** The owner must name the platform contracting entity (`Docket_Build_Blueprint_v0.2.md:479`) and a takedown contact. The owner must also confirm who drew the icons. A lawyer should approve the user-content and indemnity wording.

**Risk if left.** Firms upload logos to a public bucket under no terms, so Docket could face claims under the Copyright Act 2022 and the Trade Marks Act with no indemnity and no takedown procedure to rely on. Not legal advice.

### 20. Add a data deletion request option

**Status:** partial · **Priority:** P1 · **Effort:** L

**Where it stands.** No screen lets anyone ask for deletion. The client profile ends with consent history and two sign-out buttons (`app/app/(portal)/profile/page.tsx:144-163`). Staff get only "Sign out" (`app/firm/(console)/me/page.tsx:174`), and the registry nav offers nothing (`app/registry/layout.tsx:83-90`). The only instruction, "ask your firm", lives in `docs/CLIENT_GUIDE.md:274-277`, which no screen links. Tenant #1's contact email is null (`supabase/seed.sql:27`). A manual runbook exists (`docs/COMPLIANCE_PACK.md:272-371`), but no table records requests and no code anonymises anyone. `appointments.client_id` and `invoices.client_id` block a hard delete (`supabase/migrations/20260909000001_schema.sql:156,352`). No retention job exists (`docs/COMPLIANCE_PACK.md:251-263`). The pack's claim at lines 259-260 that `deleted_at` is never set is stale: `retire_empty_document()` sets it (`supabase/migrations/20260910000036_drafts_and_retries.sql:189`).

**How to add it.**
1. Create `supabase/migrations/20260910000063_data_subject_requests.sql` (new), modelled on `20260910000031_document_requests.sql`. Add `data_subject_requests`: nullable `firm_id` (null means Docket is controller), `requester_id` referencing `profiles` on delete set null, and check constraints on `kind` and `status`. Also add `note`, `due_on`, `decided_by`, `decision_note` and `completed_at`. Attach `audit_row_change()`.
2. In the same migration, enable RLS. Requesters select their own rows. Owners and admins select through `has_firm_role()` and update only through `admin_w(firm_id)`. Platform admins select and update only `firm_id is null` rows, under `is_platform_admin() and mfa_ok()`. Revoke insert and delete from `anon` and `authenticated`. Do not copy the insert grant at `20260910000031_document_requests.sql:40`.
3. Add `request_data_action(p_firm, p_kind, p_note)` as security definer. It checks `auth.uid()`, requires a client or matter party of `p_firm` when set, and calls `rate_limit_hit()`. It then inserts with `due_on`, calls `audit()`, and calls `enqueue_notification()` for each owner and admin, or each platform admin when `p_firm` is null.
4. Register the event in `render()` (`supabase/functions/dispatch-notifications/index.ts:142-189`) with a `/firm/admin/data-requests` or `/admin` URL, not the `/app` fallback. Add it to `src/lib/notifications-copy.ts`.
5. Add `anonymise_profile(p_user, p_request)`. For firm requests, allow only `admin_w()` of that firm on a decided request. For Docket requests, allow only `is_platform_admin() and mfa_ok()` or the service role. It nulls `full_name`, `phone`, `email`, `address`, `company_name`, `country` and `state`. It deletes `push_subscriptions`, `notification_preferences`, `notifications`, `calendar_feeds`, `message_reads` and unretained `intake_responses`. It keeps `appointments`, `invoices`, `document_signatures`, `representations` and `consent_records`.
6. Add `firms.retention_years` (default 6). Add a review-queue job for closed matters past retention and filed `import_rows.raw`, following `20260909000004_supabase_storage_cron.sql:65-69`. It never deletes.
7. Add `supabase/functions/erase-subject/index.ts` (new). Authenticate as `supabase/functions/video-session/index.ts:77-103` does (`getUser()`, `aal2`), not with a cron secret. With the service-role client, call `anonymise_profile`, then remove `intake-uploads/{firm}/{user}/` objects and unretained `documents` objects. Ban the user and scramble phone and email via `auth.admin.updateUserById`. Do not delete the user. Call the PostHog and Sentry deletion APIs server-side when keys are set.
8. Add a "Your data" card to `app/app/(portal)/profile/page.tsx`, backed by a new action in `src/lib/actions/portal.ts`. Reuse the `CLIENT_GUIDE.md:274-277` wording and list open requests.
9. Add the same option to `app/firm/(console)/me/page.tsx` (action in `src/lib/actions/staff.ts`) and to the registry nav, with `p_firm` null.
10. Add `app/firm/(console)/admin/data-requests/page.tsx` (new). Link it in `admin-nav.tsx:14-26`. In `app/admin/page.tsx`, list only `firm_id is null` rows (`20260910000009_platform_firms.sql:55`).
11. Complete `COMPLIANCE_PACK.md` §6c with the missing tables, buckets and processors, and fix §5. Add a section to `docs/ADMIN_GUIDE.md` and list the RPCs in `docs/RPC_REFERENCE.md`.
12. Add `supabase/tests/99_data_subject_requests.sql` (new) using `t_check`. Add its floor to `supabase/tests/expected-checks.tsv`, and update `README.md:7` and `:135`.

**How to check it.**
- The new suite asserts four things. A direct insert as `authenticated` fails. The RPC creates a row and a notification. Another firm reads nothing, and a staff user without `aal2` cannot update. `anonymise_profile` nulls identifiers while the appointments and invoices remain.
- `scripts/check-suite-counts.sh` passes.
- Manual: request deletion as a staging client. Decide it at `/firm/admin/data-requests` and run `erase-subject`. Confirm the objects are gone and the auth user is banned.

**Decision needed.** A lawyer sets the response period used for `due_on` and the retention years per record type. Docket names who handles requests with no firm, and a published contact email.

**Risk if left.** Under the NDPA 2023 and the GAID, neither a firm nor Docket can receive, log or evidence timely erasure. Ad hoc SQL may also delete records that the Rules of Professional Conduct for Legal Practitioners and tax law require the firm to keep. Not legal advice.

## Before you start

### Decisions to make

| Decision | Unblocks items |
|---|---|
| The controller structure: what Docket controls and what each firm controls (`COMPLIANCE_PACK.md:450-452`) | 1, 4, 5, 20 |
| The platform's legal entity (blueprint §14.2) | 1, 2, 16, 19 |
| Which entity holds the platform Paystack account, and whether Docket takes a processing margin (blueprint lines 437 and 480) | 3, 10, and the "Docket never holds it" copy |
| The refund rule: who refunds, when, and how | 3, 10, 12 |
| The Supabase region, recorded in `COMPLIANCE_PACK.md` §0, and retention periods | 1, 20 |
| Whether to get a two-way SMS number, so clients can reply STOP | 18 |

### Shared groundwork

- One constant for the current platform privacy and terms versions, used by items 1, 2 and 6.
- An accessibility step in CI, used by items 13, 14 and 15. Today the design fixtures do not run in CI.
- A lawyer's review of the platform notice, the platform terms, the firm agreement and the DPA.

### New migrations named in this checklist

Before this work the newest migration was `20260910000050_tenant_dark_mode.sql`. Two migrations must never share a number, and where two items change the same function, the later migration starts from the earlier one's body. The first two rows are in the code now. The rest are reserved.

| Migration | Items | Note |
|---|---|---|
| `20260910000051_firm_public_vat_and_rc.sql` | 10, 16 | **Done.** Appends `vat_rate` and `rc_number` to `firm_public` |
| `20260910000052_booking_consent.sql` | 6 | **Done, first pass.** Adds `record_consent()`; direct inserts still work |
| `20260910000053_booking_consent_enforcement.sql` | 6 | Only after `052` and the app that calls `record_consent()` are live |
| `20260910000054_platform_consents.sql` | 2 | |
| `20260910000055_cancellation_and_defaults.sql` | 3, 7 | The one place `seed_firm_defaults` is redefined |
| `20260910000056_analytics_consent.sql` | 5 | Records a signed-in user's cookie choice; the cookie itself is done |
| `20260910000057_intake_purpose.sql` | 7 | |
| `20260910000058_notification_opt_in.sql` | 9 | Redefines `enqueue_notification` |
| `20260910000059_late_payments_and_invoice_issuer.sql` | 10, 16 | |
| `20260910000060_testimonial_guard.sql` | 11 | |
| `20260910000061_minors.sql` | 17 | Starts from 052's `record_consent` and 053's `book_appointment` |
| `20260910000062_notification_unsubscribe.sql` | 18 | Starts from 058's `enqueue_notification` |
| `20260910000063_data_subject_requests.sql` | 20 | |

Every migration added updates the migration count in `README.md:7`. Every SQL suite added updates the suite and check counts there, and adds its floor to `supabase/tests/expected-checks.tsv`. Otherwise `scripts/check-suite-counts.sh` fails CI.
