// The columns an import row may carry. A plain module, not a server-action file: a "use server"
// module may export only async functions, and a constant imported from one into a client
// component arrives as a server-reference stub, not the array.
export const IMPORT_FIELDS = [
  "title", "cause_title", "type", "status", "court", "suit_number", "judicial_division",
  "handling_lawyer", "originating_lawyer", "opened_on", "closed_on", "legacy_reference",
  "client_name", "client_phone", "client_email", "opposing_party", "description", "next_action",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
