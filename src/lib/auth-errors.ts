// Docket's own words for a sign-in that did not work.
//
// THE PROBLEM THIS SOLVES. Every sign-in surface in this repository ended the same way:
// `if (err) setError(err.message)`. That put GoTrue's internal English in front of a client —
// "For security purposes, you can only request this after 54 seconds", "Signups not allowed for
// otp", "Unsupported phone provider" — sentences written for whoever is reading a server log, not
// for a woman standing outside a registry in Ikeja wondering whether her code is coming. Two of
// those strings are worse than merely unhelpful. "Signups not allowed for otp" answers a question
// nobody asked out loud: whether this number already belongs to one of the firm's clients. And
// sms_send_failed is formatted "Error sending %s OTP to provider: %v" — the SMS provider's raw
// error, interpolated, shipped to a browser. Neither is ever rendered again.
//
// WHAT THE COPY WILL NOT SAY. No branch of this file may distinguish "we have never heard of that
// number" from "that code is wrong". Not "not registered", not "no account", not "ask your firm to
// invite you first". Docket clients are invited by their firm, and which numbers a firm holds is
// the firm's business: the platform already refuses to say whether an invitation token is unknown,
// used or expired (app/app/(auth)/join/actions.ts) and returns the same 42501 for a missing invoice
// as for a forbidden one (docs/RPC_REFERENCE.md). A sign-in screen that answered the question would
// undo all of it for the price of one adjective. GoTrue helps on the verify step, where wrong code,
// expired code and never-issued code collapse into one 403; this file keeps that collapse rather
// than reopening it.
//
// WHAT THIS CANNOT CLOSE, STATED PLAINLY. If a project ever turns signups off globally, GoTrue
// itself answers 200 for an identifier it knows and 422 otp_disabled for one it does not, and no
// client-side copy can hide that timing. The remedy is to leave signups on and never pass
// shouldCreateUser:false — which is the caller's job, and the caller does it. What this file
// guarantees is only that Docket never narrates the difference.
//
// KEY ON THE CODE FIRST, THE ENGLISH SECOND. AuthError carries `code` (supabase-js is pinned at
// ^2.55.0, well past the release that added it), and a code survives a GoTrue upgrade in a way the
// message does not — "For security purposes…" is a Go format string in the server that has been
// reworded across versions, not an API contract. Older responses and rewriting proxies can arrive
// with no code at all, so each rule reads the code, then the message, then the status, and then
// gives up honestly.
//
// WHY THIS IS A MODULE AND NOT A FUNCTION IN THE FORM. Nothing in this repository can be built,
// typechecked or Playwright-run from a session with no node_modules, so a pure function over
// { code, status, message } with no imports is the only thing here that can be exercised at all —
// plain `node`, the whole table of real GoTrue failures, before any of it ships. The three other
// sign-in screens (app/firm/(auth)/login, app/firm/(auth)/join, the MFA enrolment) have the same
// raw-message problem and can import this when their turn comes. They are not touched here.
//
// THE SHAPE OF EVERY SENTENCE. What happened, then what to do — the shape src/lib/drafts.ts already
// uses for UPLOAD_STOPPED and NOT_SENT. Nothing here trails off into "please try again later".

/** The three fields a Supabase AuthError carries that are worth reading. */
export interface AuthFailureShape {
  code: string | null;
  status: number | null;
  message: string | null;
}

/** Which call failed. The same GoTrue code means different things at different steps. */
export type SignInStep = "send_sms" | "verify_sms" | "send_email";

export interface SignInProblem {
  /** The sentence to show. Always ours, never the provider's. */
  text: string;
  /**
   * Set only for a frequency limit: how long until another send is allowed. The caller shows a
   * countdown rather than an error — a code is already on its way, and being told off for asking
   * is not news the person can act on.
   */
  cooldownSeconds?: number;
  /** Set when the whole method is switched off server-side and the other one is the way through. */
  switchTo?: "phone" | "email";
}

/** GoTrue's default SMS_MAX_FREQUENCY. scripts/configure-providers.sh does not override it. */
export const DEFAULT_RESEND_SECONDS = 60;

// ---------------------------------------------------------------------------------------------
// The sentences
// ---------------------------------------------------------------------------------------------

/** Anything unrecognised. Says nothing about the identifier, because it knows nothing. */
export const SIGN_IN_TROUBLE = "Sign-in is having trouble right now. Try again in a moment.";

/** The IP-level limit, which is about this device and not about this person. */
export const TOO_MANY_TRIES = "Too many attempts from this device. Wait a few minutes and try again.";

/**
 * Wrong code, expired code, and a number GoTrue has never issued a code to all return one 403 with
 * one message. The server declines to tell them apart; inventing the distinction here — from a
 * timer of our own, say — would rebuild the oracle GoTrue deliberately closed.
 */
export const CODE_DID_NOT_WORK = "That code did not work. Check the six digits, or ask for a new code.";

/** The send failed at the SMS provider, or the send hook timed out. Same move either way. */
export const CODE_NOT_SENT = "We could not send a code to that number. Check it, or sign in by email instead.";

/** Phone sign-in refused for a reason that is about the number, said without saying which. */
export const PHONE_NO_ENTRY =
  "We could not sign you in with that number. Check it, or use the email address your firm has for you.";

/** The same, for the email side. */
export const EMAIL_NO_ENTRY =
  "We could not sign you in with that address. Check it, or use the phone number your firm has for you.";

/**
 * The connection dropped before the request landed. Shaped like drafts.ts NOT_SENT, minus its
 * promise: this form keeps nothing on the device.
 */
export const SIGN_IN_NOT_SENT = "Not sent — the connection dropped. Try again when you are back online.";

/** Said by the form itself when it declines to make a round trip it knows will be refused. */
export const SMS_JUST_SENT = "A code was just sent to that number. The button below says when another can go.";
export const LINK_JUST_SENT = "A link was just sent to that address. The button below says when another can go.";

const SMS_TURNED_OFF = "Sign-in by text message is not available. Use the email address your firm has for you.";
const EMAIL_TURNED_OFF = "Sign-in by email is not available. Use your phone number.";
const EMAIL_UNUSABLE = "That email address cannot be used. Try another, or sign in with your phone number.";
const EMAIL_UNDELIVERABLE = "We could not send to that address. Sign in with your phone number, or tell your firm.";

/**
 * The firm console's own words for this exact failure (src/lib/actions/firm-settings.ts) rather
 * than a third phrasing invented for the client side. Both the Nigerian and the international form
 * are named, because the blueprint routes diaspora clients through this same field.
 *
 * The echo is clipped: this is a phone field, and a paste of half a WhatsApp message should not
 * become a paragraph of red text on a 360px screen.
 */
export function unreadablePhone(raw: string): string {
  const shown = raw.trim().slice(0, 24);
  return `“${shown}” is not a phone number Docket can read. Use 0803 123 4567 or a full international number such as +44 20 7946 0000.`;
}

// ---------------------------------------------------------------------------------------------
// Reading the failure
// ---------------------------------------------------------------------------------------------

/** Pull the three readable fields off whatever was thrown or returned, trusting none of them. */
export function failureShape(err: unknown): AuthFailureShape {
  const raw = (err ?? {}) as { code?: unknown; error_code?: unknown; status?: unknown; message?: unknown };
  const code =
    typeof raw.code === "string" ? raw.code : typeof raw.error_code === "string" ? raw.error_code : null;
  return {
    code,
    status: typeof raw.status === "number" ? raw.status : null,
    message: typeof raw.message === "string" ? raw.message : null,
  };
}

/**
 * GoTrue's frequency-limit sentence carries the remaining seconds, and it is worth having: another
 * tab, another device or a clock skew can leave a cooldown running that this browser never started,
 * and sixty would be a guess.
 *
 * The number is an integer division truncated server-side, so "0 seconds" is a sentence GoTrue
 * really prints — clamped up to 1, because a countdown that opens at zero reads as broken. The
 * upper clamp is there because the seconds arrive from the network and a button that says "Resend
 * code in 86400s" is a bug wearing a countdown's clothes. The wording is a format string, not a
 * contract, so a miss falls back rather than failing.
 */
export function cooldownFrom(message: string | null | undefined, fallback = DEFAULT_RESEND_SECONDS): number {
  const found = /after (\d+) seconds?/i.exec(message ?? "");
  const parsed = found ? Number(found[1]) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(300, Math.max(1, Math.trunc(parsed)));
}

/**
 * House copy for a sign-in failure, plus the two things the caller has to act on rather than print:
 * a per-identifier cooldown, and a method that is switched off at the project level.
 */
export function signInProblem(step: SignInStep, failure: AuthFailureShape): SignInProblem {
  const code = (failure.code ?? "").trim().toLowerCase();
  const message = failure.message ?? "";
  const status = failure.status ?? 0;
  const says = (pattern: RegExp) => pattern.test(message);

  // A frequency limit is not a failure the person caused, and it means a code or link is already on
  // its way. Handled before everything else so neither branch below can render it as red.
  if (
    code === "over_sms_send_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    says(/only request this after/i)
  ) {
    return {
      text: step === "send_email" ? LINK_JUST_SENT : SMS_JUST_SENT,
      cooldownSeconds: cooldownFrom(message),
    };
  }

  // The other limit with the same status: too many requests from this IP, whatever they were about.
  // Waiting out a countdown will not help, so it does not get one — and telling someone to go and
  // look for a text that was never sent would be worse than saying nothing.
  if (code === "over_request_rate_limit" || (status === 429 && !code)) {
    return { text: TOO_MANY_TRIES };
  }

  if (step === "verify_sms") {
    // otp_expired covers wrong, expired and never-issued. validation_failed is a malformed token,
    // which the field's own constraints should already have caught. otp_disabled joins them rather
    // than becoming an answer about whose number this is.
    if (
      code === "otp_expired" ||
      code === "validation_failed" ||
      code === "otp_disabled" ||
      status === 403 ||
      status === 401 ||
      says(/token has expired or is invalid|invalid token/i)
    ) {
      return { text: CODE_DID_NOT_WORK };
    }
    return { text: SIGN_IN_TROUBLE };
  }

  if (step === "send_sms") {
    if (code === "phone_provider_disabled" || says(/unsupported phone provider/i)) {
      return { text: SMS_TURNED_OFF, switchTo: "email" };
    }
    if (
      code === "sms_send_failed" ||
      code === "hook_timeout" ||
      code === "hook_timeout_after_retry" ||
      says(/error sending .*otp to provider|failed to reach hook/i)
    ) {
      // Never interpolate the message here: the provider's raw error is inside it.
      return { text: CODE_NOT_SENT };
    }
    // Reached only if a number got past the form's own resolver, which should not happen — but
    // GoTrue and this repository disagree about at least the +234-with-a-trunk-zero shape, so the
    // branch is real.
    if (code === "validation_failed" || says(/e\.164|invalid phone/i)) {
      return { text: PHONE_NO_ENTRY };
    }
    if (code === "otp_disabled" || code === "user_banned" || says(/signups not allowed/i)) {
      return { text: PHONE_NO_ENTRY };
    }
    return { text: SIGN_IN_TROUBLE };
  }

  // step === "send_email"
  if (code === "email_provider_disabled" || says(/email logins are disabled/i)) {
    return { text: EMAIL_TURNED_OFF, switchTo: "phone" };
  }
  if (code === "email_address_invalid" || says(/test domains are currently not supported/i)) {
    return { text: EMAIL_UNUSABLE };
  }
  // The project is still on Supabase's built-in SMTP, which only delivers to members of the
  // Supabase org. A real client would otherwise get no email and no explanation at all.
  if (code === "email_address_not_authorized") return { text: EMAIL_UNDELIVERABLE };
  if (code === "validation_failed") return { text: EMAIL_UNUSABLE };
  if (code === "otp_disabled" || code === "user_banned" || says(/signups not allowed/i)) {
    return { text: EMAIL_NO_ENTRY };
  }
  return { text: SIGN_IN_TROUBLE };
}
