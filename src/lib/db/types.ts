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
