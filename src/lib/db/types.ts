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
