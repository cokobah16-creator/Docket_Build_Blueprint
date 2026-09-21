// A stand-in Supabase, so the layouts can be opened in a real browser without a project.
//
//   node tests/fixtures/supabase-mock.mjs --port 54321 --role staff
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<the key it prints> npm run dev
//
// It answers the handful of GoTrue and PostgREST calls the console and the portal make while
// rendering, with fixed rows chosen to exercise the layouts: long cause titles, a suit number,
// several firms, a client owing money, an unpaid hold.
//
// WHAT THIS IS NOT. It does not implement RLS, and it does not check the session against
// anything — it hands out a user because it was asked. It proves that a screen lays out and
// reads correctly at a given width, and nothing whatever about who may see it. Authorization is
// the database's, and only a real project can demonstrate it.

import { createServer } from "node:http";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const PORT = Number(arg("port", "54321"));
const ROLE = arg("role", "staff"); // staff | client
const SCENARIO = arg("scenario", "multiple"); // multiple | single | empty

// A JWT is three base64url parts; supabase-js reads the payload without verifying it, which is
// all `getAuthenticatorAssuranceLevel()` needs to report aal2.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const FIRM_ID = "22222222-2222-4222-8222-222222222222";
const FIRM_ID_2 = "33333333-3333-4333-8333-333333333333";
const MATTER_ID = "44444444-4444-4444-8444-444444444444";
const APPT_ID = "55555555-5555-4555-8555-555555555555";
const INVOICE_ID = "66666666-6666-4666-8666-666666666666";
const far = new Date(Date.now() + 86_400_000).toISOString();
const near = new Date(Date.now() + 45 * 60_000).toISOString();
const past = new Date(Date.now() - 3 * 86_400_000).toISOString();

const ACCESS_TOKEN = [
  b64({ alg: "HS256", typ: "JWT" }),
  b64({
    sub: USER_ID,
    aal: "aal2",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: ROLE === "staff" ? "b.okafor@example.test" : "adaeze.o@example.test",
  }),
  "sig",
].join(".");

const USER = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: ROLE === "staff" ? "b.okafor@example.test" : "adaeze.o@example.test",
  phone: "+2348034110982",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: past,
  aal: "aal2",
  factors: [{ id: "f1", status: "verified", factor_type: "totp" }],
};

const SESSION = {
  access_token: ACCESS_TOKEN,
  refresh_token: "refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: USER,
};

const FIRM = {
  id: FIRM_ID,
  slug: "attorneys-klinique",
  name: "Attorneys Klinique",
  legal_name: "Attorneys Klinique LP",
  brand: {
    colours: { primary: "#0F2A44", accent: "#B08D57", surface: "#F7F5F0" },
    fonts: { heading: "Fraunces", body: "Inter" },
  },
  policies: { terms: { version: "2026-09" }, privacy: { version: "2026-09" } },
  custom_domain: null,
  timezone: "Africa/Lagos",
  default_currency: "NGN",
  verified: true,
  status: "active",
};

const FIRM_2 = { ...FIRM, id: FIRM_ID_2, slug: "bello-co", name: "Bello & Co", legal_name: "Bello & Co" };

// Long on purpose: a cause title and a suit number are where a narrow column breaks.
const MATTER = {
  id: MATTER_ID,
  firm_id: FIRM_ID,
  reference: "AK-M-2026-000014",
  title: "Adeyemi v. Lagos State Lands Bureau & 2 Ors (consolidated with the Ikoyi title suit)",
  type: "litigation",
  status_id: "s1",
  description: "Declaration of title and perpetual injunction.",
  next_action: "Read the search report and confirm whether to proceed to the Bureau",
  next_action_due: far.slice(0, 10),
  court_name: "High Court of Lagos State, Ikeja Judicial Division",
  suit_number: "ID/4471GCM/2026",
  next_event_at: far,
  next_event_note: "Continuation of hearing",
  opened_at: past.slice(0, 10),
  closed_at: null,
  deleted_at: null,
};

const APPOINTMENT = {
  id: APPT_ID,
  firm_id: FIRM_ID,
  reference: "AK-0247",
  status: "confirmed",
  mode: "virtual",
  starts_at: near,
  ends_at: new Date(Date.parse(near) + 45 * 60_000).toISOString(),
  client_timezone: "Africa/Lagos",
  client_id: USER_ID,
  lawyer_id: USER_ID,
  service_id: "svc1",
  invoice_id: INVOICE_ID,
  hold_expires_at: null,
  fee_minor: 5_000_000,
  currency: "NGN",
  cancellation_reason: null,
  client: { full_name: "Adaeze Okonkwo", phone: "+2348034110982", email: "adaeze.o@example.test" },
  service: { name: "Legal Consultation" },
};

const APPOINTMENT_2 = {
  ...APPOINTMENT,
  id: "77777777-7777-4777-8777-777777777777",
  reference: "AK-0253",
  status: "awaiting_payment",
  mode: "in_person",
  starts_at: new Date(Date.now() + 5 * 3_600_000).toISOString(),
  ends_at: new Date(Date.now() + 5.75 * 3_600_000).toISOString(),
  hold_expires_at: new Date(Date.now() + 12 * 60_000).toISOString(),
  client: { full_name: "Bisi Adeyemi", phone: "+2348095531204", email: null },
  service: { name: "Property & Real Estate" },
};

// Each table the screens read, with rows that make the layout work for its living.
const TABLES = {
  profiles: [{ id: USER_ID, full_name: ROLE === "staff" ? "B. Okafor" : "Adaeze Okonkwo", phone: "+2348034110982", email: "adaeze.o@example.test", timezone: "Africa/Lagos", preferred_channel: "sms", quiet_hours_start: "21:30:00", quiet_hours_end: "06:30:00", client_type: "individual", company_name: null }],
  firm_members: [{ firm_id: FIRM_ID, user_id: USER_ID, role: "lawyer" }, { firm_id: FIRM_ID_2, user_id: USER_ID, role: "lawyer" }],
  firms: [FIRM, FIRM_2],
  firm_public: [FIRM, FIRM_2],
  firm_overview: [{ firm_id: FIRM_ID, name: FIRM.name, status: "active", open_matters: 18, upcoming_appointments: 6, court_dates_30d: 7, sittings_due: 2, outstanding_by_currency: { NGN: 57_500_000 }, collected_this_month_by_currency: { NGN: 21_000_000 }, unread_messages: 4, overdue_tasks: 2, client_uploads: 3, service_to_acknowledge: 1 },
    // The second firm the staff member belongs to. Without this row the console
    // falls back to calling it "Your firm", and every multi-firm check reads as
    // a failure of the console rather than a gap in the stand-in.
    { firm_id: FIRM_ID_2, name: FIRM_2.name, status: "active", open_matters: 3, upcoming_appointments: 1, court_dates_30d: 1, sittings_due: 0, outstanding_by_currency: {}, collected_this_month_by_currency: {}, unread_messages: 0, overdue_tasks: 0, client_uploads: 0, service_to_acknowledge: 0 }],
  firm_sittings_due: [
    { court_event_id: "ce1", firm_id: FIRM_ID, matter_id: MATTER_ID, reference: MATTER.reference, cause_title: MATTER.title, suit_number: MATTER.suit_number, court: MATTER.court_name, purpose: "Continuation of hearing", purpose_kind: "hearing", scheduled_at: past, lawyer_id: USER_ID },
    { court_event_id: "ce2", firm_id: FIRM_ID, matter_id: MATTER_ID, reference: "AK-M-2026-000021", cause_title: "Nwosu & 2 Ors v. Zenith Freight Ltd", suit_number: "FHC/L/CS/882/2026", court: "Federal High Court, Lagos Judicial Division", purpose: "Mention", purpose_kind: "mention", scheduled_at: new Date(Date.now() - 9 * 86_400_000).toISOString(), lawyer_id: USER_ID },
  ],
  appointments: [APPOINTMENT, APPOINTMENT_2],
  matters: [MATTER, { ...MATTER, id: "88888888-8888-4888-8888-888888888888", reference: "AK-M-2026-000021", title: "Sale of 3 Bedroom, Ikoyi — title search", court_name: null, suit_number: null, next_event_at: null, next_action: "Confirm you want to proceed", status_id: "s2" }],
  matter_statuses: [{ id: "s1", firm_id: FIRM_ID, key: "in_court", label: "In court", colour: "#B08D57", is_terminal: false }, { id: "s2", firm_id: FIRM_ID, key: "open", label: "Open", colour: null, is_terminal: false }],
  matter_lawyers: [{ matter_id: MATTER_ID, user_id: USER_ID, is_lead: true }],
  matter_parties: [{ matter_id: MATTER_ID, user_id: USER_ID, firm_id: FIRM_ID, role: "client", client: { id: USER_ID, full_name: "Adaeze Okonkwo", phone: "+2348034110982", email: "adaeze.o@example.test", client_type: "individual", company_name: null } }],
  lawyer_public: [{ id: USER_ID, full_name: "B. Okafor", title: "Associate" }],
  lawyer_profiles: [{ user_id: USER_ID, firm_id: FIRM_ID, scn: "SCN/2018/044182", title: "Associate" }],
  services: [{ id: "svc1", firm_id: FIRM_ID, slug: "legal-consultation", name: "Legal Consultation", description: "A 45-minute consultation.", price_minor: 5_000_000, currency: "NGN", duration_min: 45, virtual_available: true, is_active: true }],
  updates: [{ id: "u1", matter_id: MATTER_ID, firm_id: FIRM_ID, kind: "court", title: "Adjourned for continuation", body: "The court adjourned for continuation of hearing.", payload: {}, occurred_at: past, created_at: past, meaning: "The case did not finish today.", next_step: "Come back on the next date.", client_action: null, action_required: false, next_update_by: null }],
  documents: [{ id: "d1", firm_id: FIRM_ID, matter_id: MATTER_ID, appointment_id: null, name: "Deed of Assignment — Ikoyi.pdf", category: "evidence", client_visible: true, current_version_id: "v1", uploaded_by: USER_ID, reviewed_at: null, reviewed_by: null, created_at: past, deleted_at: null, locked_version_id: null, locked_at: null, signature_requested_at: null, signature_requested_by: null }],
  document_versions: [{ id: "v1", document_id: "d1", storage_path: "p/1", mime: "application/pdf", size_bytes: 184_320, uploaded_by: USER_ID, created_at: past, checksum: "abc", kind: "original", executed_on: null }],
  document_signatures: [],
  document_requests: [],
  invoices: [{ id: INVOICE_ID, firm_id: FIRM_ID, client_id: USER_ID, matter_id: MATTER_ID, appointment_id: APPT_ID, number: "AK-INV-2026-0188", status: "issued", currency: "NGN", subtotal_minor: 5_000_000, vat_minor: 0, total_minor: 5_000_000, paid_minor: 0, issued_at: past, due_at: far }],
  invoice_items: [{ id: "ii1", invoice_id: INVOICE_ID, description: "Legal Consultation", quantity: 1, unit_minor: 5_000_000 }],
  payments: [],
  messages: [
    { id: "m1", firm_id: FIRM_ID, matter_id: MATTER_ID, appointment_id: null, sender_id: USER_ID, body: "The certified true copies are ready to collect from the registry.", attachments: [], read_at: null, created_at: past },
    { id: "m2", firm_id: FIRM_ID, matter_id: MATTER_ID, appointment_id: null, sender_id: null, body: "Thank you — I will come on Thursday.", attachments: [], read_at: past, created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  ],
  firm_threads: [
    { firm_id: FIRM_ID, matter_id: MATTER_ID, appointment_id: null, last_message_id: "m1", last_message_at: past, last_from_firm: false, unread_for_me: 2 },
    { firm_id: FIRM_ID, matter_id: null, appointment_id: APPT_ID, last_message_id: "m2", last_message_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), last_from_firm: true, unread_for_me: 0 },
  ],
  notifications: [
    { id: "n1", firm_id: FIRM_ID, channel: "in_app", event: "court_update", payload: { matter_title: MATTER.title }, status: "sent", read_at: null, created_at: past },
    { id: "n2", firm_id: FIRM_ID, channel: "in_app", event: "appointment_confirmed", payload: { reference: "AK-0247" }, status: "sent", read_at: null, created_at: past },
  ],
  notification_preferences: [],
  consent_records: [
    { id: "c1", user_id: USER_ID, firm_id: FIRM_ID, kind: "terms", version: "2026-09", accepted_at: past },
    { id: "c2", user_id: USER_ID, firm_id: FIRM_ID, kind: "privacy", version: "2026-09", accepted_at: past },
  ],
  court_events: [{ id: "ce1", firm_id: FIRM_ID, matter_id: MATTER_ID, scheduled_at: far, purpose: "Continuation of hearing", purpose_kind: "hearing", court_name: MATTER.court_name, outcome: null }],
  tasks: [{ id: "t1", firm_id: FIRM_ID, matter_id: MATTER_ID, title: "File the written address", due_at: past, done_at: null, assignee_id: USER_ID }],
  service_events: [],
  consultation_notes: [],
  consultation_internal_notes: [],
  consultation_sessions: [],
  intake_responses: [],
  push_subscriptions: [],
  authority_grants: [],
  collaborations: [],
};

// Optional presentation cases; this server still provides no authorization proof.
TABLES.updates.forEach(row => { row.visibility = "client"; });
TABLES.tasks.forEach(row => { row.status = "open"; });
TABLES.firm_cause_list = [{ court_event_id: "ce1", firm_id: FIRM_ID, matter_id: MATTER_ID, cause_title: MATTER.title, court: MATTER.court_name, scheduled_at: far, purpose: "Hearing" }];
TABLES.firm_deadlines = [{ id: "deadline1", firm_id: FIRM_ID, matter_id: MATTER_ID, title: "File written address", cause_title: MATTER.title, due_on: past.slice(0, 10), status: "confirmed" }];
if (SCENARIO === "single") TABLES.matters = [MATTER];
if (SCENARIO === "empty") {
  for (const table of ["matters", "updates", "tasks", "firm_cause_list", "firm_deadlines", "firm_threads"]) TABLES[table] = [];
}

const RPC = {
  available_slots: [],
  invoice_settlement: { paystack_subaccount: "ACCT_x" },
  firm_overview: TABLES.firm_overview[0],
  // A row, not a list. Returning [] here made `readiness.items` undefined and
  // the appointment screen threw before it drew anything.
  appointment_readiness: { ready: true, items: [{ kind: "intake", state: "done", label: "Intake answered", form_id: null }] },
  matter_readiness: { ready: true, items: [] },
};

/** PostgREST filters, enough of them: eq, in, is, gte, lt, neq. */
function applyFilters(rows, url) {
  let out = rows;
  for (const [key, raw] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const [op, ...rest] = raw.split(".");
    const value = rest.join(".");
    out = out.filter((row) => {
      const cell = row[key];
      switch (op) {
        case "eq": return String(cell) === value;
        case "neq": return String(cell) !== value;
        case "is": return value === "null" ? cell === null || cell === undefined : Boolean(cell) === (value === "true");
        case "in": return value.replace(/[()]/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")).includes(String(cell));
        case "gte": return String(cell) >= value;
        case "gt": return String(cell) > value;
        case "lte": return String(cell) <= value;
        case "lt": return String(cell) < value;
        default: return true;
      }
    });
  }
  const order = url.searchParams.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out = [...out].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (dir === "desc" ? -1 : 1));
  }
  const limit = url.searchParams.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
      "content-range": Array.isArray(body) ? `0-${Math.max(0, body.length - 1)}/${body.length}` : "*/*",
    });
    res.end(payload);
  };

  if (req.method === "OPTIONS") return send(200, {});

  // ── GoTrue ──────────────────────────────────────────────────────────────
  if (url.pathname === "/auth/v1/user") return send(200, USER);
  if (url.pathname === "/auth/v1/token") return send(200, SESSION);
  if (url.pathname.startsWith("/auth/v1/factors")) return send(200, { id: "f1" });
  if (url.pathname === "/auth/v1/logout") return send(204, {});
  if (url.pathname.startsWith("/auth/v1/")) return send(200, {});

  // ── PostgREST ───────────────────────────────────────────────────────────
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.slice("/rest/v1/rpc/".length);
    return send(200, RPC[fn] ?? []);
  }
  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length);
    if (req.method !== "GET") return send(201, []);
    const rows = TABLES[table];
    if (!rows) {
      // An unknown table is a gap in this fixture, not a server error — say so
      // on the console and answer empty so the screen still renders.
      console.warn(`[supabase-mock] no fixture for table "${table}" — returning []`);
      return send(200, []);
    }
    return send(200, applyFilters(rows, url));
  }

  send(404, { message: "not mocked" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[supabase-mock] role=${ROLE} listening on http://127.0.0.1:${PORT}`);
  console.log(`[supabase-mock] NEXT_PUBLIC_SUPABASE_ANON_KEY=${ACCESS_TOKEN}`);
  console.log(`[supabase-mock] session cookie value: ${JSON.stringify([ACCESS_TOKEN, "refresh", null, null, null])}`);
});
