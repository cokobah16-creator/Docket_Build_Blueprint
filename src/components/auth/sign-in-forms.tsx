"use client";

// Client sign-in: a six-digit code by text, or a link by email. Shared by /app/login, the
// matter-invitation landing at /app/join, and the booking wizard's inline sign-in step — three
// callers, one component, and the only screen standing between a client and everything their firm
// has told them.
//
// THE PERSON THIS IS DRAWN FOR. One hand, a cracked screen, 3G, and an SMS crawling along a
// Nigerian DND route. Every decision below costs or saves that person a tap.
//
// FIVE THINGS IT USED TO GET WRONG.
//
// It asked for "+2348012345678". Nobody in Lagos writes their number that way. They write
// 0803 123 4567, and the form sent those eleven digits straight to GoTrue, which strips a leading
// '+' and nothing else before demanding E.164 — so the screen answered a Nigerian phone number with
// "Invalid phone number format (E.164 required)". The repository already had the answer:
// normalizeNigerianPhone() in src/lib/nigeria.ts, used at six call sites on the firm's side, and
// this one screen was the only phone field that never called it. Worse than the rejection was the
// near miss. "8012345678", which is how a number is written once the leading zero has been read out
// separately, satisfies GoTrue's own rule unchanged: it was accepted, an auth user was created
// against a bare ten-digit number belonging to somebody in another country, and the code went to a
// stranger while the client sat waiting. The repair is not a stricter regex. The number is resolved
// to E.164 before it is sent, and shown back in the hint line before the person commits to it.
// Silent coercion is the danger here, not rejection.
//
// It had no resend. Once a code had been asked for, the only way out was "Use a different number",
// which threw away the number and started again — for an SMS that was merely slow. There is now a
// resend with a sixty-second countdown in its own label, which is also the only honest answer when
// a number is real but undeliverable: a code that never arrives is the entire signal a toll-free or
// misdialled line gives.
//
// It made the person press a button after typing six digits their phone had just offered to type
// for them. The code field takes digits only, six at most, and submits itself on the sixth.
//
// It printed Supabase's English. See src/lib/auth-errors.ts for why that was worse than unhelpful,
// and what is printed instead.
//
// It forgot which method was used last, on the one screen a returning client reaches most often.
// It remembers.
//
// ONE RESOLVED STRING, SENT AND VERIFIED AND RESENT. The number that goes to signInWithOtp is kept
// in state and reused verbatim for verifyOtp and for every resend. Re-resolving the raw text at
// verify time would be a coin flip; verifying against the raw text while the code went to the
// normalised number fails a hundred times out of a hundred. It also has to be the normalised form
// for a reason that has nothing to do with this screen: migration 20260910000044 matches
// auth.users.phone against the number the firm typed, digit for digit, and a client who signs in as
// "8012345678" cannot redeem their own representation invitation.
//
// THE VERIFY BUTTON IS NEVER DISABLED, AND THAT IS DELIBERATE. Auto-submit means the request is
// usually already in flight by the time a thumb — or Playwright's fill-then-click in
// tests/integration/journeys.spec.ts — reaches that button. A button disabled mid-flight is an
// unactionable element: the test blocks on it and a person taps a dead control. So it stays
// enabled, says "Verifying…", carries aria-busy, and an in-flight ref makes the second press a
// no-op rather than a second verify against a token GoTrue has already consumed. Enabled and
// idempotent beats disabled and correct here.
//
// THE CODE SUBMITS ITSELF, ONCE. Guarded by an in-flight ref, by a verified ref, and by the last
// code actually tried — so a rejected code is never retried automatically. /auth/v1/verify allows
// 360 requests an hour per IP with a burst of thirty and GoTrue applies no per-code lockout, so
// nothing on the server would stop a loop. The person edits a digit or taps resend; the form never
// spins on their behalf.
//
// WHAT IS REMEMBERED, AND WHAT IS NOT. The method — the literal word "phone" or "email" — under a
// flat docket: key, alongside docket:low-data. Not under docket:draft:, because DraftSweeper runs
// clearAllDrafts() on this very page and would wipe it on every visit to the one screen it exists
// for. The number and the address are never written to the device at all. A Nigerian client's
// handset is shared far more often than a laptop is, and "a previous user of this phone preferred
// SMS" identifies nobody, while their number identifies them exactly. That asymmetry is the rule.
//
// WHAT WAS DELIBERATELY NOT DONE. src/lib/nigeria.ts is untouched: normalizeNigerianPhone feeds two
// stored database columns and a client search needle across six other call sites, and this
// repository has no unit-test suite that would catch a regression there. The tidying that GoTrue
// and that helper disagree about — a country code kept alongside the trunk zero, a 00 international
// prefix — is done locally, below. There is also no country picker and no fixed +234 adornment: one
// free-text field, because the blueprint routes US numbers through Twilio and calls the Atlanta
// diaspora client the wedge for the whole product. A Nigeria-only input would lock her out, and it
// would break the Playwright helper besides — exactly one labelled control may match /phone/i here.
//
// NOT VERIFIED BY A BUILD. This session's npm registry access is blocked by egress policy (403 on
// every package) and there is no node_modules, so nothing here has been typechecked, linted or run
// under Playwright. The resolver below and the copy mapper beside it were exercised as pure logic
// under plain node, against the whole input table and against every real GoTrue failure shape. CI
// will be the first real check.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { normalizeNigerianPhone, isE164 } from "@/lib/nigeria";
import { isNetworkFailure } from "@/lib/drafts";
import { arm, lastDeadline, remaining, type Cooldowns } from "@/lib/cooldown";
import { stitchSignedInVisitor } from "@/lib/actions/analytics";
import { useConnectionState } from "@/components/ui/connection";
import {
  failureShape,
  signInProblem,
  unreadablePhone,
  CODE_DID_NOT_WORK,
  DEFAULT_RESEND_SECONDS,
  LINK_JUST_SENT,
  SIGN_IN_NOT_SENT,
  SIGN_IN_TROUBLE,
  SMS_JUST_SENT,
  GOOGLE_UNAVAILABLE,
} from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

type Mode = "phone" | "email";

/**
 * How a phone code travels. GoTrue takes this as options.channel on signInWithOtp; it is the same
 * Twilio call with a different sender, and it changes delivery only — verifyOtp stays type "sms"
 * for both, because the code being verified is the same code either way.
 *
 * WhatsApp matters here more than it would elsewhere: it is how much of Nigeria actually messages,
 * it crosses networks that drop SMS on the DND route, and it costs the firm nothing extra. It is
 * offered beside SMS rather than instead of it, because it needs a WhatsApp sender configured on
 * Twilio and a handset that has WhatsApp, and neither is a safe assumption for every client.
 */
type Channel = "sms" | "whatsapp";

/** scripts/configure-providers.sh sets sms_otp_length 6 and sms_otp_exp 600. Both are said out loud. */
const CODE_LENGTH = 6;
const CODE_FIELD_ID = "sign-in-code";
const EMAIL_CODE_FIELD_ID = "sign-in-email-code";

/**
 * A per-device preference, alongside docket:low-data and docket:ios-hint-dismissed. Never under
 * docket:draft: — see the header. Read after mount only.
 */
const METHOD_KEY = "docket:sign-in-method";

const PHONE_HINT =
  "A Nigerian number in any form — 0803 123 4567 — or a full international number such as +1 415 555 0123.";

// ---------------------------------------------------------------------------------------------
// Resolving what was typed
// ---------------------------------------------------------------------------------------------

/**
 * Everything a person or a paste can put between the digits of a phone number. NFKC has already
 * folded the full-width forms; \s already covers the non-breaking space WhatsApp leaves behind.
 * What is left is brackets, dots, the six dash-shaped characters a keyboard or a document can
 * produce, and the invisible direction marks that ride along with a number copied out of a chat and
 * are whitespace to nothing. Written as escapes on purpose: a character class whose whole job is to
 * remove invisible characters must not itself contain any.
 *
 * A '+' is never removed. It is the only character in the field that carries meaning.
 */
const SEPARATORS = /[\s().\u200b-\u200f\u2010-\u2015\u2066-\u2069-]/g;

/**
 * The repair GoTrue and normalizeNigerianPhone both need, done here rather than in
 * src/lib/nigeria.ts because that helper's other callers write to the database.
 *
 * Two rewrites, and only two. "00" is the international prefix half the world still dials and the
 * normaliser does not handle at all. And "+2340803…" — the country code typed while the trunk zero
 * was left in place — is the commonest way a Nigerian number is mistyped and the only one that is
 * actively dangerous: it is E.164-SHAPED, so the repository's usual two-step waves it through
 * verbatim, GoTrue accepts it, no provider can ever deliver to it, and the person waits forever on
 * a screen that said the code was sent.
 */
export function tidyTypedNumber(raw: string): string {
  const stripped = raw.normalize("NFKC").replace(SEPARATORS, "");
  return stripped.replace(/^00/, "+").replace(/^(\+?234)0(?=\d{10}$)/, "$1");
}

/**
 * The repository's standard two-step, after the tidying — verbatim from matters.ts:406 and five
 * siblings. The second half is not decoration: nigeria.ts documents isE164 as existing so diaspora
 * numbers the normaliser declines are still accepted, and it is the only reason a client in Atlanta
 * or London can sign in at all. Note that isE164 only trims, so "+44 7700 900123" fails it outright
 * — which is exactly why the tidying runs first.
 */
export function resolvePhone(raw: string): string | null {
  if (!raw.trim()) return null;
  const tidied = tidyTypedNumber(raw);
  return normalizeNigerianPhone(tidied) ?? (isE164(tidied) ? tidied : null);
}

/**
 * Grouped for reading aloud and for checking against a contacts list, which is the whole point of
 * echoing it back: a bare ten-digit number typed by a diaspora client is silently coerced to +234
 * by the shared normaliser, and this line is where she sees that Docket read her US number as
 * Nigerian and fixes it, instead of waiting for a text that went to a stranger in Lagos. Anything
 * that is not +234 is shown exactly as it will be sent, unguessed.
 */
export function prettyPhone(e164: string): string {
  const ng = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return ng ? `+234 ${ng[1]} ${ng[2]} ${ng[3]}` : e164;
}

function readMethod(): Mode | null {
  try {
    const stored = window.localStorage.getItem(METHOD_KEY);
    return stored === "phone" || stored === "email" ? stored : null;
  } catch {
    return null;
  }
}

function writeMethod(mode: Mode): void {
  try {
    window.localStorage.setItem(METHOD_KEY, mode);
  } catch {
    /* private browsing, or storage disabled: the preference is simply not kept */
  }
}

export function SignInForms({
  redirectNext,
  onSignedIn,
}: {
  /** Path the email magic link returns to. */
  redirectNext: string;
  /** Called after a phone OTP verifies (email flows return via the link). */
  onSignedIn?: () => void;
}) {
  // Memoised because a running countdown re-renders this component once a second and the original
  // called supabaseBrowser() in the render body. createBrowserClient is a singleton today, so this
  // costs nothing and stops depending on that staying true. Matches booking-wizard.tsx.
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [mode, setMode] = useState<Mode>("phone");

  // Each method keeps its own place in the flow. Tapping Email to check whether the firm has an
  // address, then tapping back, used to throw away a code that had already been sent and was
  // probably arriving. It does not any more.
  const [phoneStage, setPhoneStage] = useState<"start" | "verify">("start");
  const [emailSent, setEmailSent] = useState(false);

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  /** The email channel's own six digits. Separate from `code` for the same reason the stages are
   *  separate: tapping between tabs must not show one channel the other's half-typed number. */
  const [emailCode, setEmailCode] = useState("");

  /** The resolved E.164 a code was actually sent to. The only string verify and resend may use. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  /**
   * Which way the live code travelled. A resend has to use the same channel: somebody who asked
   * for WhatsApp because their SMS never arrives should not be quietly sent a text when they tap
   * "Resend", and the code on screen belongs to whichever message they are actually looking at.
   */
  const [sentVia, setSentVia] = useState<Channel>("sms");
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  // Four message slots, and never more than one of them filled. Alert kind="error" and the Input's
  // error prop both carry role="alert"; two live regions announcing one failure is a screen reader
  // saying everything twice.
  const [formError, setFormError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [emailCodeError, setEmailCodeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** One deadline per identifier. The shape is the fix — see src/lib/cooldown.ts. */
  const [cooldowns, setCooldowns] = useState<Cooldowns>({});
  const [now, setNow] = useState(() => Date.now());

  // Refs, not state, for the three guards that must hold across an await. A state read inside an
  // async handler is a snapshot of the render that created it, which is one tick too late to stop a
  // double tap or an auto-submit racing a click.
  const inFlight = useRef(false);
  const verified = useRef(false);
  const lastTried = useRef<string | null>(null);
  const lastTriedEmail = useRef<string | null>(null);

  const { online, known: onlineKnown } = useConnectionState();

  // Rendered on the server first, so the stored method cannot be read in a useState initialiser
  // without throwing or hydrating to a different tab than the HTML painted. pwa-hints.tsx does the
  // same thing. Both tabs paint on the first frame either way, which is what smoke.spec.ts asserts.
  useEffect(() => {
    const remembered = readMethod();
    if (remembered) setMode(remembered);
  }, []);

  // Derived from a deadline, never decremented inside the interval — a tick that is late or
  // coalesced must not make the countdown wrong. One interval serves every live cooldown, because
  // they all need the same thing from it: a fresh `now` once a second.
  //
  // The dependency is the LAST deadline in the map, so the timer is torn down and rebuilt only
  // when the far edge moves. Arming a second, earlier cooldown while one is already running does
  // not disturb the interval already ticking for it; arming a later one extends the run. When that
  // last deadline passes, every entry is expired by definition, so the map is emptied in one go —
  // which drops the dependency to zero and tears the interval down with it. No timer outlives the
  // thing it was counting, and an entry that expires early simply reads as zero until then.
  const furthest = lastDeadline(cooldowns);
  useEffect(() => {
    if (!furthest) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const done = setTimeout(() => setCooldowns({}), Math.max(0, furthest - Date.now()) + 250);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [furthest]);

  // One tap saved, every time. Keyed on the stage alone, deliberately: a resend leaves the stage
  // where it is, so this can never steal focus from someone mid-typing.
  useEffect(() => {
    if (phoneStage !== "verify") return;
    const field = document.getElementById(CODE_FIELD_ID);
    if (field instanceof HTMLInputElement) field.focus();
  }, [phoneStage]);

  if (!supabase) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, so sign-in is not available yet.
      </Alert>
    );
  }

  // Narrowed once, here, so every handler below closes over a client TypeScript knows is non-null
  // rather than repeating a non-null assertion at each call.
  const client = supabase;

  function clearMessages() {
    setFormError(null);
    setPhoneError(null);
    setCodeError(null);
    setEmailCodeError(null);
    setNotice(null);
  }

  function secondsLeft(target: string | null): number {
    return remaining(cooldowns, target, now);
  }

  /**
   * Functional update, not a spread of the value this render closed over: two sends can be answered
   * within one render — a code and a link, or a failure that arms a server-dictated wait on top of
   * the default one already set — and the second must not be written on top of a stale copy of the
   * map, which is how the single slot lost countdowns in the first place.
   */
  function armCooldown(target: string, seconds: number) {
    const until = Date.now() + seconds * 1000;
    setNow(Date.now());
    // Functional update, not a spread of the map this render closed over: two sends can be
    // answered within one render, and the second must not be written on top of a stale copy —
    // which is a smaller version of exactly how the single slot lost countdowns.
    setCooldowns((previous) => arm(previous, target, until));
  }

  function switchMode(next: Mode) {
    setMode(next);
    writeMethod(next);
    clearMessages();
  }

  // -------------------------------------------------------------------------------------------
  // Phone
  // -------------------------------------------------------------------------------------------

  /**
   * `again` only changes what is said afterwards. The call is identical, and it is signInWithOtp
   * and not supabase.auth.resend() — resend's sms type is the signup confirmation, not a
   * passwordless sign-in code, and would quietly do nothing.
   *
   * A send always ends on the code screen, whether the number belongs to one of the firm's clients
   * or to nobody at all: that is the whole of the enumeration defence on this step, and it is why
   * options.shouldCreateUser is left alone. supabase-js defaults it to true; passing false turns
   * this endpoint into an unauthenticated oracle answering 200 for a number that belongs to one of
   * the firm's clients and 422 for one that does not. The cost of the default is that a stranger's
   * number gets an auth user with no rows behind RLS and one unsolicited SMS, bounded by the
   * per-number cooldown and the project's thirty sends an hour. That is the cheaper side.
   */
  async function sendCode(target: string, again: boolean, channel: Channel = "sms") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    clearMessages();
    try {
      // options.channel only where it is not the default: an older GoTrue that does not know the
      // field would reject a request carrying it, and every SMS send would break to buy nothing.
      const { error: err } = await client.auth.signInWithOtp(
        channel === "whatsapp" ? { phone: target, options: { channel: "whatsapp" } } : { phone: target },
      );
      if (err) {
        const problem = signInProblem(channel === "whatsapp" ? "send_whatsapp" : "send_sms", failureShape(err));
        if (problem.cooldownSeconds) {
          // A code is already in flight — from another tab, another device, or a first tap this one
          // did not see. It has ten minutes to live, so moving forward is the truthful thing to do,
          // and the countdown says when another can be asked for. A red banner holding the person
          // on the start screen would be a lie about what happened.
          setSentTo(target);
          setSentVia(channel);
          setPhoneStage("verify");
          setNotice(problem.text);
          armCooldown(target, problem.cooldownSeconds);
          return;
        }
        if (problem.switchTo) {
          // Phone sign-in is off at the project level, and the browser cannot read auth config, so
          // this can only be discovered by trying. Having discovered it, nothing is gained by
          // leaving the person on a tab that cannot work — and the switch is remembered so a second
          // visit does not walk down the same dead path. Both tabs stay clickable.
          switchMode(problem.switchTo);
          setFormError(problem.text);
          return;
        }
        setFormError(problem.text);
        return;
      }
      setSentTo(target);
      setSentVia(channel);
      setPhoneStage("verify");
      setCode("");
      lastTried.current = null;
      armCooldown(target, DEFAULT_RESEND_SECONDS);
      if (again) setNotice("A new code is on the way. The newest one is the only one that works.");
    } catch (caught) {
      // auth-js throws rather than returning { error } when the failure does not look like an HTTP
      // response, and the original had no try/catch at all: the throw escaped past setBusy(false)
      // into the error boundary, taking the whole page with it.
      setFormError(isNetworkFailure(caught) ? SIGN_IN_NOT_SENT : SIGN_IN_TROUBLE);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /**
   * Split from the submit handler because two different controls start a send and they hand over
   * two different events — the form gives a FormEvent, the WhatsApp button a MouseEvent, and
   * neither is assignable to the other. The work takes a channel and no event at all.
   */
  function beginPhone(channel: Channel) {
    const resolved = resolvePhone(phone);
    if (!resolved) {
      // Blocked here rather than at GoTrue. A round trip to be told the same thing costs a wait on
      // 3G and one of the project's thirty sends an hour, and the server's version of this sentence
      // is not fit for a client to read.
      clearMessages();
      setPhoneError(unreadablePhone(phone));
      return;
    }
    // The cooldown belongs to the number, and "Change the number" does not clear it, so coming back
    // to the same line cannot be used to walk around it. GoTrue would answer 429 anyway; not asking
    // saves the round trip and the send.
    if (secondsLeft(resolved) > 0) {
      clearMessages();
      setSentTo(resolved);
      setPhoneStage("verify");
      setNotice(SMS_JUST_SENT);
      return;
    }
    void sendCode(resolved, false, channel);
  }

  function startPhone(e: FormEvent) {
    e.preventDefault();
    beginPhone("sms");
  }

  /**
   * The one success path, shared by both codes.
   *
   * Reached whenever a session is established IN THIS BROWSER — the phone code, and now the code
   * from the email. Not the magic link: that one lands on /auth/callback, which has a whole
   * server-side route to itself and never renders this component.
   *
   * /app/login uses onSignedIn to reach the ?next= destination and /app/join to re-run its server
   * page; the booking wizard passes nothing, which is why this component never navigates, reloads
   * or clears storage on its own — the wizard's held slot and its ?resume=1 state depend on it
   * staying still, and it learns about the session from supabase.auth.onAuthStateChange instead.
   *
   * The caller's own try/catch, because a caller throwing on the way out must not be reported as a
   * sign-in that failed: the session is real and written to the cookie by this point, and "the
   * connection dropped" over a working session is the most misleading sentence this screen could
   * produce. The success panel's Continue button is the way out if a caller's navigation never
   * happens.
   */
  function completeSignIn() {
    verified.current = true;
    setSignedIn(true);

    // BEFORE the caller navigates, and never awaited. The session exists only in this browser
    // until something tells the server, and the two things the join needs — the httpOnly visitor
    // cookie and POSTHOG_KEY — are both server-side, so a browser-side sign-in cannot make it
    // alone. Without this, site_viewed and booking_started stay attached to the anonymous cookie
    // while everything after sign-in belongs to the account, and the funnel Docket reads splits
    // into two people who each did half of it.
    //
    // Fired first so the request is on its way before onSignedIn() starts a transition, and not
    // awaited so a slow round trip cannot hold up a screen that has already said "Signed in".
    // Every caller navigates client-side (router.replace/refresh) or not at all, so the document
    // is never torn down and the request completes either way.
    void stitchSignedInVisitor().catch(() => undefined);

    try {
      onSignedIn?.();
    } catch {
      /* the session stands whatever the caller did with it */
    }
  }

  /**
   * The token is passed in rather than read back from state, which has not been set yet at the
   * point in the event where the sixth digit arrives — the stale-closure bug this would otherwise
   * have. Verification goes through the shared browser client, always: the booking wizard is passed
   * no onSignedIn and learns about the session only from supabase.auth.onAuthStateChange, so a
   * server action or a direct fetch to GoTrue would leave it stuck on "Sign in to confirm" with
   * nothing shown and nothing to say.
   */
  async function submitCode(token: string) {
    const digits = token.replace(/\D/g, "").slice(0, CODE_LENGTH);
    const target = sentTo;
    if (!target || inFlight.current || verified.current) return;
    if (digits.length !== CODE_LENGTH) {
      // The button is never disabled, and a single-field form still submits on Enter. Say why
      // rather than doing nothing.
      clearMessages();
      setCodeError(`Enter the ${CODE_LENGTH} digits from the text message.`);
      return;
    }
    inFlight.current = true;
    lastTried.current = digits;
    setBusy(true);
    clearMessages();
    try {
      const { error: err } = await client.auth.verifyOtp({ phone: target, token: digits, type: "sms" });
      if (err) {
        const problem = signInProblem("verify_sms", failureShape(err));
        setCodeError(problem.text || CODE_DID_NOT_WORK);
        return;
      }
      completeSignIn();
    } catch (caught) {
      setFormError(isNetworkFailure(caught) ? SIGN_IN_NOT_SENT : SIGN_IN_TROUBLE);
    } finally {
      // Always, even when the caller is already navigating away: React treats a setState on an
      // unmounted component as a no-op, and leaving `busy` stuck true would freeze the form for the
      // one caller that does not navigate.
      inFlight.current = false;
      setBusy(false);
    }
  }

  /**
   * Digits only, six at most, and the sixth one submits. A code that has already been tried does not
   * re-fire: after a rejection the person edits a digit or taps resend, and the form does not sit
   * there hammering an endpoint that has no per-code lockout of its own.
   */
  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (codeError) setCodeError(null);
    if (
      digits.length === CODE_LENGTH &&
      !inFlight.current &&
      !verified.current &&
      lastTried.current !== digits
    ) {
      void submitCode(digits);
    }
  }

  function changeNumber() {
    setPhoneStage("start");
    setCode("");
    setSentTo(null);
    lastTried.current = null;
    clearMessages();
    // The cooldown deliberately survives: it belongs to the number, not to the stage. The number
    // itself is kept in the field. Nine times in ten the reason for coming back here is one wrong
    // digit, and retyping eleven of them to fix one is a tax.
  }

  // -------------------------------------------------------------------------------------------
  // Email
  // -------------------------------------------------------------------------------------------

  async function sendLink(address: string, again: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    clearMessages();
    try {
      const { error: err } = await client.auth.signInWithOtp({
        email: address,
        options: {
          // scripts/configure-providers.sh allow-lists exactly ${APP_URL}/auth/callback, and
          // app/auth/callback/route.ts reads ?next= back through safeNext() and stitches the
          // PostHog anonymous id to the user there. The shape is not negotiable.
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectNext)}`,
        },
      });
      if (err) {
        const problem = signInProblem("send_email", failureShape(err));
        if (problem.cooldownSeconds) {
          setSentToEmail(address);
          setEmailSent(true);
          setNotice(problem.text);
          armCooldown(address, problem.cooldownSeconds);
          return;
        }
        if (problem.switchTo) {
          switchMode(problem.switchTo);
          setFormError(problem.text);
          return;
        }
        setFormError(problem.text);
        return;
      }
      setSentToEmail(address);
      setEmailSent(true);
      setEmailCode("");
      lastTriedEmail.current = null;
      armCooldown(address, DEFAULT_RESEND_SECONDS);
      if (again) setNotice("A new link and code are on the way. The newest ones are the only ones that work.");
    } catch (caught) {
      setFormError(isNetworkFailure(caught) ? SIGN_IN_NOT_SENT : SIGN_IN_TROUBLE);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /**
   * The email's OTHER half.
   *
   * The same email carries a link and a code, and this is the code. It exists because the link
   * cannot always work: it carries a PKCE code whose verifier was written to the browser that
   * ASKED for it, so opening it in Gmail's in-app browser, or on a laptop when the phone asked,
   * fails on a link that is otherwise perfectly good. That was the single largest silent failure
   * on this screen, and the honest old copy — "Open it on this device to continue" — described the
   * limitation rather than removing it. verifyOtp with type "email" has no verifier to lose and
   * works from any browser, on any device, so a client who cannot use the link types six digits
   * instead.
   *
   * type: "email" and not "magiclink". They are not interchangeable and the names invite the wrong
   * guess: "email" is the type for the numeric code, "magiclink" for the token_hash carried by the
   * link itself. Verifying six typed digits as "magiclink" answers "Email link is invalid or has
   * expired" on a code that is perfectly good — and magiclink is deprecated for email sign-in
   * besides, where the live set is email, recovery, invite and email_change.
   */
  async function submitEmailCode(token: string) {
    const digits = token.replace(/\D/g, "").slice(0, CODE_LENGTH);
    const target = sentToEmail;
    if (!target || inFlight.current || verified.current) return;
    if (digits.length !== CODE_LENGTH) {
      clearMessages();
      setEmailCodeError(`Enter the ${CODE_LENGTH} digits from the email.`);
      return;
    }
    inFlight.current = true;
    lastTriedEmail.current = digits;
    setBusy(true);
    clearMessages();
    try {
      const { error: err } = await client.auth.verifyOtp({ email: target, token: digits, type: "email" });
      if (err) {
        const problem = signInProblem("verify_email", failureShape(err));
        setEmailCodeError(problem.text || CODE_DID_NOT_WORK);
        return;
      }
      completeSignIn();
    } catch (caught) {
      setFormError(isNetworkFailure(caught) ? SIGN_IN_NOT_SENT : SIGN_IN_TROUBLE);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /** Digits only, six at most, and the sixth one submits — onCodeChange's rule, for the other channel. */
  function onEmailCodeChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setEmailCode(digits);
    if (emailCodeError) setEmailCodeError(null);
    if (
      digits.length === CODE_LENGTH &&
      !inFlight.current &&
      !verified.current &&
      lastTriedEmail.current !== digits
    ) {
      void submitEmailCode(digits);
    }
  }

  /**
   * Google, which is the one way in that needs no message delivered at all.
   *
   * Every other route depends on a provider handing a code to a person: an SMS through Twilio, an
   * email through whatever SMTP the project has. Both of those have failed in this project's own
   * auth log — a Twilio caller ID that was an Account SID, and the built-in mail service refusing
   * every address outside the Supabase organisation. Google asks nothing of either.
   *
   * NO NEW SERVER CODE. signInWithOAuth uses PKCE, so Google returns the browser to
   * /auth/callback?code=..., which already exchanges the code, already reports a failed exchange
   * in words, and already stitches the anonymous visitor to the account. redirectTo carries the
   * same ?next= every other route carries, so a Google sign-in lands on the invoice the person
   * was sent to, exactly like the rest.
   *
   * It signs in whoever holds the Google account, which is not by itself an entitlement to
   * anything: RLS decides what they can see, and an address the firm never invited opens an
   * account with no matters behind it — the same bargain the phone and email routes already make.
   */
  async function startGoogle() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    clearMessages();
    try {
      const { error: err } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          // flow=google IS NOT DECORATION. This is the same callback the emailed magic link comes
          // home to, and a cancelled Google consent screen arrives there carrying access_denied —
          // the same error_code a magic link that has already been spent carries. Nothing else in
          // the parameters separates them, so without this marker somebody who tapped the button
          // and then changed their mind was told a sign-in link had expired and invited to type a
          // code from an email that was never sent. Supabase stores this whole URL against the
          // OAuth state and returns the browser to it, error parameters appended, so the marker
          // survives the round trip through Google. If the state is lost, Supabase falls back to
          // SITE_URL, the marker goes with it, and the copy degrades to the generic sentence.
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectNext)}&flow=google`,
        },
      });
      // Only reached when the handshake never started; on success the browser has already left.
      if (err) setFormError(signInProblem("start_google", failureShape(err)).text || GOOGLE_UNAVAILABLE);
    } catch (caught) {
      setFormError(isNetworkFailure(caught) ? SIGN_IN_NOT_SENT : GOOGLE_UNAVAILABLE);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /** The Google button, shown on both start screens and on neither verify screen — see below. */
  const googleButton = (
    <>
      <div className="flex items-center gap-3 pt-1" aria-hidden="true">
        <span className="h-px flex-1 bg-gray-200" />
        <span className="text-[11.5px] text-gray-500">or</span>
        <span className="h-px flex-1 bg-gray-200" />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="lg"
        className="w-full border border-gray-300"
        disabled={busy}
        onClick={() => void startGoogle()}
      >
        Continue with Google
      </Button>
    </>
  );

  function startEmail(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    if (secondsLeft(address) > 0) {
      clearMessages();
      setSentToEmail(address);
      setEmailSent(true);
      setNotice(LINK_JUST_SENT);
      return;
    }
    void sendLink(address, false);
  }

  // -------------------------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------------------------

  const typedResolved = resolvePhone(phone);
  const phoneWait = secondsLeft(sentTo);
  const emailWait = secondsLeft(sentToEmail);
  const offline = onlineKnown && !online;

  // navigator.onLine is the browser's word and it lies on a captive portal, so this is said beside
  // the button and never used to disable it. Not OfflineNote from connection.tsx: that one promises
  // what you typed is kept on this device, and this form keeps nothing.
  const offlineNote = offline ? (
    <p className="text-xs text-amber-900">
      You are offline. The request cannot leave this device until it is back on the network.
    </p>
  ) : null;

  return (
    <div className="space-y-4">
      {/* role="tab" and these two names exactly: smoke.spec.ts asserts both on first paint and
          journeys.spec.ts clicks "Phone". The role also keeps them out of getByRole("button"),
          which is what lets the specs take .first() of the real buttons below. Both tabs stay
          mounted and clickable whatever is remembered and whatever the server has switched off. */}
      <div className="flex gap-2" role="tablist" aria-label="Sign-in method">
        <Button
          role="tab"
          aria-selected={mode === "phone"}
          variant={mode === "phone" ? "primary" : "ghost"}
          size="sm"
          onClick={() => switchMode("phone")}
        >
          Phone
        </Button>
        <Button
          role="tab"
          aria-selected={mode === "email"}
          variant={mode === "email" ? "primary" : "ghost"}
          size="sm"
          onClick={() => switchMode("email")}
        >
          Email
        </Button>
      </div>

      {/* One of the two, never both, and never alongside a field-level error. `notice` is the sand
          ground rather than amber: a code already on its way is true, not wrong. */}
      {formError ? (
        <Alert kind="error">{formError}</Alert>
      ) : notice ? (
        <Alert kind="notice">{notice}</Alert>
      ) : null}

      {/* Gated on the session, not on the tab: once a code has verified there is nothing left to
          choose, and tabbing away from a success panel to an empty email form would be a screen
          implying the sign-in had come undone. The booking wizard passes no onSignedIn and used to
          be shown absolutely nothing here. */}
      {signedIn && (
        <div className="space-y-3">
          <Alert kind="success" title="Signed in">
            Taking you back to what you were doing.
          </Alert>
          {/* A fallback, not decoration: if a caller's redirect is slow on 3G there is something to
              tap rather than a screen that appears to have stopped. */}
          <Button size="lg" className="w-full" onClick={() => onSignedIn?.()}>
            Continue
          </Button>
        </div>
      )}

      {mode === "phone" && !signedIn && phoneStage === "start" && (
        <form onSubmit={startPhone} className="space-y-4">
          {/* One free-text field, one label matching /phone/i: journeys.spec.ts:111 calls
              getByLabel(/phone/i) with no .first(), and a second labelled control would fail strict
              mode. inputMode="tel" and not "numeric" — the tel keypad is the one with the '+' key,
              and losing it would undo the reason isE164 is consulted at all. maxLength bounds the
              echo in the rejection sentence; no real number comes close to it. */}
          <Input
            label="Phone number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="send"
            maxLength={32}
            placeholder="0803 123 4567"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (phoneError) setPhoneError(null);
            }}
            error={phoneError ?? undefined}
            hint={typedResolved ? `The code goes to ${prettyPhone(typedResolved)}.` : PHONE_HINT}
            required
          />
          {/* First button in the form, and its name matches /send|continue|code/i —
              journeys.spec.ts:112 takes .first(). Nothing may be inserted above it. */}
          <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
            {busy ? "Sending code…" : "Send code"}
          </Button>
          {/* BELOW the send button, and it has to stay below it. Its name matches /send/i too, and
              journeys.spec.ts:112 and :311 both take .first() on /send|continue|code/i and /send/i —
              so putting WhatsApp first would hand the spec the wrong control and silently test the
              wrong channel. Same reason the Google button is last: "Continue with Google" matches
              /continue/i. A type="button" so it does not submit the form it sits in. */}
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="w-full border border-gray-300"
            disabled={busy}
            onClick={() => beginPhone("whatsapp")}
          >
            Send it on WhatsApp instead
          </Button>
          {googleButton}
          {offlineNote}
        </form>
      )}

      {mode === "phone" && !signedIn && phoneStage === "verify" && sentTo && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode(code);
          }}
          className="space-y-4"
        >
          {/* The label carries the number so a wrong country or a wrong digit is caught here rather
              than after four minutes of waiting. It matches /code/i and not /phone/i, which is what
              journeys.spec.ts:115 needs. autoComplete="one-time-code" is what makes iOS and Android
              offer the code straight from the notification — the single biggest tap saving on this
              screen — and inputMode="numeric" is the keypad for six digits. Neither moves.
              The size stays at the Input's own 16px: cn() is a plain join, not tailwind-merge, so a
              competing font-size class would win or lose by stylesheet order, and anything under
              16px makes iOS Safari zoom the page. Centring, monospace and letter-spacing do the
              legibility work instead, and the indent cancels the trailing letter-space.
              NO maxLength, deliberately. onCodeChange already clamps to six digits, so the
              attribute adds no limit — but the browser applies it to a PASTE before React sees the
              text, truncating the string and then handing the stripper something already cut short.
              A client who long-presses the SMS and drags a selection that catches the space before
              the code pastes " 123456", which maxLength turns into " 12345" and the stripper into
              five digits: no sixth digit, so no auto-submit, and a screen that says nothing about
              why. That exact paste signed people in before this change — the old field had no
              maxLength and trimmed on submit — so the attribute would be a regression, not a
              safeguard. The clamp belongs in onCodeChange, where it can see the whole string. */}
          <Input
            id={CODE_FIELD_ID}
            label={`Code sent ${sentVia === "whatsapp" ? "on WhatsApp" : "by text"} to ${prettyPhone(sentTo)}`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            enterKeyHint="go"
            placeholder="123456"
            className="text-center font-mono tracking-[0.3em] indent-[0.3em]"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            error={codeError ?? undefined}
            hint={`${CODE_LENGTH} digits. It stops working ten minutes after it was sent, and asking for a new one replaces it.`}
            required
          />
          {/* Never disabled — see the header. Auto-submit means the request is normally already in
              flight when this is tapped or clicked, and a disabled control at that moment is one
              nothing can act on. The in-flight ref makes the extra press a no-op. */}
          <Button
            type="submit"
            size="lg"
            className={busy ? "w-full opacity-70" : "w-full"}
            aria-busy={busy}
          >
            {busy ? "Verifying…" : "Verify and continue"}
          </Button>
          {/* A button, never an Input with a label — a second control labelled "…code" on this stage
              would break getByLabel(/code/i) in strict mode. Its name matches neither
              /verify|sign in|continue/i nor the start stage's /send|continue|code/i, so .first()
              still finds the submit above it. The countdown lives in this label and nowhere else:
              inside an Alert or a field error it would sit in a live region and be re-announced
              every second. */}
          <Button
            variant="ghost"
            size="md"
            className="w-full"
            disabled={busy || phoneWait > 0}
            onClick={() => {
              if (sentTo) void sendCode(sentTo, true, sentVia);
            }}
          >
            {phoneWait > 0
              ? `Resend code in ${phoneWait}s`
              : sentVia === "whatsapp"
                ? "Resend on WhatsApp"
                : "Resend code"}
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={changeNumber}>
            Change the number
          </Button>
          {offlineNote}
        </form>
      )}

      {mode === "email" && !signedIn && !emailSent && (
        <form onSubmit={startEmail} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            inputMode="email"
            autoComplete="email"
            enterKeyHint="send"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="The address your firm has for you."
            required
          />
          <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
            {busy ? "Sending link…" : "Email me a sign-in link"}
          </Button>
          {googleButton}
          {offlineNote}
        </form>
      )}

      {mode === "email" && !signedIn && emailSent && sentToEmail && (
        <form onSubmit={(e) => { e.preventDefault(); void submitEmailCode(emailCode); }} className="space-y-3">
          {/* It no longer says "open it on this device". That sentence was true and that was the
              problem: the link carries a PKCE code whose verifier lives in the browser that asked
              for it, so the commonest way an email is read — tapping the link inside Gmail, or
              opening it on the laptop when the phone asked — failed on a good link with nothing
              said. The code below has no verifier to lose and works from anywhere, so the panel
              offers both and names the link first, because tapping it is still one action. */}
          <Alert kind="success" title="Check your email">
            We sent a sign-in link and a {CODE_LENGTH}-digit code to {sentToEmail}. Tap the link, or type
            the code here if you are reading the email somewhere else.
          </Alert>
          <Input
            id={EMAIL_CODE_FIELD_ID}
            label="Code from the email"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            enterKeyHint="go"
            placeholder="123456"
            className="text-center font-mono tracking-[0.3em] indent-[0.3em]"
            value={emailCode}
            onChange={(e) => onEmailCodeChange(e.target.value)}
            error={emailCodeError ?? undefined}
            hint={`${CODE_LENGTH} digits, from the same email as the link.`}
          />
          {/* Never disabled, for the reason the phone one is not: auto-submit means the request is
              normally already in flight when this is tapped, and the in-flight ref makes the extra
              press a no-op. Its name matches neither resend button below it. */}
          <Button
            type="submit"
            size="lg"
            className={busy ? "w-full opacity-70" : "w-full"}
            aria-busy={busy}
          >
            {busy ? "Verifying…" : "Verify and continue"}
          </Button>
          {/* The email path had no way back at all: a link sent to an address with a typo in it was
              unrecoverable without switching tabs twice. The frequency limit is per address and the
              same shape as the SMS one, so it gets the same countdown. One send produces both the
              link and the code, so this asks for both and the label says so. */}
          <Button
            variant="ghost"
            size="md"
            className="w-full"
            disabled={busy || emailWait > 0}
            onClick={() => {
              if (sentToEmail) void sendLink(sentToEmail, true);
            }}
          >
            {emailWait > 0 ? `Send them again in ${emailWait}s` : "Send them again"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setEmailSent(false);
              setSentToEmail(null);
              setEmailCode("");
              lastTriedEmail.current = null;
              clearMessages();
            }}
          >
            Change the address
          </Button>
          {offlineNote}
        </form>
      )}
    </div>
  );
}
