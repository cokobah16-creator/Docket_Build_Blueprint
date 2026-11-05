# Development checklist

*The live status of every feature the master prompt asks for. A feature is COMPLETE only when the frontend, the backend, the database and the required integrations work together and a test proves it. PARTIAL names what is missing. DESIGNED means a written decision defers it on purpose. Updated at the end of every phase.*

Legend: COMPLETE · PARTIAL · PLANNED · DESIGNED · NOT STARTED

| Feature | Frontend | Backend | Database | Integration | Testing | Outstanding dependencies |
|---|---|---|---|---|---|---|
| Firm registration, verification, staff invites | COMPLETE | COMPLETE | COMPLETE | Email (Supabase auth) | SQL 20, 15 | Jurisdiction picker (Phase 2) |
| Roles: six tiers, thirteen titles, granular permissions, custom roles | COMPLETE | COMPLETE | COMPLETE | n/a | SQL 99_permissions (60 checks) | none |
| Workspace switcher | COMPLETE | COMPLETE | COMPLETE | n/a | fixtures | none |
| Matters, stages, packs, walls | COMPLETE | COMPLETE | COMPLETE | n/a | SQL 29, 39, 95 | none |
| Docket Timeline with filters | PARTIAL (no filter UI) | COMPLETE | COMPLETE | n/a | SQL 92 | Filter by kind, date, person (Phase 5) |
| Clients, contacts, conflict checks, delegation | COMPLETE | COMPLETE | COMPLETE | n/a | SQL 98, 99_delegation | none |
| Client portal | COMPLETE | COMPLETE | COMPLETE | Paystack, Daily, push | SQL 10, 99_booking_consent | none |
| Documents: versions, reads, requests, templates, execution | COMPLETE | COMPLETE | COMPLETE | Storage | SQL 96, 97, 99_templates | Firm wide Documents screen (Phase 5) |
| Text extraction and search | COMPLETE | COMPLETE | COMPLETE | Edge Function | SQL 99_search, 99_document_text | OCR is a recorded decision (DOCUMENT_TEXT.md) |
| Invoices, VAT, Paystack settlement | COMPLETE | COMPLETE | COMPLETE | Paystack | SQL 50, 80, 99_invoice_issuer | Expenses, credit notes, time entries, finance summary (Phase 6) |
| Multi currency | PARTIAL (NGN, USD, GBP, EUR, CAD, AUD, GHS, KES, ZAR on the type) | PARTIAL | COMPLETE (enum) | Paystack per currency, as the firm's account allows | SQL 50, 99_jurisdictions | Per currency finance summary (Phase 6) |
| Trust and client money | DESIGNED | DESIGNED | DESIGNED | n/a | n/a | CLIENT_MONEY_DESIGN.md awaits the accounting adviser |
| Court diary, hearings, deadlines | COMPLETE | COMPLETE | COMPLETE | Calendar feed (ICS) | SQL 99_legal_diary, 99_calendar_feed | OAuth calendar connectors are designed in CONNECTORS_DESIGN.md |
| Service of process | COMPLETE | COMPLETE | COMPLETE | n/a | SQL 40 | none |
| Matter scoped collaboration (migration 45) | COMPLETE | COMPLETE | COMPLETE | n/a | SQL 99_collaboration, 99_network | none |
| Docket Network: firm profiles and directory | COMPLETE (/firm/network/profile, /firm/network/discover) | COMPLETE | COMPLETE | n/a | SQL 99_network, design lint | none |
| Docket Network: email invitations with verification codes | COMPLETE (/firm/network, /network/join) | COMPLETE | COMPLETE | PARTIAL: dispatcher v11 sends through Resend; not yet deployed, and Deno is not type checked here | SQL 99_network | Deploy 63 and dispatcher v11 to the Docket project |
| Docket Network: connections, suspend, end, review | COMPLETE (/firm/network, /admin/network) | COMPLETE | COMPLETE | n/a | SQL 99_network | none |
| Joint Matters with roles and shared tasks | COMPLETE (matter page, /firm/collaborations) | COMPLETE | COMPLETE | n/a | SQL 99_network | none |
| Introductions and referral requests | COMPLETE (/firm/network/discover, /firm/network) | COMPLETE | COMPLETE | n/a | SQL 99_network | none |
| Docket Alliance | COMPLETE (/firm/network/alliances) | COMPLETE | COMPLETE | n/a | SQL 99_network | none |
| Network dashboard | COMPLETE (/firm/network) | COMPLETE | COMPLETE | n/a | SQL 99_network, design lint | none |
| DOCKET AI: provider layer, settings, usage | NOT STARTED | NOT STARTED | NOT STARTED | Anthropic, OpenAI compatible, Voyage | n/a | Phase 4; provider keys set by the operator |
| DOCKET AI: embeddings and retrieval | NOT STARTED | NOT STARTED | NOT STARTED | Edge Function embed-documents | n/a | Phase 4; pgvector on the project |
| DOCKET AI: assistant with citations and actions | NOT STARTED | NOT STARTED | NOT STARTED | n/a | n/a | Phase 4 |
| Docket Brief | NOT STARTED | NOT STARTED | NOT STARTED | n/a | n/a | Phase 4 |
| Contract review, comparison, drafting, deadline and task extraction | NOT STARTED | NOT STARTED | NOT STARTED | n/a | n/a | Phase 4 |
| Legal research with verification status | NOT STARTED | NOT STARTED | NOT STARTED | Licensed sources not yet available | n/a | Phase 4 holds authorities and verification; external research APIs need licences |
| Global command centre | NOT STARTED | NOT STARTED | n/a | n/a | n/a | Phase 4 |
| Jurisdiction engine | COMPLETE (registration picker, /admin/jurisdictions) | COMPLETE | COMPLETE | n/a | SQL 99_jurisdictions (42 checks) | Other countries stay designed until a platform admin records a validation and activates them |
| Nigerian configuration | COMPLETE | COMPLETE | COMPLETE | n/a | SQL 30 | Court vacations entered by the operator as published |
| Subscriptions and plans | NOT STARTED | NOT STARTED | PARTIAL (firms.plan) | Paystack (platform account) | n/a | Phase 6 |
| Docket Pulse | PARTIAL (Today) | COMPLETE | COMPLETE | n/a | fixtures | Network and AI items (Phase 5) |
| Docket Flow automation builder | NOT STARTED | PARTIAL (packs) | PARTIAL | n/a | SQL 99_workflow_packs | Phase 6 |
| Communications: messaging, notifications, email, SMS, push | COMPLETE | COMPLETE | COMPLETE | Resend, Termii, Twilio, VAPID | SQL 90, 99_notifications | WhatsApp Business API not configured; video via Daily |
| Reports: overview, baseline, partner attribution | COMPLETE | COMPLETE | COMPLETE | n/a | SQL 94 | Finance summary (Phase 6) |
| Security: RLS, MFA, audit, CSP, rate limits, backups | COMPLETE | COMPLETE | COMPLETE | n/a | every suite | PITR and drift alarm are operator settings |
| Design identity: forest green, ivory, gold, charcoal | NOT STARTED | n/a | n/a | n/a | design fixtures | Phase 5 |
| Navigation per the master prompt | NOT STARTED | n/a | n/a | n/a | fixtures | Phase 5 |
| Light and dark modes | COMPLETE | n/a | n/a | n/a | fixtures | none |
| Onboarding and guided tours | PARTIAL (checklist) | COMPLETE | COMPLETE | n/a | SQL 99_onboarding_import | Guided tour (Phase 5) |
| Partner API | COMPLETE | COMPLETE | COMPLETE | Edge Function | SQL 99_partner_api | none |
| Court registry pilot | COMPLETE | COMPLETE | COMPLETE | n/a | SQL 99_court_registry | A real registry agreeing to the pilot |
| Tests: SQL suites, typecheck, build, route policy, design fixtures | COMPLETE | n/a | n/a | n/a | CI | Browser journeys need a staging project (tests/integration/README.md) |
