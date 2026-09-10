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
