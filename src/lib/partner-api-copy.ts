// The scopes a key may carry, in the firm's words. The list itself is the database's:
// api_credentials_scopes_chk refuses anything outside it, so this cannot drift into a promise.

export const API_SCOPES = [
  { value: "matters:read", label: "Matters", hint: "Reference, title, court, suit number, stage and whether it is restricted" },
  { value: "invoices:read", label: "Invoices", hint: "Number, status, amount and currency. Never a draft" },
  { value: "clients:read", label: "Clients", hint: "Who the firm acts for. No matter is named against them" },
  { value: "events:read", label: "Event feed", hint: "Matters opened, staged and closed; invoices issued and paid" },
] as const;

export const EVENT_TYPES = [
  "matter.opened", "matter.stage_changed", "matter.closed", "invoice.issued", "invoice.paid",
] as const;
