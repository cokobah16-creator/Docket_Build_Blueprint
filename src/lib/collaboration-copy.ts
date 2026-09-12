// The words the collaboration screens use, and the shape the actions take.
// Separate from the "use server" module, which may export async functions and nothing else.

export const COLLABORATION_KINDS = [
  { value: "referral", label: "Referral", hint: "You are handing the matter, or part of it, to them" },
  { value: "joint_counsel", label: "Joint counsel", hint: "You are both on the record and working it together" },
  { value: "agency", label: "Agency", hint: "They appear or file for you, on your instructions" },
] as const;

export const KIND_LABEL = new Map<string, string>(COLLABORATION_KINDS.map((k) => [k.value, k.label]));

export interface ProposeInput {
  matterId: string;
  withFirmId: string;
  kind: string;
  scopeNote: string;
  shareUpdates: boolean;
  endsOn: string | null;
}
