// Database row types used by the app.
//
// PLACEHOLDER until the Supabase project is linked — then regenerate the
// full typed client with:
//
//   supabase gen types typescript --linked > src/lib/db/types.ts
//
// and keep these hand-maintained interfaces only if the generated output
// replaces them. Shapes below match supabase/migrations/20260909000001_schema.sql.

export type FirmRole = "owner" | "admin" | "lawyer" | "staff";

export type ConsentKind =
  | "terms"
  | "privacy"
  | "engagement"
  | "recording"
  | "marketing";

export interface BrandColours {
  primary?: string;
  accent?: string;
  surface?: string;
}

export interface FirmBrand {
  tagline?: string;
  cta?: string;
  colours?: BrandColours;
  fonts?: { heading?: string; body?: string };
  contact?: { email?: string | null; phone?: string | null; address?: string | null };
  logo_path?: string | null;
}

export interface PolicyVersioned {
  version?: string;
  [key: string]: unknown;
}

/** Row of the anon-readable firm_public view. */
export interface FirmPublic {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  brand: FirmBrand;
  policies: FirmPolicies;
  custom_domain: string | null;
  timezone: string;
  default_currency: "NGN" | "USD";
  verified: boolean;
}

/** firms.policies shape (staff-readable; versions drive consent capture). */
export interface FirmPolicies {
  terms?: PolicyVersioned;
  privacy?: PolicyVersioned;
  cancellation?: PolicyVersioned;
  disclaimer?: PolicyVersioned;
}

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  preferred_channel: string;
}

export interface FirmMember {
  firm_id: string;
  user_id: string;
  role: FirmRole;
}

export type FirmPlan = "free" | "standard" | "enterprise";
export type FirmStatus = "pending" | "active" | "suspended";

/** Row of the firm_admin view: the lifecycle-only projection platform admins may read. */
export interface FirmAdminRow {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  rc_number: string | null;
  plan: FirmPlan;
  status: FirmStatus;
  state_code: string | null;
  custom_domain: string | null;
  verified_at: string | null;
  has_settlement_account: boolean;
  member_count: number;
  /** "Name — SCN; Name — no SCN" for every owner, for verification. */
  owners: string | null;
  policies_published: boolean;
  created_at: string;
}

/** Return shape of the create_firm() RPC. */
export interface CreateFirmResult {
  firm_id: string;
  slug: string;
  owner_id: string;
  reference_prefix: string;
  status: FirmStatus;
}

export type CourtLevel =
  | "supreme"
  | "court_of_appeal"
  | "federal_high"
  | "fct_high"
  | "state_high"
  | "national_industrial"
  | "sharia_appeal"
  | "customary_appeal"
  | "magistrate"
  | "district"
  | "customary"
  | "area"
  | "sharia"
  | "tribunal"
  | "multi_door";

/** Row of public.courts (platform-wide when firm_id is null). */
export interface CourtRow {
  id: string;
  firm_id: string | null;
  level: CourtLevel;
  name: string;
  short_name: string | null;
  state_code: string | null;
  division: string | null;
  city: string | null;
  suit_number_hint: string | null;
  is_active: boolean;
}

export type CounselSide = "opposing" | "co_counsel" | "other";
export type ServiceMethod =
  | "platform"
  | "counsel_address"
  | "email"
  | "whatsapp"
  | "personal"
  | "bailiff"
  | "courier"
  | "registered_post"
  | "publication"
  | "pasting"
  | "substituted"; // legacy value; new rows record the mode and set substituted_by_order

/** Row of the service_inbox view: processes served on (or by) the current user's firm through Docket. */
export interface ServiceInboxRow {
  id: string;
  process_title: string;
  case_title: string | null;
  suit_number: string | null;
  court_name: string | null;
  method: ServiceMethod;
  served_at: string;
  is_originating: boolean;
  substituted_by_order: boolean;
  served_on_name: string | null;
  deemed_served_on: string | null;
  served_by_name: string | null;
  served_by_scn: string | null;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  document_id: string;
  document_version_id: string | null;
  checksum: string | null;
  document_name: string;
  document_mime: string | null;
  document_size_bytes: number | null;
  recipient_matter_id: string | null;
  response_due_on: string | null;
  serving_firm_id: string;
  served_firm_id: string;
  served_for_party: string | null;
}

export interface ConsentRecord {
  id: string;
  user_id: string;
  firm_id: string | null;
  kind: ConsentKind;
  version: string;
  accepted_at: string;
}

export interface ServiceRow {
  id: string;
  firm_id: string;
  slug: string;
  name: string;
  description: string | null;
  price_minor: number;
  currency: "NGN" | "USD";
  duration_min: number;
  virtual_available: boolean;
  is_active: boolean;
  sort: number;
}

/** Row of the anon-readable lawyer_public view (public lawyer profiles). */
export interface LawyerPublic {
  firm_id: string;
  id: string; // profiles.id / auth user id
  slug: string | null;
  title: string | null;
  bio: string | null;
  photo_path: string | null;
  practice_areas: string[];
  category: string | null;
  year_of_call: number | null;
  full_name: string | null;
  timezone: string;
}

export interface IntakeQuestion {
  key: string;
  type: "text" | "longtext" | "choice" | "file";
  label: string;
  options?: string[];
  required?: boolean;
  multiple?: boolean;
  max_files?: number;
  max_length?: number;
  help?: string;
  show_if?: { question: string; equals: string };
}

export interface IntakeForm {
  id: string;
  firm_id: string;
  service_id: string | null;
  name: string | null;
  schema: { questions: IntakeQuestion[] };
}

export interface ContentRow {
  id: string;
  firm_id: string;
  kind: string;
  slug: string | null;
  title: string | null;
  body: string | null;
  status: string;
  published_at: string | null;
}

export interface AppointmentSlot {
  starts_at: string;
  ends_at: string;
}

export interface BookingResult {
  appointment_id: string;
  reference: string;
  status: "awaiting_payment" | "confirmed";
  invoice_id: string | null;
  invoice_number: string | null;
  amount_minor: number;
  currency: "NGN" | "USD";
  hold_expires_at: string | null;
}

export interface ConsultationSession {
  id: string;
  firm_id: string;
  appointment_id: string;
  provider: string;
  room_name: string | null;
  room_expires_at: string | null;
  client_admitted_at: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface ConsultationNotes {
  id: string;
  appointment_id: string;
  client_summary: string | null;
  advice_given: string | null;
  follow_up: string | null;
  updated_at: string;
}

/** Response of the video-session Edge Function (action: join). */
export interface JoinInfo {
  room_url: string;
  token: string | null; // owner only — clients knock and are admitted
  user_name: string;
  role: "owner" | "participant";
  room_name: string;
  expires_at: string;
  starts_at: string;
  ends_at: string;
  reference: string;
}

// ---- client portal (slice 3)
export interface MatterStatus {
  id: string;
  firm_id: string;
  key: string;
  label: string;
  colour: string | null;
  is_terminal: boolean;
  /** Migration 39: where the stage came from and which matter types it is offered for (null: every type). */
  sort?: number;
  pack_key?: string | null;
  pack_version?: number | null;
  matter_types?: MatterType[] | null;
  default_next_action?: string | null;
}

/** A stage is offered for a matter type when it names no types, or names this one. */
export function statusFitsType(s: Pick<MatterStatus, "matter_types">, type: string | null | undefined): boolean {
  return !s.matter_types || s.matter_types.length === 0 || (!!type && (s.matter_types as string[]).includes(type));
}

// ---------------------------------------------------------------- workflow packs (migration 39)
export interface WorkflowPackStatusDef { key: string; label: string; colour?: string; sort?: number; is_terminal?: boolean; next_action?: string }
export interface WorkflowPackTaskDef { key: string; title: string; on_status_key: string; due_offset_days?: number; assignee?: "lead" | "none" }
export interface WorkflowPackDefinition { statuses: WorkflowPackStatusDef[]; task_templates?: WorkflowPackTaskDef[] }
export interface WorkflowPackRow {
  key: string;
  version: number;
  name: string;
  matter_types: MatterType[] | null;
  definition: WorkflowPackDefinition;
  note: string | null;
  published_by: string | null;
  published_at: string;
}
export interface FirmWorkflowPackRow {
  firm_id: string;
  pack_key: string;
  installed_version: number;
  installed_at: string;
  installed_by: string | null;
}

export interface MatterRow {
  id: string;
  firm_id: string;
  reference: string;
  title: string;
  type: string;
  /** 'firm' (every member, the default) or 'team' (matter_lawyers only — migration 29). */
  access: "firm" | "team";
  status_id: string | null;
  description: string | null;
  next_action: string | null;
  /** Who the next action is on — a firm member. Null: nobody yet. */
  next_action_owner_id: string | null;
  /** The calendar day it is due by, YYYY-MM-DD. A day, never an instant. */
  next_action_due: string | null;
  court_name: string | null;
  suit_number: string | null;
  next_event_at: string | null;
  next_event_note: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface UpdateRow {
  id: string;
  matter_id: string;
  firm_id: string;
  kind: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
  /** The client update's shape (migration 27). Each null means "not stated". */
  meaning: string | null;
  next_step: string | null;
  client_action: string | null;
  /** null: not stated · false: "nothing is needed from you", stated · true: client_action says what. */
  action_required: boolean | null;
  /** When to expect the next update — a calendar day, YYYY-MM-DD. */
  next_update_by: string | null;
}

export interface CourtEventRow {
  id: string;
  matter_id: string;
  firm_id: string;
  scheduled_at: string;
  court_name: string | null;
  purpose: string | null;
  outcome_update_id: string | null;
  /** Migration 13/38: where the date came from, and whether that is evidenced. */
  vacated_at?: string | null;
  source?: "firm" | "hearing_notice" | "cause_list";
  source_document_id?: string | null;
  source_ref?: string | null;
}

/** A court-originated date is evidenced by a document or a reference; a chip alone is a claim. */
export function courtDateProvenance(e: { source?: string | null; source_document_id?: string | null; source_ref?: string | null }): "court" | "firm" | "claimed" {
  if (!e.source || e.source === "firm") return "firm";
  return e.source_document_id || e.source_ref ? "court" : "claimed";
}

// ---------------------------------------------------------------- the legal diary (migration 38)
export const DEADLINE_TRIGGERS = ["judgment_delivered", "ruling_delivered", "order_made", "service_effected", "hearing_held", "filing", "other"] as const;
export type DeadlineTrigger = (typeof DEADLINE_TRIGGERS)[number];
export const DEADLINE_TRIGGER_LABELS: Record<DeadlineTrigger, string> = {
  judgment_delivered: "Judgment delivered", ruling_delivered: "Ruling delivered", order_made: "Order made",
  service_effected: "Service effected", hearing_held: "Hearing held", filing: "A filing", other: "Another event",
};

export interface CourtRuleRow {
  id: string;
  level: CourtLevel | null;
  state_code: string | null;
  name: string;
  citation: string | null;
  version: string;
  effective_from: string;
  retired_on: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RuleProvisionRow {
  id: string;
  rule_id: string;
  key: string;
  label: string;
  citation: string | null;
  trigger_kind: DeadlineTrigger;
  period: number;
  unit: "days" | "months";
  count_mode: "calendar" | "clear" | "working";
  excludes_vacation: boolean;
  rolls_forward: boolean;
  note: string | null;
}

/** What count_deadline() returns: the day due and everything the count did and relied on. */
export interface DeadlineCalculation {
  from?: string;
  period?: number;
  unit?: string;
  count_mode: "calendar" | "clear" | "working" | "manual";
  excludes_vacation?: boolean;
  rolls_forward?: boolean;
  level?: string | null;
  state_code?: string | null;
  due_on: string;
  counted_days?: number;
  skipped?: Array<{ day: string; reason: string }>;
  rolled?: Array<{ day: string; reason: string }>;
  coverage?: { vacation_rows_in_range: number; holiday_rows_in_range: number; any_vacation_calendar: boolean; holidays_entered_for_year: boolean };
}

export interface DeadlineRow {
  id: string;
  firm_id: string;
  matter_id: string;
  title: string;
  trigger_kind: DeadlineTrigger;
  trigger_on: string;
  trigger_ref: Record<string, unknown>;
  court_id: string | null;
  jurisdiction: { court_id?: string | null; court_name?: string | null; level?: string | null; state_code?: string | null; division?: string | null };
  rule_id: string | null;
  provision_id: string | null;
  rule_name: string | null;
  rule_citation: string | null;
  rule_version: string | null;
  provision_label: string | null;
  provision_citation: string | null;
  calculation: DeadlineCalculation;
  due_on: string;
  status: "proposed" | "confirmed" | "discharged" | "superseded";
  computed_by: string | null;
  computed_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  discharged_by: string | null;
  discharged_at: string | null;
  discharge_note: string | null;
  superseded_by: string | null;
  note: string | null;
  reminders_sent: string[];
}

/** firm_deadlines: a deadline with its matter beside it. */
export interface FirmDeadlineRow extends DeadlineRow {
  reference: string;
  cause_title: string;
  court: string | null;
}

export interface DocumentRow {
  id: string;
  firm_id: string;
  matter_id: string | null;
  appointment_id: string | null;
  name: string;
  category: string | null;
  client_visible: boolean;
  current_version_id: string | null;
  uploaded_by: string | null;
  /** When staff marked a client upload as looked at; null keeps it on the review counter. */
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  /** Migration 40: executed documents are locked on a version; a signature may have been asked for. */
  locked_version_id?: string | null;
  locked_at?: string | null;
  signature_requested_at?: string | null;
  signature_requested_by?: string | null;
}

// ---------------------------------------------------------------- templates and execution (migration 40)
export type TemplateExecution = "electronic" | "paper" | "either";
export interface DocumentTemplateRow {
  id: string;
  firm_id: string;
  name: string;
  matter_types: MatterType[] | null;
  body: string;
  execution: TemplateExecution;
  version: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
}
export interface DocumentSignatureRow {
  id: string;
  document_id: string;
  version_id: string;
  firm_id: string;
  matter_id: string | null;
  signer_id: string;
  signer_role: "client" | "staff";
  signer_name: string;
  signer_scn: string | null;
  checksum: string;
  read_at: string;
  signed_at: string;
  consent_version: string | null;
}
// ---------------------------------------------------------------- the pilot baseline (migration 41)

/** What firm_metrics() returns. Every figure is computed by the database from the firm's rows. */
export interface FirmMetrics {
  firm_id: string;
  window_from: string;
  window_to: string;
  computed_at: string;
  bookings: { made: number; paid: number; median_hours_to_pay: number };
  /** `unrecorded` is its own bucket on purpose: a consultation never written up is neither. */
  attendance: { past: number; attended: number; missed: number; unrecorded: number; upcoming_now: number };
  consultation_to_matter: { consultations: number; followed_by_a_matter: number; median_days: number; within_days: number };
  sittings: { sat: number; with_an_update: number; updated_within_24h: number; median_hours_to_update: number };
  replies: { messages_from_clients: number; answered: number; median_hours_to_first_reply: number; still_unanswered: number; oldest_unanswered_hours: number };
  document_requests: { asked: number; answered: number; median_hours_to_answer: number };
  money: { invoiced: Record<string, number>; collected: Record<string, number>; median_days_to_collect: number };
  work: { open_matters: number; matters_opened_in_window: number; next_actions_overdue_now: number; client_updates_posted: number };
  clients: { active_in_window: number };
  /** What the numbers do not say, in the database's own words. Shown, never summarised away. */
  caveats: string[];
}

/** A dated, append-only record of one window (migration 41). */
export interface FirmBaselineRow {
  id: string;
  firm_id: string;
  taken_at: string;
  window_from: string;
  window_to: string;
  metrics: FirmMetrics;
  /** What the firm stated about the work before Docket, kept apart from the metrics. */
  stated: Record<string, string>;
  note: string | null;
  taken_by: string | null;
}

/** The figures a firm is asked for about life before Docket. Prompts, not fields Docket fills. */
export const BASELINE_CLAIMS: Array<{ key: string; label: string; hint: string }> = [
  { key: "chasing_court_dates", label: "Time spent chasing and passing on court dates", hint: "Hours a week, and who does it." },
  { key: "answering_clients", label: "How long a client usually waited for an answer", hint: "Before Docket, on the phone or in person." },
  { key: "collecting_fees", label: "How long a fee usually took to collect", hint: "From the day the bill went out." },
  { key: "finding_a_file", label: "Finding a document when it was needed", hint: "Where papers lived, and how long a search took." },
];

/** The placeholders a template may name, mirrored from document_template_placeholders(). */
export const TEMPLATE_PLACEHOLDERS = [
  "firm.name", "firm.legal_name", "firm.rc_number", "firm.address", "firm.email", "firm.phone",
  "matter.reference", "matter.title", "matter.cause_title", "matter.type", "matter.suit_number", "matter.court",
  "matter.judicial_division", "matter.judge", "matter.opened_on", "matter.opposing_party",
  "client.name", "client.company", "client.address", "client.email", "client.phone",
  "lawyer.name", "lawyer.scn", "lawyer.title", "today",
] as const;

/** A document staff asked the client for (migration 31). */
export interface DocumentRequestRow {
  id: string;
  firm_id: string;
  /** Null for a request on a consultation (migration 35). */
  matter_id: string | null;
  /** Set for a request on a consultation; null for one on a matter. */
  appointment_id: string | null;
  title: string;
  why: string | null;
  /** YYYY-MM-DD or null — a calendar day. */
  due_on: string | null;
  requested_by: string | null;
  requested_at: string;
  fulfilled_document_id: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
}

/** Someone on the other side of a matter, as the firm knows them (migration 32). Firm work product. */
export interface AdversePartyRow {
  id: string;
  firm_id: string;
  matter_id: string;
  name: string;
  aliases: string[];
  kind: "person" | "organisation";
  relation: "adverse" | "co_party" | "witness" | "related";
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** One hit from run_conflict_check(). A restricted matter the caller cannot see carries no identity. */
export interface ConflictMatch {
  kind: "client" | "adverse" | "opposing_party" | "cause_title";
  name: string;
  searched: string;
  strength: "exact" | "contains" | "similar";
  restricted: boolean;
  matter_id: string | null;
  matter_reference: string | null;
  matter_title: string | null;
  lead_lawyer_id: string | null;
}

/** A conflict search as recorded, and the lawyer's decision on it (migration 32). */
export interface ConflictCheckRow {
  id: string;
  firm_id: string;
  matter_id: string | null;
  query: { names?: string[]; keys?: string[] };
  matches: ConflictMatch[];
  outcome: "clear" | "conflict" | "waived" | null;
  decision_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
}

/** What firm_readiness() returns (migration 34): the booking engine's gates, in its order, and the setup facts. */
export interface FirmReadiness {
  status: "pending" | "active" | "suspended";
  verified_at: string | null;
  slug: string;
  policies_published: boolean;
  reference_prefix: string;
  reference_issued: boolean;
  settlement_account: boolean;
  needs_settlement: boolean;
  active_services: number;
  all_services: number;
  /** Active services the settlement state lets a client book: the account is set, or the service is not priced-and-prepaid. */
  payable_services: number;
  availability_rules: number;
  public_lawyers: number;
  /** Public profiles whose owner has hours of their own — the only lawyers the booking page can offer a time for. */
  public_lawyers_with_hours: number;
  members: number;
  owners: number;
  lawyers: number;
  intake_forms: number;
  all_intake_forms: number;
  brand_colours: boolean;
  brand_logo: boolean;
  address_for_service: boolean;
  accepts_platform_service: boolean;
  matters: number;
  clients: number;
  pending_invites: number;
  /** Import batches processed to the end. */
  imports_processed: number;
  custom_domain: string | null;
  domain_request: string | null;
  skipped: Record<string, { at: string; by: string | null; note: string | null }>;
  gates: { site_open: boolean; bookable: boolean; payment_ready: boolean };
}

export type OnboardingStep =
  | "policies" | "operations" | "settlement" | "people" | "profile" | "availability"
  | "services" | "intake" | "brand" | "service_of_process" | "import" | "domain";

export interface ImportBatchRow {
  id: string;
  firm_id: string;
  kind: "matters";
  source_name: string | null;
  row_count: number;
  created_by: string | null;
  created_at: string;
  processed_at: string | null;
}

/** One staged CSV row and what became of it. `raw` is what the firm typed about a client: personal data. */
export interface ImportRowRecord {
  id: string;
  batch_id: string;
  firm_id: string;
  row_no: number;
  raw: Record<string, string>;
  skip: boolean;
  outcome: "created" | "skipped" | "failed" | null;
  matter_id: string | null;
  invite_id: string | null;
  note: string | null;
  processed_at: string | null;
}

/** One item appointment_readiness() computed (migration 35). A client never sees a conflict item's substance. */
export interface ReadinessItem {
  kind: "payment" | "intake" | "documents" | "consent" | "conflict";
  label: string;
  satisfied: boolean;
  detail: string;
  /** intake: the required questions still unanswered */
  missing?: Array<{ key: string; label: string }>;
  /** documents: the open requests */
  open?: Array<{ id: string; title: string; due_on: string | null }>;
  ref?: string | null;
}
export interface AppointmentReadiness {
  appointment_id: string;
  status: string;
  held: boolean;
  checkin_required: boolean;
  ready: boolean;
  items: ReadinessItem[];
}

export interface DocumentVersionRow {
  id: string;
  document_id: string;
  storage_path: string;
  mime: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
  /** Migration 40 */
  checksum?: string | null;
  kind?: "upload" | "generated" | "executed_paper";
  source_template_id?: string | null;
  template_version?: number | null;
  executed_on?: string | null;
  witness_name?: string | null;
  attested_by?: string | null;
  stamp_ref?: string | null;
  registration_ref?: string | null;
}

export interface MessageAttachment {
  document_id: string;
  name: string;
  mime?: string | null;
}

export interface MessageRow {
  id: string;
  firm_id: string;
  matter_id: string | null;
  appointment_id: string | null;
  sender_id: string | null;
  body: string | null;
  attachments: MessageAttachment[];
  /** First read from across the firm/client line — "seen by the other side". Never who. */
  read_at: string | null;
  /** False for messages that predate per-reader receipts (migration 25); they count by read_at. */
  reads_tracked: boolean;
  created_at: string;
}

/** Row of firm_threads (migration 25): one per thread the caller can read. */
export interface FirmThread {
  firm_id: string;
  matter_id: string | null;
  appointment_id: string | null;
  last_message_id: string;
  last_message_at: string;
  /** The firm spoke last. Its inverse is "the firm owes the reply". */
  last_from_firm: boolean;
  /** Messages from across the line that the CALLER has not read. Per viewer. */
  unread_for_me: number;
}

export interface NotificationRow {
  id: string;
  firm_id: string | null;
  channel: string;
  event: string;
  payload: Record<string, unknown>;
  status: string;
  read_at: string | null;
  created_at: string;
}

export interface NotificationPreference {
  event: string;
  channel: string;
  enabled: boolean;
}

// ---- staff console (slice 4)
export type FirmRoleName = "owner" | "admin" | "lawyer" | "staff";

export interface FirmMembership {
  firm_id: string;
  user_id: string;
  role: FirmRoleName;
}

/** Row of firm_overview (migration 18): one per firm the caller belongs to. */
export interface FirmOverview {
  firm_id: string;
  name: string;
  status: string;
  open_matters: number;
  upcoming_appointments: number;
  court_dates_30d: number;
  sittings_due: number;
  /** Minor units per currency, e.g. { NGN: 22575000, USD: 50000 }. Never one sum. */
  outstanding_by_currency: Record<string, number>;
  collected_this_month_by_currency: Record<string, number>;
  /** Per viewer since migration 25: what THIS member has not read. Colleagues see different numbers. */
  unread_messages: number;
  overdue_tasks: number;
  client_uploads: number;
  service_to_acknowledge: number;
  /** Shared: threads whose latest message came from outside the firm — what the firm owes, whoever has read it. */
  threads_awaiting_reply: number;
  /** Live matters whose next action's due day has passed, judged in the firm's timezone. */
  next_actions_overdue: number;
}

/** Row of firm_sittings_due: a past court date with no update posted. */
export interface SittingDue {
  court_event_id: string;
  firm_id: string;
  matter_id: string;
  reference: string;
  cause_title: string;
  suit_number: string | null;
  scheduled_at: string;
  court: string | null;
  purpose: string | null;
  purpose_kind: string | null;
  lawyer_id: string | null;
}

/** Row of firm_cause_list: an open (unvacated, un-updated) sitting. */
export interface CauseListRow {
  court_event_id: string;
  firm_id: string;
  matter_id: string;
  reference: string;
  cause_title: string;
  suit_number: string | null;
  scheduled_at: string;
  on_date: string;
  court_id: string | null;
  court: string | null;
  courtroom: string | null;
  judge: string | null;
  purpose_kind: string | null;
  purpose: string | null;
  source: string;
  /** Migration 38 */
  source_document_id?: string | null;
  source_ref?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  evidenced?: boolean;
}

export interface MatterCounselRow {
  id: string;
  firm_id: string;
  matter_id: string;
  side: "opposing" | "co_counsel" | "other";
  party_name: string | null;
  party_side: string | null;
  counsel_firm_id: string | null;
  counsel_name: string | null;
  counsel_firm_name: string | null;
  scn: string | null;
  email: string | null;
  phone: string | null;
  address_for_service: string | null;
  on_record: boolean;
  accepts_service: boolean;
  note: string | null;
  created_at: string;
}

/** Row of firm_service_directory: an active firm on Docket, for choosing counsel. */
export interface ServiceDirectoryRow {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  state_code: string | null;
  accepts_platform_service: boolean;
  address_for_service: Record<string, unknown>;
}

export interface TaskRow {
  id: string;
  firm_id: string;
  matter_id: string | null;
  assignee_id: string | null;
  title: string;
  due_at: string | null;
  status: string;
  created_at: string;
  /** Migration 39: a task a pack's stage started, once per matter. */
  template_key?: string | null;
  pack_key?: string | null;
  status_key?: string | null;
}

export interface InviteRow {
  id: string;
  firm_id: string;
  matter_id: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  token: string;
  expires_at: string;
  accepted_by: string | null;
  created_at: string;
}

export interface InvoiceRow {
  id: string;
  firm_id: string;
  number: string;
  client_id: string;
  matter_id: string | null;
  appointment_id: string | null;
  currency: "NGN" | "USD";
  subtotal_minor: number;
  vat_minor: number;
  total_minor: number;
  paid_minor: number;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  created_at: string;
}

export interface InvoiceItemRow {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_minor: number;
}

export interface AvailabilityRule {
  id: string;
  firm_id: string;
  lawyer_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  slot_min: number;
  max_per_day: number;
}

export interface AvailabilityException {
  id: string;
  firm_id: string;
  lawyer_id: string;
  on_date: string;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

/** Result of create_invoice() / issue_invoice(). */
export interface InvoiceResult {
  invoice_id: string;
  number: string;
  subtotal_minor?: number;
  vat_minor?: number;
  total_minor?: number;
  currency?: string;
  status: string;
}

/** Result of invite_matter_party(). */
export interface InviteResult {
  invite_id: string;
  token: string;
  matter_id: string;
  matter_reference: string;
  matter_title: string;
  firm_id: string;
  role: string;
  expires_at: string;
}

/** The controlled outcomes post_court_update() accepts. */
export const COURT_OUTCOMES: Array<{ value: string; label: string; needsNextDate?: boolean; asksInstance?: boolean }> = [
  { value: "adjourned", label: "Adjourned", asksInstance: true },
  { value: "hearing_held", label: "Hearing held" },
  { value: "mention", label: "Mention" },
  { value: "ruling_delivered", label: "Ruling delivered" },
  { value: "judgment_delivered", label: "Judgment delivered" },
  { value: "struck_out", label: "Struck out" },
  { value: "stood_down", label: "Stood down" },
  { value: "court_did_not_sit", label: "Court did not sit" },
  { value: "hearing_notice", label: "Hearing notice", needsNextDate: true },
  { value: "adjourned_sine_die", label: "Adjourned sine die" },
];

export const PURPOSE_KINDS = ["mention", "hearing", "cmc", "pre_trial", "motion", "ruling", "judgment", "arraignment", "trial", "other"] as const;

export const SERVICE_METHODS: Array<{ value: string; label: string; hint?: string }> = [
  { value: "platform", label: "Through Docket", hint: "Only when the other firm has undertaken to accept service here" },
  { value: "counsel_address", label: "At counsel's address for service" },
  { value: "personal", label: "Personal service" },
  { value: "courier", label: "Courier" },
  { value: "bailiff", label: "Bailiff / sheriff" },
  { value: "email", label: "Email" },
  { value: "registered_post", label: "Registered post" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "publication", label: "Publication (substituted)" },
  { value: "pasting", label: "Pasting (substituted)" },
];

export const MATTER_TYPES = ["litigation", "property", "corporate", "estate", "family", "employment",
  "debt_recovery", "ip", "regulatory", "immigration", "advisory", "criminal", "arbitration", "other"] as const;
export type MatterType = (typeof MATTER_TYPES)[number];

// ---------------------------------------------------------------- slice 5: admin surfaces (migration 20)

/** A firm asking the platform to point a hostname at its public site. */
export interface DomainRequestRow {
  id: string;
  firm_id: string;
  hostname: string;
  status: "requested" | "verifying" | "live" | "rejected" | "withdrawn";
  /** The records the firm has to add at its registrar, as the provider returned them. */
  verification: Record<string, unknown>;
  note: string | null;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What a provider sent and what Docket did about it. Platform-read only. */
export interface WebhookEventRow {
  id: string;
  provider: string;
  event_type: string | null;
  provider_ref: string | null;
  signature_ok: boolean;
  outcome: "processed" | "ignored" | "unverified" | "unreadable" | "error";
  error: string | null;
  firm_id: string | null;
  invoice_id: string | null;
  received_at: string;
  notification_id?: string | null;
}

/** One row per firm × status × channel × event. Counts, never payloads. */
export interface NotificationHealthRow {
  firm_id: string | null;
  firm_name: string | null;
  firm_slug: string | null;
  status: string;
  channel: string;
  event: string;
  rows: number;
  oldest: string;
  newest: string;
  overdue: number;
  most_attempts: number;
  last_error: string | null;
  /** Migration 37: what the provider and its receipts said, as counts. */
  accepted: number;
  delivered: number;
  bounced: number;
  undelivered: number;
  most_send_attempts: number;
}

/** platform_notification_cost (migration 37): what went out and what it cost, per firm and month, by currency. */
export interface NotificationCostRow {
  firm_id: string | null;
  firm_name: string | null;
  firm_slug: string | null;
  month: string;
  provider: string | null;
  channel: string;
  cost_currency: "NGN" | "USD" | null;
  messages: number;
  segments: number;
  /** Null when nothing in the group was priced. */
  cost_minor: number | null;
  /** Messages accepted at no entered rate: unpriced, not free. */
  unpriced: number;
}

export interface FirmActiveMattersRow {
  firm_id: string;
  firm_name: string;
  firm_slug: string;
  active_matters: number;
}

export interface ProviderRateRow {
  provider: string;
  channel: string;
  currency: "NGN" | "USD";
  unit_minor: number;
  per_segment: boolean;
  effective_from: string;
  note: string | null;
  set_by: string | null;
  created_at: string;
}

/** A payment that did not settle cleanly, down to what reconciling it needs. */
export interface SettlementHealthRow {
  payment_id: string;
  firm_id: string;
  firm_name: string | null;
  firm_slug: string | null;
  invoice_number: string;
  amount_minor: number;
  currency: string;
  status: string;
  provider_ref: string;
  paid_at: string | null;
  created_at: string;
  reported_subaccount: string | null;
  expected_subaccount: string | null;
  settlement_mismatch: boolean;
}

/** One failed message, reachable so it can be retried. No payload, no recipient. */
export interface FailedNotificationRow {
  id: string;
  firm_id: string | null;
  firm_name: string | null;
  firm_slug: string | null;
  channel: string;
  event: string;
  attempts: number;
  error: string | null;
  created_at: string;
  send_after: string;
  failure_kind: "transient" | "permanent" | null;
  send_attempts: number;
  provider: string | null;
}

/** A firm's override of the sentence a client reads for one event. */
export interface NotificationTemplate {
  subject?: string;
  text: string;
}

// FirmAdminRow, FirmPlan and FirmStatus are already declared above — the lifecycle view and its
// two enums came with the platform slice.
export const FIRM_PLANS: readonly FirmPlan[] = ["free", "standard", "enterprise"];
export const FIRM_STATUSES: readonly FirmStatus[] = ["pending", "active", "suspended"];
export const DOMAIN_REQUEST_STATUSES = ["requested", "verifying", "live", "rejected", "withdrawn"] as const;

/** The roles a firm has. Only an owner may appoint or stand down another owner. */
export const FIRM_ROLES: Array<{ value: string; label: string; hint: string }> = [
  { value: "owner", label: "Owner", hint: "Everything, including appointing other owners and closing the firm" },
  { value: "admin", label: "Administrator", hint: "Settings, services, people, billing — everything except owners" },
  { value: "lawyer", label: "Lawyer", hint: "Matters, court updates, consultations and their own diary" },
  { value: "staff", label: "Staff", hint: "Matters and consultations, but not the firm's settings" },
];

/** storage_integrity() (migration 28): the bytes, measured against the rows. */
export interface StorageIntegrity {
  /** False on a database with no storage schema (local); every count below is then from the manifest alone. */
  storage_present: boolean;
  /** storage.objects rows in the documents and intake-uploads buckets: what should exist. */
  objects: number;
  manifest_rows: number;
  /** Objects the manifest has never fetched. */
  unverified: number;
  ok: number;
  /** Rows say it exists; the bytes 404. */
  missing: number;
  /** The bytes hash differently from document_versions.checksum. */
  mismatch: number;
  error: number;
  /** Verified more than seven days ago. */
  stale: number;
  /** document_versions rows with no storage.objects row at all: the "looks intact" failure. */
  row_only_versions: number;
  last_run_at: string | null;
}

/**
 * search_docket() (migration 43): one row per hit, across every kind of thing Docket holds text
 * about. The function is SECURITY INVOKER, so a hit is by construction something the caller could
 * already open — the screens do no filtering of their own and must not start.
 */
export type SearchKind =
  | "matter" | "update" | "message" | "document" | "task" | "deadline" | "court_event"
  | "adverse_party" | "note" | "internal_note" | "invoice" | "appointment" | "person";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  firm_id: string | null;
  /** Null for a person: which matters a client has is the wall's to decide, not a search result's. */
  matter_id: string | null;
  title: string;
  /** The matching words wrapped in << >> by ts_headline. Rendered as marks, never as HTML. */
  snippet: string | null;
  occurred_at: string | null;
  rank: number;
}

/** representations (migration 44): who may act for a client, on what, until when. */
export interface RepresentationRow {
  id: string;
  firm_id: string;
  principal_id: string;
  /** Null until somebody redeems the token — being named is not the same as being bound. */
  representative_id: string | null;
  capacity: string;
  organisation_name: string | null;
  scope: "matter" | "all_matters";
  matter_id: string | null;
  can_view_docs: boolean;
  can_pay: boolean;
  /** Calendar days. Never rendered through a timezone. */
  starts_on: string;
  expires_on: string | null;
  authority_kind: string;
  authority_ref: string | null;
  verification_note: string | null;
  verified_by: string;
  verified_at: string;
  invited_email: string | null;
  invited_phone: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
}

/** identity_events (migration 44): a client changed the number or address their firm reaches them on. */
export interface IdentityEventRow {
  id: string;
  user_id: string;
  field: "phone" | "email";
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

/** matter_collaborations (migration 45): a referral, joint retainer or agency between two firms. */
export interface CollaborationRow {
  id: string;
  firm_id: string;
  matter_id: string;
  with_firm_id: string;
  kind: string;
  /** A snapshot taken at proposal. The other firm never reads the live matter. */
  case_title: string | null;
  suit_number: string | null;
  court_name: string | null;
  scope_note: string;
  share_updates: boolean;
  ends_on: string | null;
  proposed_by: string | null;
  proposed_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  ended_at: string | null;
  end_reason: string | null;
}

/** collaboration_inbox (migration 45): the collaborating firm's only read path. */
export interface CollaborationInboxRow {
  id: string;
  kind: string;
  case_title: string | null;
  suit_number: string | null;
  court_name: string | null;
  scope_note: string;
  share_updates: boolean;
  ends_on: string | null;
  proposed_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  ended_at: string | null;
  from_firm_id: string;
  from_firm_name: string;
  with_firm_id: string;
  shared_documents: number;
}

export interface CollaborationDocumentRow {
  id: string;
  collaboration_id: string;
  document_id: string;
  document_version_id: string;
  checksum: string | null;
  shared_at: string;
  withdrawn_at: string | null;
}

export interface CollaborationNoteRow {
  id: string;
  collaboration_id: string;
  firm_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}
