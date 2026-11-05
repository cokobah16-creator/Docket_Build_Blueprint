# Docket, the global legal workspace: architecture and implementation plan

*Written 5 November 2026 from a full inspection of this repository at `547432b` (the merge of PR #44), the local run of its 55 migrations and 33 SQL suites (1,499 checks, all passing), a clean typecheck, and a read of the infrastructure this session can reach. It is the Phase 1 deliverable of the master product prompt: what exists, what is missing, the decisions, and the order of the build. `DEVELOPMENT_CHECKLIST.md` beside it is the live status table.*

---

## 1. What exists, in one page

This repository is already a serious product. It is not a prototype and nothing in it is mocked.

| Area | State on `main` |
|---|---|
| Tenancy and security | Multitenant Postgres with row level security on every table, MFA required for every staff write (`staff_w`), opt in matter walls, append only audit log, definer functions as the only door to money, membership, documents and consent, storage policies that require a recorded read before bytes move, CSP with nonces, rate limiting in the database |
| Firms and people | Self serve registration, platform verification before a firm is public, staff invites by email, four roles (owner, admin, lawyer, staff), practitioner identity (SCN, year of call, NBA branch) |
| Matters | Matters with per firm stages (versioned workflow packs), court directory, suit numbers, counsel of record, adverse parties, conflict checks, deadlines computed from entered court rules, legal diary with provenance, timeline with structured client updates |
| Documents | Versions with checksums, document reads as the door to bytes, document requests, templates filled from matter facts, electronic and paper execution, text extraction (no OCR, said plainly), permission scoped full text search |
| Clients | Client PWA, booking funnel, video consultations (Daily), messaging with per reader receipts, delegation of authority, consent at published versions |
| Money | Invoices, items, VAT, Paystack settlement to each firm's own subaccount, payment webhook with signature and re verification, invoice issuer identity for VAT invoices |
| Between firms | Service of process with acknowledgement, matter scoped collaboration (referral, joint counsel, agency) that shares one named document version at a time, partner API, calendar feed, court registry pilot |
| Operations | Notification dispatcher with claims, receipts and costs, storage manifest, drift alarm, deployment and restore runbooks, compliance pack, legal readiness checklist |

What the master prompt asks for and the repository does not have:

| Gap | Severity |
|---|---|
| DOCKET AI: no provider, no embeddings, no retrieval, no briefing, no drafting, no usage tracking | Entire module missing |
| Docket Network as a firm level network: profiles, email verified invitations with single use codes, connections, joint matter roles, introductions, alliances, a network dashboard | Collaboration exists only per matter; everything above the matter is missing |
| Global jurisdiction engine: Nigeria is baked into reference data, defaults and copy; no jurisdiction registry, no activation lifecycle | Architecture missing |
| Granular roles and permissions, custom roles, the thirteen titles | Four roles only |
| Subscriptions and commercial model: plans, trials, AI credits, seats, platform billing | `firms.plan` is a label |
| Legal research environment with verification status | Missing |
| Expenses, credit notes, time entries, finance summary that separates invoiced from received | Missing |
| Workflow automation builder with triggers and conditions (Docket Flow) | Packs give stage to task automation only |
| Global command centre with natural language actions | Search only |
| The requested navigation and the forest green, ivory, champagne gold, charcoal identity | Navy, emerald and brass today |

## 2. Where this can be deployed from, and where it cannot

The Supabase project this session can reach (`ATTORNEYS KLINIQUE`, `bicplmtpqmxczpyhufki`) runs a different schema and different Edge Functions from this repository: its migration ledger names `legal_navigator`, `wallet-import`, `retainer_plans` and so on, none of which exist here. The Vercel project it can reach (`attorneysklinique`, serving attorneysklinique.ng) is the front end of that other system. The Docket production described in `DEPLOYMENT_RUNBOOK.md` (the project whose ledger ends at `invoice_issuer`, 59) is under an account this session does not hold.

So this plan builds and proves everything locally and in CI, and the release record stays the operator's. Every migration here is written to apply in filename order after 59 through the Supabase MCP or `supabase db push --include-all`, exactly as the runbook already describes.

## 3. Decisions

**D1. Keep the stack and extend it.** Next.js 15, React 19, TypeScript, Tailwind, Supabase (Postgres, RLS, Storage, Realtime, Edge Functions, pg_cron, Vault) and Vercel stay. The 1,499 checks are the most valuable asset in the repository; a rebuild would throw them away.

**D2. The database stays the authorization layer.** Every new table gets RLS, revoked direct writes where a function is the door, an audit trigger, and `check_row_firm()` where it hangs off a matter. Every new view is read only. Every new definer function pins `search_path`, refuses with `42501` when the caller is not permitted, and is covered by a SQL suite with a floor in `expected-checks.tsv`.

**D3. International architecture first, activation per jurisdiction.** A `jurisdictions` registry carries each country's legal system, currency, timezone, locale, court hierarchy configuration, professional requirements and data protection notes, with a lifecycle of `designed`, `validated`, `active` and `suspended`. Nigeria is the only active jurisdiction, because it is the only one whose reference data and rules have been built and reviewed. The United Kingdom, United States, Canada, Australia, Ghana, Kenya and South Africa are registered as `designed`: visible, described, and not selectable until a platform admin records a validation and activates them. Nothing assumes one country's rules apply in another: a firm carries `jurisdiction_code`, and anything jurisdiction specific reads it.

**D4. Roles: four security tiers, thirteen titles, granular permissions, custom roles.** The existing `firm_role` enum (owner, admin, lawyer, staff) remains the security tier the gates understand, and gains `readonly` and `external`. A member also has a title (Managing Partner, Senior Partner, Partner, Associate, Junior Associate, Counsel, Legal Assistant, Paralegal, Secretary, Finance Officer, Administrator, External Collaborator, Read only User, or a custom one) and a set of granular permissions resolved by `has_permission(firm, permission)`: a firm's custom role overrides the tier's defaults, and a per member grant overrides both. Permissions are enforced in the database by trigger guards on the tables they protect, so a direct PostgREST call and an RPC meet the same rule.

**D5. Docket Network is a firm level layer on top of matter level collaboration.** Migration 45 already solves the hard part: handing another firm one named document version, a snapshot of a matter, notes, and an end that closes every door. The network adds what sits above it: a firm's network profile, invitations by official email with a cryptographically random single use code stored as a hash with expiry, attempt and resend limits, an explicit accept or reject by an authorized representative, a `firm_connections` relationship with permissions each side controls, joint matters as collaborations with a role (lead, supporting, local, foreign, co counsel, specialist), shared tasks, introductions and referral requests, and alliances. Email ownership never grants access on its own; a connection is worth nothing until a firm member with the `invite_firms` permission accepts it.

**D6. Docket AI is real, provider independent, retrieval grounded and tenant isolated.** A `ChatProvider` interface with an Anthropic adapter (first) and an OpenAI compatible adapter (second), and an `EmbeddingProvider` interface with Voyage (`voyage-law-2`, built for legal text) and OpenAI adapters, all at 1024 dimensions so the index is provider independent. Retrieval reads `document_chunks` under the caller's own RLS through a `SECURITY INVOKER` matching function, so the matter walls, the collaboration arm and the client side all apply with no second statement of the rule. Every run is logged with model, prompt version, tokens, cost and latency. Every legal authority the model mentions is stored as `unverified` until a lawyer verifies it against a source. Every action the assistant proposes is executed only when the person confirms it, through the same server actions and RPCs the screens use, as that person.

**D7. Where AI runs.** Chat, briefing, review and drafting run in Next.js route handlers on Vercel as the signed in person, with the provider key as a server environment variable exactly as `PAYSTACK_SECRET_KEY` already is. Embedding documents runs in an Edge Function on a schedule with the service role, exactly as `extract-text` does, writing through a definer door that refuses any caller with an `auth.uid()`. The service role never enters `app/` or `src/`.

**D8. Data handling is a firm's choice, recorded.** Sending a client's document to an AI provider is a disclosure. `firm_ai_settings.allow_document_content` is off until an owner or admin turns it on, and the screen says what turning it on means. Until then the assistant works from what the person types and from metadata, not from document text.

**D9. Client money stays a design.** `CLIENT_MONEY_DESIGN.md` waits on the accounting adviser, and this plan does not route or hold client funds. Platform subscription payments are a separate ledger from client invoices and never touch a firm's subaccount.

**D10. Integrations are real or absent, never pretended.** Every integration screen reports the real state: configured, tested at a time, or not configured with the exact variable to set. No button shows success without a provider answer.

**D11. The identity moves to forest green, ivory, champagne gold and charcoal.** The three colour system in `tailwind.config.ts` stays (tenant, platform, theme); the platform palette's literals change, with the same contrast gates. The console navigation is rearranged to the master prompt's structure, with every existing screen still reachable.

## 4. Module map

| Module | Routes | Backend | Status |
|---|---|---|---|
| Home (Docket Pulse) | `/firm` | `firm_overview`, `firm_sittings_due`, `network_overview()`, `ai_usage` | Built, extended in Phase 5 |
| My Workspace | `/firm/me`, `/firm/tasks` | tasks, calendar feed | Built |
| Matters | `/firm/matters/*` | migrations 1, 29, 32, 38, 39 | Built |
| Clients | `/firm/clients/*` | profiles, parties, representations | Built |
| Docket Network | `/firm/network/*` | migration 63 | Phase 3 |
| Documents | `/firm/documents`, matter tabs | migrations 30, 31, 40, 48 | Firm wide screen in Phase 5 |
| AI Legal Assistant | `/firm/ai/*`, `/api/ai/*` | migration 64, Edge Function `embed-documents` | Phase 4 |
| Legal Research | `/firm/research` | `legal_authorities` in migration 64 | Phase 4 |
| Calendar and Hearings | `/firm/sittings`, `/firm/appointments`, `/firm/availability` | court events, deadlines, appointments | Built |
| Communications | `/firm/messages`, `/firm/inbox` | messages, service inbox, notifications | Built |
| Billing and Finance | `/firm/invoices/*`, `/firm/finance` | migration 65 | Phase 6 |
| Team | `/firm/admin/people` | migration 62 | Phase 2 |
| Reports and Analytics | `/firm/overview`, `/firm/admin/baseline` | overview, baseline, partner attribution | Built |
| Settings | `/firm/admin/*` | firm settings, AI settings, subscription | Built, extended |
| Platform admin | `/admin/*` | jurisdictions, plans, AI usage | Extended |

## 5. Database design: the migrations this plan adds

Migrations 53 to 58 are reserved by `DEPLOYMENT_RUNBOOK.md`; this plan starts at 60.

| # | File | What it adds |
|---|---|---|
| 60 | `enums` | `currency` gains GBP, EUR, CAD, AUD, GHS, KES, ZAR; `firm_role` gains `readonly` and `external`. Enum values only, used by no function in the same file |
| 61 | `jurisdictions` | `jurisdictions` registry with lifecycle, seeded; `jurisdiction_practice_areas`; `firms.jurisdiction_code`; `create_firm()` gains `p_jurisdiction` and refuses one that is not active; `set_jurisdiction_status()` for platform admins with MFA; `jurisdictions_public` view |
| 62 | `permissions` | `firm_members.title`, `firm_custom_roles`, `firm_member_permissions`, `role_default_permissions()`, `has_permission()`, `staff_w()` and `admin_w()` re created to exclude `readonly` and `external` from writes, trigger guards on `matters`, `matter_lawyers`, `invoices`, `matter_collaborations`, `set_member_title()`, `set_member_permissions()`, `upsert_custom_role()` |
| 63 | `network` | `firm_network_profiles`, `network_directory` view, `network_invitations` (hashed code, hashed link token, expiry, attempts, resends), `outbound_emails` outbox with claim and finish doors, `firm_connections`, `connected_firms` view, `invite_firm()`, `verify_network_invitation()`, `respond_network_invitation()`, `set_connection_status()`, `matter_collaborations.role`, `collaboration_tasks`, `joint_matters` view, `network_introductions`, `firm_alliances`, `alliance_members`, `alliance_notes`, `network_overview()` |
| 64 | `ai` | `firm_ai_settings`, `ai_prompts`, `ai_conversations`, `ai_messages`, `ai_runs`, `ai_allowance()`, `document_chunks` (pgvector, 1024 dimensions) with `claim_document_embeddings()` and `record_document_chunks()` service doors, `match_document_chunks()` SECURITY INVOKER, `ai_document_analyses`, `matter_briefs`, `legal_authorities`, `matter_authorities`, `verify_authority()`, `platform_ai_usage` view, the `docket-embed-documents` cron job |
| 65 | `finance` | `expenses`, `credit_notes`, `time_entries`, `firm_finance_summary()` (invoiced, received, outstanding, partially paid, expenses, net), invoice currency from the extended enum |
| 66 | `subscriptions` | `subscription_plans` (platform rows, prices per currency, limits, features), `firm_subscriptions`, `platform_invoices`, `plan_limit()`, `start_trial()`, `change_plan()`, `record_platform_payment()` |
| 67 | `flow` | `workflow_rules` (trigger, conditions, actions, approval), `workflow_runs` (log, failure, approval), enqueuing triggers, `approve_workflow_run()` |

Every table named above follows D2.

## 6. Permissions matrix

Permissions: `view_matters`, `create_matters`, `edit_matters`, `assign_lawyers`, `view_financials`, `create_invoices`, `approve_payments`, `manage_clients`, `manage_team`, `manage_documents`, `invite_firms`, `manage_integrations`, `access_reports`, `manage_settings`, `use_ai`.

| Tier | Defaults |
|---|---|
| owner | all |
| admin | all except `approve_payments` is included; equal to owner inside the firm except owner only acts (invite an owner, keep the last owner) stay owner's |
| lawyer | view, create and edit matters, assign lawyers, view financials, create invoices, manage clients, manage documents, invite firms, access reports, use AI |
| staff | view matters, manage clients, manage documents, create invoices, use AI |
| external | view matters (only those they are on), manage documents on those matters |
| readonly | view matters, view financials, access reports; `staff_w()` is false, so no write anywhere |

A title is a label (Managing Partner, Senior Partner, Partner, Associate, Junior Associate, Counsel, Legal Assistant, Paralegal, Secretary, Finance Officer, Administrator, External Collaborator, Read only User). A custom role is a tier plus a permission list, chosen per firm. A per member grant or denial is the final word. `has_permission()` resolves grant, then custom role, then tier default. Every refusal is the database's.

## 7. Security plan

- Multitenant isolation: unchanged, and every new table is exercised from both sides of each wall in its suite, including a second firm and a client.
- Network: a connection is created only by `respond_network_invitation()` after a verified code and an explicit accept by a member holding `invite_firms`; the code is stored as SHA 256 of code and salt, expires in 72 hours, allows 5 attempts and 3 resends, and is invalidated on use; the link token is hashed too; a verified code grants nothing by itself; a domain mismatch between the invited email and the accepting firm's official email puts the connection in `review` for a platform admin. Connected firms read each other's profile through a view that respects each firm's visibility choice and nothing else. Joint matters keep migration 45's invariants: a snapshot, one named version at a time, internal notes never shared, every door closed on end, and revocation never destroys the owner's records.
- AI: retrieval is SECURITY INVOKER; chunks inherit `can_access_document_version()`; the embedding doors refuse any `auth.uid()`; provider keys live only on the server and in Edge Function secrets; every run is logged; `rate_limit_hit('ai', …)` per person; monthly caps per firm; the assistant can only propose a mutating action, which runs as the person on confirmation.
- Permissions: enforced by triggers on the protected tables, so the RPCs and direct writes meet one rule; `readonly` and `external` are refused by `staff_w()`.
- Subscriptions: platform payments go to the platform's own Paystack account and are recorded in `platform_invoices`, never through `record_payment()` and never to a firm's subaccount.
- Everything else in the README's rules list stands.

## 8. AI integration strategy

**Providers.** `src/lib/ai/providers/anthropic.ts` (Messages API over `fetch`, streaming, tool use), `src/lib/ai/providers/openai-compatible.ts` (any OpenAI style endpoint). `src/lib/ai/embeddings/voyage.ts` and `openai.ts`. Selection by `AI_PROVIDER`, `AI_MODEL`, `AI_FALLBACK_MODEL`, `AI_EMBEDDING_PROVIDER`, `AI_EMBEDDING_MODEL`; keys `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VOYAGE_API_KEY`. The same embedding key is an Edge Function secret for the indexer. No SDK: a dependency change cannot be made from every environment this repository is built in, and `fetch` is enough.

**Retrieval.** `extract-text` already produces `document_versions.text_content`. `embed-documents` claims extracted current versions, splits them into chunks of about 1,200 characters with overlap, embeds them, and records them with character offsets. A question is embedded in the route handler and matched with `match_document_chunks()` as the person, scoped to the firm, optionally to a matter or named documents. The answer carries citations naming the document, version and character range, and the screen opens the document at that text. Page numbers are given only where the extractor can give them, which today it cannot; the citation says "passage" rather than inventing a page.

**Features and their shape.** Assistant (context aware chat with citations and proposed actions); Docket Brief (structured: background, parties, material facts, chronology, issues, applicable law, authorities, arguments, evidence, contradictions, weaknesses, missing information, outstanding documents, next steps, each with citations, each authority recorded as unverified); contract review (summary, clauses, risks, deadlines, with citations); comparison of two versions; drafting from templates and matter facts; deadline extraction into proposed deadlines a lawyer confirms; task generation into proposed tasks; invoice assistance into a draft invoice; the command centre (natural language to a proposed, confirmed action).

**Safeguards.** System prompts forbid fabricated authorities and require the model to mark every authority it names; the app stores each as `unverified`; a lawyer verifies with a source before it is shown as verified. Nothing is sent to a court, a client or a counterparty by the assistant. Documents it drafts are saved as drafts for review. Usage, cost and errors are visible to the firm's admin and, as counts, to the platform.

**Prompt versioning.** Each prompt is a file with a key, a version and a body; its SHA 256 is recorded on every run and mirrored into `ai_prompts`.

## 9. Docket Network architecture

1. A firm completes its network profile and chooses what connected firms may see.
2. Firm A invites Firm B's official email with a reason. `invite_firm()` mints a code and a link token, stores both hashed, writes one email to the outbox (the only place the code exists in clear, read by the dispatcher alone), and, where the email already belongs to a Docket firm member, an in app notification to that firm's owners and admins.
3. Whoever opens the link signs in or registers a firm, then enters the code. `verify_network_invitation()` checks the token, the expiry, the attempts and the code in constant time, and records who verified it. Nothing is granted.
4. An owner or admin of the receiving firm holding `invite_firms` accepts or declines. Accepting creates the connection (`active`, or `review` on a domain mismatch). Both firms now appear in each other's connected list with the date, the authorized contacts each side chose to show, and the collaboration permissions.
5. Either firm may suspend, restrict or end the connection. Ending it ends every live collaboration between the two firms the same second and recalls nothing already downloaded, which the screen says.
6. Joint matters: the lead firm proposes a collaboration with a role; the other firm accepts; shared documents, notes, tasks and client facing updates flow under migration 45's rules; the lead firm's private database is never merged.
7. Introductions and referral requests move between connected firms with a brief that carries no client confidential information, which the form states.
8. Alliances: two or more connected firms record a standing relationship with practice areas, jurisdictions, contacts, referral procedure, notes and a renewal or termination.

## 10. Jurisdiction engine

`jurisdictions` is the single place a country is described. Nigeria's existing reference data (`ng_states`, `courts`, `public_holidays`, `court_vacations`, `court_rules`) is its active configuration. Adding a country is adding a row with status `designed`, then its reference data as platform rows keyed by `jurisdiction_code`, then a recorded validation (who, when, what was reviewed), then activation. The registration form shows active jurisdictions as choices and designed ones as "coming after validation". Deadline calculation, court directories and professional requirements read the firm's jurisdiction and refuse to compute where no validated rules exist, which is what `count_deadline()` already does for a court with no entered rules.

## 11. Roadmap and what this session delivers

| Phase | Scope | Proof |
|---|---|---|
| 1 | This document and the checklist | Committed |
| 2 | Migrations 60 to 62, admin screens for jurisdictions and people, registration picker | SQL suites with floors, typecheck, README counts |
| 3 | Migration 63, dispatcher outbox, network screens, join page | A suite that takes two firms from invitation to a joint matter, document sharing, revocation and intact records |
| 4 | Migration 64, provider adapters, `embed-documents`, assistant, brief, review, drafting, research, command centre, AI settings | Suites for isolation of chunks and runs; adapter tests with a fake provider; typecheck |
| 5 | Identity and navigation, Pulse, Documents screen | Design fixtures |
| 6 | Migrations 65 to 67, finance, subscriptions, flow | Suites, typecheck |
| 7 | Docs: README, RPC reference, runbook, env example, checklist | CI |

Each phase ends with the full suite and the typecheck green and a commit on the working branch. Deployment to the Docket project follows the runbook, by the operator, in the order the release record requires.
