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
}

export interface MatterRow {
  id: string;
  firm_id: string;
  reference: string;
  title: string;
  type: string;
  status_id: string | null;
  description: string | null;
  next_action: string | null;
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
}

export interface CourtEventRow {
  id: string;
  matter_id: string;
  firm_id: string;
  scheduled_at: string;
  court_name: string | null;
  purpose: string | null;
  outcome_update_id: string | null;
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
}

export interface DocumentVersionRow {
  id: string;
  document_id: string;
  storage_path: string;
  mime: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
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
  read_at: string | null;
  created_at: string;
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
  unread_messages: number;
  overdue_tasks: number;
  client_uploads: number;
  service_to_acknowledge: number;
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
