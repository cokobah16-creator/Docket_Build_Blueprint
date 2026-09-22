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
export type SignInStep =
  | "send_sms"
  | "send_whatsapp"
  | "verify_sms"
  | "send_email"
  | "verify_email"
  | "start_google";

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

/**
 * The link half of the email failing, said without guessing which half of the cause it was.
 *
 * Three different things bring somebody here and Docket cannot tell them apart, so it names all
 * three. Expired and already-used are GoTrue's to know and it will not say. The third is the one
 * nobody expects: the sign-in link carries a PKCE code, and the verifier it needs was written to
 * the browser that ASKED for the link. Open it in Gmail's in-app browser, or on the laptop when
 * the phone asked, and the exchange fails on a link that is otherwise perfectly good — which is
 * exactly why the same email now carries a code, and why this sentence points at it.
 */
export const LINK_DID_NOT_WORK =
  "That sign-in link did not work. It may have expired, been used already, or been opened in a " +
  "different browser from the one that asked for it. Ask for a new link and open it in the same " +
  "browser you asked from.";

/** The send failed at the SMS provider, or the send hook timed out. Same move either way. */
export const CODE_NOT_SENT = "We could not send a code to that number. Check it, or sign in by email instead.";

/**
 * The same failure on the WhatsApp channel, which needs its own sentence because it has its own
 * way of being wrong: a number can be perfectly good and simply not be on WhatsApp, which is not
 * true of SMS. So this points at the text message rather than at the number.
 */
export const WHATSAPP_NOT_SENT =
  "We could not reach that number on WhatsApp. Send it as a text message instead, or sign in by email.";

/** Google sign-in is off at the project level, or the handshake never started. */
export const GOOGLE_UNAVAILABLE =
  "Signing in with Google is not available right now. Use the phone number or email your firm has for you.";

/**
 * The Google round trip came back without a session — which is NOT the same failure as a link.
 *
 * Google and the emailed magic link come home to the same route, so for a while they got the same
 * sentence, and that sentence talked about an email. Somebody who tapped "Continue with Google",
 * thought better of it at the consent screen and pressed Cancel was told that a sign-in link may
 * have expired or been opened in a different browser, and invited to type a code from an email
 * nobody had sent them. Google returns access_denied for a cancelled consent, which is the same
 * error_code a spent magic link arrives with; nothing in the parameters tells the two apart, so
 * the caller has to say which flow it is (app/auth/callback/route.ts, ?flow=google).
 *
 * BLAMES NOBODY, because the commonest cause is not a fault at all. Cancelling is a decision, and
 * a decision should not be reported as an error with a remedy attached to it. The other two ways
 * in are named because they are what the person does next, whichever it was.
 */
export const GOOGLE_DID_NOT_FINISH =
  "That Google sign-in did not finish, so you are not signed in. Nothing has changed — try Google " +
  "again, or use the phone number or email your firm has for you.";

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

  if (step === "verify_sms" || step === "verify_email") {
    // otp_expired covers wrong, expired and never-issued. validation_failed is a malformed token,
    // which the field's own constraints should already have caught. otp_disabled joins them rather
    // than becoming an answer about whose number — or whose address — this is. The email channel
    // answers with the same codes and gets the same sentence for the same reason: a client who
    // mistypes a digit and a stranger guessing at an address must not be able to tell each other's
    // outcome apart.
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

  if (step === "start_google") {
    // Nothing here is about the person: an OAuth handshake that will not start is about the
    // project's configuration or the network, and both leave the same two ways in.
    return { text: GOOGLE_UNAVAILABLE, switchTo: "phone" };
  }

  if (step === "send_whatsapp") {
    // GoTrue answers the WhatsApp channel with the same codes as SMS — it is the same Twilio call
    // with a different sender — so the rules are the SMS rules, and only the provider-failure
    // sentence differs, because "not on WhatsApp" is a real and common reason a good number fails.
    if (
      code === "sms_send_failed" ||
      code === "hook_timeout" ||
      code === "hook_timeout_after_retry" ||
      says(/error sending .*otp to provider|failed to reach hook/i)
    ) {
      return { text: WHATSAPP_NOT_SENT };
    }
    if (code === "phone_provider_disabled" || says(/unsupported phone provider/i)) {
      return { text: SMS_TURNED_OFF, switchTo: "email" };
    }
    if (code === "validation_failed" || says(/e\.164|invalid phone/i)) {
      return { text: PHONE_NO_ENTRY };
    }
    if (code === "otp_disabled" || code === "user_banned" || says(/signups not allowed/i)) {
      return { text: PHONE_NO_ENTRY };
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

// ---------------------------------------------------------------------------------------------
// The sign-in link coming back
// ---------------------------------------------------------------------------------------------

/**
 * Why /auth/callback turned somebody away, as one short key.
 *
 * A key rather than a sentence, because it travels on a URL: ?reason=link on the sign-in page. The
 * sentence is looked up at the other end, so the copy can change without invalidating links that
 * are already sitting in inboxes, and nothing GoTrue said is ever carried in a query string a
 * browser will log, put in a Referer header or keep in history.
 */
export type CallbackReason = "link" | "trouble" | "google";

/** The sentence for a ?reason= on the sign-in page. An unknown key says nothing rather than guessing. */
export function callbackMessage(reason: string | null | undefined): string | null {
  if (reason === "link") return LINK_DID_NOT_WORK;
  if (reason === "trouble") return SIGN_IN_TROUBLE;
  if (reason === "google") return GOOGLE_DID_NOT_FINISH;
  return null;
}

/**
 * The heading above that sentence.
 *
 * It lives here rather than in the two panels that render it because it was hardcoded in both, as
 * "That link did not sign you in" — true of a magic link and false of everything else that now
 * comes home to the same route. A heading that contradicts the paragraph under it is worse than no
 * heading, and two copies of it would have needed fixing twice.
 */
export function callbackTitle(reason: string | null | undefined): string {
  if (reason === "google") return "Google did not sign you in";
  if (reason === "trouble") return "That sign-in did not work";
  return "That link did not sign you in";
}

/**
 * What the callback should do with the parameters it was handed.
 *
 * TWO WAYS A SIGN-IN LINK FAILS, and only one of them used to be visible at all.
 *
 * GoTrue can refuse before Docket is reached: it redirects to the allow-listed URL with
 * ?error=access_denied&error_code=otp_expired rather than with a code, and the route used to read
 * only `code`, find none, and redirect to `next` as though nothing had happened. The page there
 * then bounced the caller to sign in with no explanation — the link looked like it did nothing.
 *
 * Or the exchange itself fails, which is the cross-browser case: the PKCE verifier lives in the
 * browser that asked for the link, so a link opened somewhere else arrives with a perfectly good
 * code that cannot be spent. That error was being discarded — `const { data } = await
 * exchangeCodeForSession(code)` — with the same silent bounce afterwards.
 *
 * Both are the same thing to the person holding the phone, and both get the same key.
 *
 * A THIRD WAY IN NOW SHARES THE ROUTE, and it is not an email at all. Google's PKCE handshake comes
 * home to /auth/callback exactly as a magic link does, with the same parameters spelled the same
 * way: cancel the Google consent screen and the browser arrives carrying access_denied, which is
 * the same error_code a magic link that has already been spent arrives with. There is nothing in
 * the parameters to tell them apart — so `flow` is passed in from the callback, which knows,
 * because it is on the redirect_to Docket itself constructed (?flow=google).
 *
 * WHEN THE FLOW IS GOOGLE, EVERY FAILURE IS A GOOGLE FAILURE, and the error codes are not consulted
 * at all. Splitting them finer would only invent distinctions the person cannot act on — a
 * cancelled consent, a client Google will not honour, and a verifier this browser does not hold all
 * leave them in one place with the same two alternatives — and every extra branch is another chance
 * to tell somebody who never typed an address to go and read their email.
 *
 * `flow` arrives from a query string, so it is attacker-supplied like everything else here. The
 * worst it can do is put the Google sentence on a link failure, which is a wrong sentence and not
 * a wrong outcome: no branch of this function decides anything but which words are shown.
 */
export function callbackReason(params: {
  error: string | null;
  errorCode: string | null;
  hasCode: boolean;
  exchangeFailed: boolean;
  /** "google" when this callback is the far end of signInWithOAuth rather than an emailed link. */
  flow?: string | null;
}): CallbackReason | null {
  const { error, errorCode, hasCode, exchangeFailed, flow } = params;
  const said = `${error ?? ""} ${errorCode ?? ""}`.toLowerCase();
  const viaGoogle = flow === "google";

  // GoTrue refused before we were reached. otp_expired is the common one; access_denied covers a
  // link that has already been spent — and, on the Google flow, a consent screen someone cancelled.
  if (error || errorCode) {
    if (viaGoogle) return "google";
    return /otp_expired|access_denied|invalid_request|unauthorized_client/.test(said) ? "link" : "trouble";
  }
  if (exchangeFailed) return viaGoogle ? "google" : "link";
  // No code, no error, nothing to exchange: somebody typed the callback URL, or a scanner followed
  // it and stripped the query. There is nothing to report and nothing to sign in.
  if (!hasCode) return null;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Staff password recovery
// ---------------------------------------------------------------------------------------------

/** The shortest new password the console will set. Staff hold other people's confidences. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Said after a reset request WHATEVER HAPPENED, including when the address belongs to nobody.
 *
 * The same refusal the rest of this file makes, and the one place it is most tempting to break:
 * "no account with that email" is the single most useful sentence an attacker can be given, and
 * on this screen it would confirm which addresses are staff of which firm. GoTrue already answers
 * a reset request the same way either way; this sentence is written so the UI cannot accidentally
 * be more helpful than the server.
 */
export const RESET_REQUESTED =
  "If that address belongs to a Docket staff account, a sign-in link is on its way. " +
  "It is good for one use. Check the spam folder if it is slow.";

/** The new password is not long enough, or the project's own policy refused it. */
export const PASSWORD_TOO_WEAK =
  `Choose a longer password — at least ${MIN_PASSWORD_LENGTH} characters, and not one you use anywhere else.`;

/** The two fields disagree. Said by the form, never by the server. */
export const PASSWORD_MISMATCH = "Those two passwords are not the same.";

/** The recovery link did not leave a session behind, so there is nothing to change the password of. */
export const RESET_LINK_DEAD =
  "This password link is no longer valid. Ask for a new one — a link works once, and only in the " +
  "browser that asked for it.";

/** GoTrue wants proof of life beyond the recovery session before it will take a new password. */
export const REAUTH_SENT =
  "For safety, confirm the 6-digit code we have just emailed you, then the new password will be set.";

/**
 * What went wrong setting a new password.
 *
 * `needsNonce` is the one the caller must act on rather than print. GoTrue can require a fresh
 * proof of identity before a password change even inside a recovery session — the project sets
 * security_update_password_require_reauthentication, and whether a recovery session counts as
 * "recently logged in" is a question the server answers, not one this code can decide. So the
 * caller asks for the nonce and tries again rather than telling a locked-out lawyer to give up.
 */
export function passwordProblem(failure: AuthFailureShape): { text: string; needsNonce?: boolean } {
  const code = (failure.code ?? "").trim().toLowerCase();
  const message = failure.message ?? "";
  const says = (pattern: RegExp) => pattern.test(message);

  if (code === "reauthentication_needed" || says(/requires reauthentication|reauthentication needed/i)) {
    return { text: REAUTH_SENT, needsNonce: true };
  }
  if (code === "reauthentication_not_valid" || says(/nonce.*(invalid|expired)|invalid nonce/i)) {
    return { text: "That code did not work. Check the six digits, or ask for a new link." };
  }
  // BEFORE the weak-password rule, and the regex below is narrow for the same reason: GoTrue says
  // "New password should be different from the old password", which the obvious /password should
  // be/ pattern swallows whole — telling somebody who reused their password to make it longer,
  // which they can do without ever fixing what was actually wrong.
  if (code === "same_password" || says(/different from the old password/i)) {
    return { text: "That is the password you already have. Choose a different one." };
  }
  if (code === "weak_password" || says(/password should be at least|weak password|at least \d+ characters/i)) {
    return { text: PASSWORD_TOO_WEAK };
  }
  if (code === "session_not_found" || code === "session_expired" || failure.status === 401) {
    return { text: RESET_LINK_DEAD };
  }
  if (code === "over_request_rate_limit" || failure.status === 429) {
    return { text: TOO_MANY_TRIES };
  }
  return { text: SIGN_IN_TROUBLE };
}
