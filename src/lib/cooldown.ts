// How long until this identifier may be asked for another code.
//
// WHY A MODULE AND NOT FOUR LINES IN THE FORM. It was four lines in the form, and they were wrong
// in a way four separate reviewers each found independently: the wait was kept in a single
// { until, target } slot, so arming it for one identifier silently erased the other's. Send a code
// to a number, tap Email and send a link, tap back — and the number's countdown had been
// overwritten by the address's. The resend button offered itself again while GoTrue's per-number
// limit was still running, which is the one case the countdown exists to prevent.
//
// It is a map now, and the shape is the fix: a key cannot be overwritten by a different key. Both
// sign-in surfaces use this rather than keeping a copy each, because the copy in
// app/firm/(auth)/forgot/forgot-form.tsx was the same logic written a second time, and a second
// copy of a thing that has just had a bug taken out of it is where the bug comes back.
//
// THE WAIT BELONGS TO THE IDENTIFIER, NOT THE BROWSER, and that is deliberate rather than
// incidental. "Change the number" and "Change the address" do not clear these entries, so coming
// back to the same line cannot be used to walk around a limit the server is enforcing anyway. The
// client-side countdown never decides anything — GoTrue answers 429 whatever this says — it only
// saves a doomed round trip on a 3G connection and one of the project's thirty sends an hour.
//
// No imports, no React: it is a plain reduction over { identifier -> deadline }, so it can be run
// under plain node, which is the only executable check this repository has in a session with no
// node_modules.

/** Deadlines by identifier — an E.164 phone number or an email address — in epoch milliseconds. */
export type Cooldowns = Record<string, number>;

/**
 * The deadline held for `target`, or 0 — and 0 for anything that is not a real deadline.
 *
 * The guard is not decoration. `cooldowns[target]` on an object literal also reaches
 * Object.prototype, so an identifier named "constructor", "toString", "valueOf" or "__proto__"
 * yields a function rather than undefined; `?? 0` does not catch it, and the arithmetic downstream
 * turns it into NaN. NaN is the worst possible value here because it FAILS OPEN — `NaN > 0` is
 * false, so a wait would read as "not waiting" — and one NaN written into the map makes
 * lastDeadline() NaN, whose falsiness would switch the interval off for every cooldown at once.
 *
 * Nothing in Docket can reach that today: phone keys are resolvePhone() output and always begin
 * with "+", and both email fields are type="email" inside a validating form, so none of the twelve
 * prototype names can be submitted. That is an argument about the callers, though, and this module
 * exists to be reused by callers that do not exist yet. Closing it costs one comparison.
 */
function deadlineOf(cooldowns: Cooldowns, target: string | null | undefined): number {
  if (!target) return 0;
  const until = Object.prototype.hasOwnProperty.call(cooldowns, target) ? cooldowns[target] : 0;
  return typeof until === "number" && Number.isFinite(until) ? until : 0;
}

/**
 * Whole seconds until `target` may be asked again, or 0.
 *
 * Rounded up, so the last fractional second still reads as "1s" rather than as an enabled button
 * that answers 429. An entry whose deadline has passed reads as 0 without needing to be removed
 * first, which is what lets the map be cleared in one go rather than pruned entry by entry.
 */
export function remaining(cooldowns: Cooldowns, target: string | null | undefined, now: number): number {
  const until = deadlineOf(cooldowns, target);
  if (!until) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * The map with `target` held until `until`.
 *
 * Never shortens an existing wait. Two sends can be answered inside one render — a code and a
 * link, or a server-dictated wait arriving on top of the default one already set — and the later
 * answer is not automatically the longer one. Taking the maximum means a 54-second wait GoTrue
 * asked for is not quietly replaced by a 60-second default that has already started counting, nor
 * the other way about.
 */
export function arm(cooldowns: Cooldowns, target: string, until: number): Cooldowns {
  return { ...cooldowns, [target]: Math.max(deadlineOf(cooldowns, target), until) };
}

/**
 * The furthest deadline in the map, or 0 when nothing is waiting.
 *
 * This is what a timer should depend on. One interval serves every live cooldown — they all want
 * the same thing from it, a fresh `now` once a second — and keying it here means the timer is torn
 * down and rebuilt only when the far edge moves: arming an earlier cooldown alongside a running
 * one does not disturb it, and arming a later one extends the run. When this deadline passes every
 * entry is expired by definition, so the whole map can be dropped at once, which returns this to 0
 * and takes the interval with it. No timer outlives the thing it was counting.
 */
export function lastDeadline(cooldowns: Cooldowns): number {
  return Object.values(cooldowns).reduce((furthest, at) => Math.max(furthest, at), 0);
}
