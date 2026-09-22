// The sentence half of src/lib/user-error.ts, with no server imports, so a
// client component can turn a Supabase or network error into words too.
//
// Every sentence is built from a fixed template and a fixed `what`, which is
// what lets a page that receives one through its URL (a server action's form
// can only report back by redirecting) check that the sentence is one Docket
// wrote, rather than any text somebody put in a link — see safeNotice().

export interface DbErrorLike {
  message?: string;
  code?: string;
}

const TEMPLATES = {
  denied: (w: string) => `${w} was not saved: this account is not allowed to do that here. If you think it should be, message your lawyer.`,
  tooLarge: (w: string) => `${w} was not saved because the file is larger than this firm accepts. Try a smaller file, or a scan at lower resolution.`,
  fileType: (w: string) => `${w} was not saved because that type of file cannot be uploaded here. PDF, Word documents and photos are accepted.`,
  duplicate: (w: string) => `${w} was already recorded, so nothing new was saved.`,
  offline: (w: string) => `${w} was not saved because Docket could not be reached. Check your connection and try again.`,
  missing: (w: string) => `${w} was not saved because the record could not be found. It may have been removed. Refresh the page and try again.`,
  other: (w: string) => `${w} was not saved. Please try again. If it keeps happening, message your firm so they can look into it.`,
} as const;

/** The human sentence for a failed action. `what` names the action: "Your message", "The upload". */
export function userErrorMessage(error: unknown, what: string): string {
  const e = (error ?? {}) as DbErrorLike;
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";

  if (code === "42501" || message.includes("row-level security") || message.includes("not permitted")) return TEMPLATES.denied(what);
  if (message.includes("too large") || message.includes("maximum allowed size")) return TEMPLATES.tooLarge(what);
  if (message.includes("mime type") || message.includes("invalid file type")) return TEMPLATES.fileType(what);
  if (code === "23505" || message.includes("duplicate key")) return TEMPLATES.duplicate(what);
  if (message.includes("fetch failed") || message.includes("network") || message.includes("timeout")) return TEMPLATES.offline(what);
  if (code === "PGRST116" || message.includes("not found")) return TEMPLATES.missing(what);
  return TEMPLATES.other(what);
}

/** Fixed sentences a page may also receive through its URL. */
export const KNOWN_NOTICES = [
  "The payment could not be started, and you have not been charged. Please try again in a moment.",
  "This consultation has already started, so it can no longer be cancelled here. Message the firm instead.",
  "This consultation is already closed, so there is nothing to cancel.",
  "Check the form: a field was left empty or is not in the expected format.",
  "That timezone is not recognised. Choose one from the list.",
  // startInvoicePayment()'s own refusals, which reach the matter page through its URL.
  "Payments are not configured yet.",
  "Invoice not found.",
  "This invoice was cancelled.",
  "Add an email address on your profile first so we can send your receipt.",
  "This firm is not yet set up to receive payments. Please contact the firm.",
] as const;

/** Every `what` a server action may pass to userError() for a message that travels in a URL. */
const URL_WHATS = ["Your profile", "The cancellation", "The payment"] as const;

const ALLOWED = new Set<string>([
  ...KNOWN_NOTICES,
  ...URL_WHATS.flatMap((w) => Object.values(TEMPLATES).map((t) => t(w))),
]);

/**
 * A `?error=` value, if Docket wrote it; otherwise a generic sentence.
 *
 * Anything in a query string can be typed by anyone, and an alert on a firm's
 * branded portal is exactly where a phishing sentence ("call this number to
 * verify your account") would be believed. So a page shows the text only when
 * it is byte-for-byte one of the sentences above.
 */
export function safeNotice(raw: string | undefined | null): string | null {
  if (!raw) return null;
  return ALLOWED.has(raw) ? raw : "That was not completed, and nothing was changed. Please try again.";
}
