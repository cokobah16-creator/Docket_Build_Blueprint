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

// The fixed sentences below follow docs/VOICE.md, rule 12: what was not done, whether any money
// moved or anything was saved, and what to do next. None names the firm, although the voice
// prefers it by name: a sentence that travels in a URL is shown only if it is byte for byte one
// of these, so it cannot carry a name. The screens around them name the firm.
//
// The actions return these constants rather than their own copies of the words, so a sentence
// cannot be reworded on one side and not the other: KNOWN_NOTICES is built from them.

/**
 * Why a payment did not start. startInvoicePayment() and startPayment() (which hands a booking's
 * invoice to it) refuse with these and nothing else, never Paystack's own message. The pay panels
 * show them as they are, and a page that passes one on through its URL can show it too.
 */
export const PAYMENT_NOTICES = {
  unavailable: "Online payment is not available yet, so Paystack did not open. Message your firm to ask how to pay.",
  invoiceMissing: "This invoice could not be found, so Paystack did not open. Refresh the page and try again.",
  bookingMissing: "This booking could not be found, so Paystack did not open. Refresh the page and try again.",
  invoiceCancelled: "This invoice was cancelled, so it can no longer be paid. Message your firm if you have a question about it.",
  invoiceNotPayable: "This invoice cannot be paid online yet, so Paystack did not open. Message your firm if you have a question about it.",
  bookingCancelled: "This booking was cancelled, so it can no longer be paid for. Message your firm if you have a question about it.",
  holdEnded: "Your hold has ended, so this time can no longer be paid for. Please choose a new time.",
  needsEmail: "Paystack did not open, because it needs an email address to send your receipt. Add one on your profile, then try again.",
  firmNotReady: "Paystack did not open, because your firm cannot take payments online yet. Message your firm to ask how to pay.",
  tooManyAttempts: "Paystack did not open, because there have been too many payment attempts in the last hour. Please try again in an hour.",
  didNotOpen: "Paystack did not open, so you have not been charged. Please try again in a moment.",
} as const;

/** cancelAppointment()'s refusals, which reach the consultation page through its URL. */
export const CANCEL_NOTICES = {
  unavailable: "Your consultation was not cancelled, because cancelling is not available here yet. Message your firm to cancel it.",
  started: "This consultation has already started, so it can no longer be cancelled here. Message your firm instead.",
  closed: "This consultation is already over or cancelled, so there is nothing to cancel.",
} as const;

/** updateProfile()'s own refusals, which reach the profile page through its URL. */
export const PROFILE_NOTICES = {
  invalid: "Your profile was not saved, because something in the form is not in the expected format. Check it, then save again.",
  timezone: "Your profile was not saved, because that time zone is not recognised. Choose one from the list, then save again.",
} as const;

/** Fixed sentences a page may also receive through its URL. */
export const KNOWN_NOTICES = [
  ...Object.values(PAYMENT_NOTICES),
  ...Object.values(CANCEL_NOTICES),
  ...Object.values(PROFILE_NOTICES),
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
