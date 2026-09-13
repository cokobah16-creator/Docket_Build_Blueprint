// The words the delegation screens use, and the shape the action takes.
//
// Separate from src/lib/actions/delegation.ts because that module is "use server": Next.js allows
// a server-action module to export async functions and nothing else, so a list of labels living
// there fails the build rather than the typecheck. The values themselves are the database's — the
// capacity and authority_kind check constraints in migration 44 are what actually decide.

export const CAPACITIES = [
  { value: "company_officer", label: "Officer of a company", hint: "A director, company secretary or authorised employee" },
  { value: "attorney", label: "Attorney under a power", hint: "Acting under a power of attorney" },
  { value: "receiver", label: "Receiver or administrator", hint: "Appointed over the client's affairs" },
  { value: "family", label: "Family member", hint: "A relative the client has authorised" },
  { value: "carer", label: "Carer or helper", hint: "Someone assisting the client day to day" },
  { value: "employee", label: "Employee", hint: "Acting for their employer, who is the client" },
  { value: "other", label: "Something else", hint: "Describe it in the note" },
] as const;

export const AUTHORITY_KINDS = [
  { value: "board_resolution", label: "Board resolution" },
  { value: "power_of_attorney", label: "Power of attorney" },
  { value: "letter_of_authority", label: "Letter of authority" },
  { value: "court_order", label: "Court order" },
  { value: "in_person", label: "Seen in person" },
  { value: "other", label: "Something else" },
] as const;


export interface GrantInput {
  firmId: string; principalId: string; capacity: string; authorityKind: string;
  matterId: string | null; organisation: string | null; canViewDocs: boolean; canPay: boolean;
  expiresOn: string | null; authorityRef: string | null; note: string | null;
  invitedEmail: string | null; invitedPhone: string | null;
}
