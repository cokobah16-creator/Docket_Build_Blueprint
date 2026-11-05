// The words the Docket Network screens use, and the shapes the actions take. Separate from the
// "use server" module, which may export async functions and nothing else.

export const COLLABORATION_ROLES = [
  { value: "lead_counsel", label: "Lead counsel", hint: "They have conduct; you instruct them" },
  { value: "supporting_counsel", label: "Supporting counsel", hint: "They support your team on the file" },
  { value: "local_counsel", label: "Local counsel", hint: "They act where the court or the client is" },
  { value: "foreign_counsel", label: "Foreign counsel", hint: "They advise on another jurisdiction's law" },
  { value: "co_counsel", label: "Co counsel", hint: "You are both on the record together" },
  { value: "specialist_consultant", label: "Specialist consultant", hint: "They bring one specialism to the file" },
] as const;

export const ROLE_LABEL = new Map<string, string>(COLLABORATION_ROLES.map((r) => [r.value, r.label]));

export const CONNECTION_STATUS_LABEL: Record<string, string> = {
  active: "Connected",
  review: "In review by Docket",
  suspended: "Suspended",
  ended: "Ended",
};

export const INVITATION_STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for the code",
  verified: "Code entered, awaiting their answer",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  revoked: "Withdrawn",
};

export const APPROACH_KINDS = [
  { value: "introduction", label: "Introduction", hint: "You would like to be introduced, with a view to working together" },
  { value: "referral_request", label: "Referral request", hint: "You have a matter to refer, described without any client confidential information" },
] as const;

export interface NetworkProfileInput {
  visibility: "network" | "connections" | "private";
  official_email: string;
  website: string;
  telephone: string;
  office_address: string;
  registration_details: string;
  country_code: string;
  region: string;
  city: string;
  practice_areas: string[];
  jurisdictions: string[];
  languages: string[];
  specialisms: string[];
  description: string;
  accepts_referrals: boolean;
  accepts_joint_matters: boolean;
  accepts_introductions: boolean;
  share_contacts: boolean;
}
