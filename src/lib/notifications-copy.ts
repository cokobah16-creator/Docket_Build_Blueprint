// The words of an in-app notification row: what the portal's Notifications list and the home
// screen's recent activity show for each event, and what the console's notification settings show
// as "Docket says" (settings-forms.tsx).
//
// CLIENT ROWS are sentences (docs/VOICE.md): the firm by name, the consultation they are about,
// and every time with its zone ("Wednesday 4 November 2026 at 10:00 WAT"). No "·" fragments, and
// no codes. The settings preview calls this with an empty payload, so each sentence must still
// read when there is no time, amount or title to put in it.
//
// STAFF ROWS (a lawyer's events, whose links go under /firm/) keep the console's shorter register
// and are worded as they were.
//
// NOT THE DISPATCHER. Email, SMS and push are worded in
// supabase/functions/dispatch-notifications/index.ts, and those sentences differ from these:
// changing one does not change the other.
//
// No server-only imports: notifications-list.tsx is a client component.

import { zoneLabel } from "@/lib/client-words";
import { formatMoneyMinor } from "@/lib/money";

export interface NotificationCopy { title: string; body: string; url: string }

const LAGOS = "Africa/Lagos";

/** The zone to format in: the one given when the runtime knows it, otherwise Lagos. */
function usableZone(tz: string | null | undefined): string {
  if (!tz) return LAGOS;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return LAGOS;
  }
}

function toDate(at: Date | string | null | undefined): Date | null {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parts(d: Date, tz: string, opts: Intl.DateTimeFormatOptions) {
  const list = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz }).formatToParts(d);
  return (type: Intl.DateTimeFormatPartTypes) => list.find((p) => p.type === type)?.value ?? "";
}

/**
 * "Wednesday 4 November 2026" (docs/VOICE.md, rule 11). Put together from its parts because the
 * runtime's own en-GB long style puts a comma after the weekday in some versions of its locale data.
 * An empty string when there is no date to give.
 */
export function dayWords(at: Date | string | null | undefined, tz: string | null | undefined): string {
  const d = toDate(at);
  if (!d) return "";
  const part = parts(d, usableZone(tz), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`;
}

/** "10:00 WAT": the 24-hour clock, always with its zone, never the zone's IANA name. */
export function timeWords(at: Date | string | null | undefined, tz: string | null | undefined): string {
  const d = toDate(at);
  if (!d) return "";
  const zone = usableZone(tz);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(d);
  return `${time} ${zoneLabel(zone)}`;
}

/** "Wednesday 4 November 2026 at 10:00 WAT". */
export function whenWords(at: Date | string | null | undefined, tz: string | null | undefined): string {
  const day = dayWords(at, tz);
  return day ? `${day} at ${timeWords(at, tz)}` : "";
}

/**
 * "Mon 2 Nov, 10:00 WAT", for a list's small print where the long form does not fit. The year
 * is added when it is not this year, so an old message is never read as a recent one.
 */
export function shortWhenWords(at: Date | string | null | undefined, tz: string | null | undefined): string {
  const day = shortDayWords(at, tz);
  return day ? `${day}, ${timeWords(at, tz)}` : "";
}

/** "Mon 2 Nov", for a list's small print where only the day matters. The year as above. */
export function shortDayWords(at: Date | string | null | undefined, tz: string | null | undefined): string {
  const d = toDate(at);
  if (!d) return "";
  const zone = usableZone(tz);
  const part = parts(d, zone, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const thisYear = parts(new Date(), zone, { year: "numeric" })("year");
  return `${part("weekday")} ${part("day")} ${part("month")}${part("year") === thisYear ? "" : ` ${part("year")}`}`;
}

/**
 * "Friday 6 November 2026" for a calendar day ("2026-11-06"). A date column is a day, not an
 * instant, so it is read in UTC and never moved by the viewer's zone (src/lib/days.ts). A full
 * timestamp is read in `tz` instead.
 */
export function calendarDayWords(day: string | null | undefined, tz?: string | null): string {
  if (!day) return "";
  const ymd = /^(\d{4}-\d{2}-\d{2})(T00:00(:00(\.0+)?)?(Z|[+-]00:?00)?)?$/.exec(day);
  return ymd ? dayWords(`${ymd[1]}T00:00:00Z`, "UTC") : dayWords(day, tz ?? LAGOS);
}

/** A payload text, trimmed and without a closing full stop, so a sentence can end it. */
function words(v: unknown): string {
  return typeof v === "string" ? v.trim().replace(/[\s.;:,]+$/, "") : "";
}

/** "hearing" from "Hearing", so a listing reads inside a sentence. "EFCC arraignment" stays. */
function phrase(v: string): string {
  return /^[A-Z][a-z]/.test(v) ? v.charAt(0).toLowerCase() + v.slice(1) : v;
}

/** "₦50,000", or an empty string when the payload has no usable amount (never "₦0"). */
function amountOf(p: Record<string, unknown>): string {
  const minor = Number(p.amount_minor);
  const currency = typeof p.currency === "string" ? p.currency.trim().toUpperCase() : "";
  if (!currency || !Number.isFinite(minor) || minor <= 0) return "";
  try {
    return formatMoneyMinor(minor, currency);
  } catch {
    return ""; // a currency code the runtime does not know
  }
}

export function describeNotification(event: string, payload: Record<string, unknown>, firmName: string, tz: string): NotificationCopy {
  const p = payload ?? {};
  const whenIso = (p.starts_at ?? p.scheduled_at) as string | undefined;
  // Staff rows keep the console's own short date ("4 Nov 2026, 10:00").
  const staffWhen = toDate(whenIso)
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: usableZone(tz) }).format(new Date(whenIso as string))
    : "";
  // The firm by name, at the start of a sentence and inside one. The list passes "Your firm" when
  // it cannot name the firm, which reads "your firm" mid-sentence.
  const firm = firmName?.trim() || "Your firm";
  const firmMid = firm === "Your firm" ? "your firm" : firm;
  const at = whenWords(whenIso, tz);
  const on = at ? ` on ${at}` : "";
  const time = timeWords(whenIso, tz);
  const appt = p.appointment_id ? `/app/appointments/${p.appointment_id}` : "/app/appointments";
  const matter = p.matter_id ? `/app/matters/${p.matter_id}` : "/app/matters";
  const withFirm = `Your consultation with ${firmMid}`;
  switch (event) {
    case "appointment_confirmed": return { title: "Consultation confirmed", body: `${withFirm}${on} is confirmed.`, url: appt };
    case "appointment_held": return { title: "Your booking is held",
      body: `Your booking with ${firmMid}${on} is held for you. See what is still needed so ${firmMid} can confirm it.`, url: appt };
    case "appointment_checkin_due": return { title: "Before your consultation",
      body: `${withFirm}${on} is not confirmed yet. Finish what is still needed so ${firmMid} can confirm it.`, url: appt };
    case "appointment_awaiting_confirmation": return { title: "A held consultation needs confirming", body: staffWhen, url: `/firm/appointments/${p.appointment_id ?? ""}` };
    case "document_requested": {
      const title = words(p.title);
      const due = calendarDayWords(typeof p.due_on === "string" ? p.due_on : null, tz);
      return { title: "A document is needed",
        body: `${title ? `${firm} has asked you for this document: ${title}.` : `${firm} has asked you for a document.`}${due ? ` It is needed by ${due}.` : ""}`,
        url: p.appointment_id ? `/app/appointments/${p.appointment_id}` : `${matter}?tab=documents` };
    }
    case "document_received": return { title: "A requested document arrived", body: String(p.name ?? p.title ?? ""), url: p.appointment_id ? `/firm/appointments/${p.appointment_id}` : `/firm/matters/${p.matter_id ?? ""}?tab=documents` };
    // The full day, not only "tomorrow", because the row is still read after the day has passed.
    case "appointment_reminder_24h": return { title: "Consultation tomorrow", body: at ? `${withFirm} is on ${at}.` : `${withFirm} is tomorrow.`, url: appt };
    case "appointment_reminder_1h": return { title: "Consultation in 1 hour", body: time ? `${withFirm} starts at ${time}.` : `${withFirm} starts in 1 hour.`, url: appt };
    // The payload does not say whether it is a video call, so these do not say "join": the
    // waiting room itself tells an in-person client there is no video room.
    case "appointment_reminder_10m": return { title: "Consultation in 10 minutes", body: time ? `${withFirm} starts at ${time}.` : `${withFirm} starts in 10 minutes.`, url: `${appt}/waiting-room` };
    case "appointment_reminder_now": return { title: "Your consultation is ready", body: `${withFirm} is starting now.`, url: `${appt}/waiting-room` };
    case "appointment_cancelled": return { title: "Consultation cancelled", body: `${withFirm}${on} has been cancelled.`, url: appt };
    case "appointment_rescheduled": return { title: "Consultation moved", body: at ? `${withFirm} is now on ${at}.` : `${withFirm} has moved to a new time.`, url: appt };
    case "appointment_completed": return { title: "Consultation completed",
      body: `Thank you for meeting ${firmMid}. If your lawyer shares a summary, it will be on the consultation page.`, url: appt };
    case "invoice_issued": {
      const amount = amountOf(p);
      const due = calendarDayWords(typeof p.due_at === "string" ? p.due_at : null, tz);
      return { title: "New invoice",
        body: `${firm} has sent you an invoice${amount ? ` for ${amount}` : ""}.${due ? ` It is due by ${due}.` : ""} See what it covers before you pay.`,
        url: p.invoice_id ? `/app/payments/${p.invoice_id}` : "/app/payments" };
    }
    case "payment_confirmed": {
      const amount = amountOf(p);
      const number = words(p.invoice_number);
      return { title: "Payment received",
        body: `Thank you. ${firm} has received your payment${amount ? ` of ${amount}` : ""}${number ? ` for invoice ${number}` : ""}.`,
        url: p.invoice_id ? `/app/payments/${p.invoice_id}` : "/app/payments" };
    }
    case "matter_update": return { title: words(p.title) || "Update on your matter", body: `${firm} has posted an update on your matter.`, url: `${matter}?tab=timeline` };
    case "court_date_t3":
    case "court_date_t1": {
      const court = words(p.court_name);
      const purpose = words(p.purpose);
      const where = court ? `at ${court}` : "in court";
      const soon = event === "court_date_t1" ? "tomorrow" : "in 3 days";
      return { title: event === "court_date_t1" ? "Court date tomorrow" : "Court date in 3 days",
        body: `Your matter comes up ${where}${at ? ` on ${at}` : ` ${soon}`}.${purpose ? ` It is listed for ${phrase(purpose)}.` : ""}`,
        url: "/app/court-dates" };
    }
    case "deadline_due_t7": return { title: `${p.title ?? "A deadline"} in a week`, body: `Due ${p.due_on ?? ""}`, url: `/firm/matters/${p.matter_id ?? ""}?tab=deadlines` };
    case "deadline_due_t1": return { title: `${p.title ?? "A deadline"} tomorrow`, body: `Due ${p.due_on ?? ""}`, url: `/firm/matters/${p.matter_id ?? ""}?tab=deadlines` };
    case "deadline_due_t0": return { title: `${p.title ?? "A deadline"} today`, body: `Due ${p.due_on ?? ""}`, url: `/firm/matters/${p.matter_id ?? ""}?tab=deadlines` };
    case "document_ready_to_sign": return { title: "A document is ready for your signature",
      body: `${firm} has asked you to sign ${words(p.name) || "a document"}. Read it before you sign.`, url: `${matter}?tab=documents` };
    // Two audiences: the client is told the firm countersigned, the firm that the client signed.
    // The payload says which, because a client sent to /firm/… lands on a page they cannot open.
    case "document_signed": return { title: `Signed: ${p.name ?? "a document"}`, body: `${p.signer ?? "The signer"} signed it.`,
      url: p.audience === "client" ? `${matter}?tab=documents` : `/firm/matters/${p.matter_id ?? ""}?tab=documents` };
    // Delegation (migration 44). The principal is told at each step, because an authority the
    // client never hears about is the one worth worrying about. The firm is named where these
    // once said "your firm"; what each notice says has not changed.
    case "representation_granted": return { title: "Someone has been authorised to act for you",
      body: `${firm} recorded an authority${p.organisation ? ` for ${p.organisation}` : ""}. Check it, and end it if you did not ask for it.`,
      url: "/app/authority" };
    case "representation_accepted": return { title: "That authority has been taken up",
      body: `The person ${firmMid} named can now act on your files. You can end it at any time.`, url: "/app/authority" };
    case "representation_revoked": return { title: "An authority has ended",
      body: "Nobody is acting under it from now on.", url: "/app/authority" };
    case "representation_accepted_staff": return { title: "A representative took up their authority",
      body: "They can now act on the matters you named.", url: `/firm/clients/${p.principal_id ?? ""}` };
    case "client_contact_changed": return { title: "A client changed how they are reached",
      body: `${p.phone_changed ? "Phone" : ""}${p.phone_changed && p.email_changed ? " and " : ""}${p.email_changed ? "Email" : ""} changed. If you were not expecting it, ring the number you had before.`,
      url: `/firm/clients/${p.client_id ?? ""}` };
    // Firm to firm (migration 45). A collaboration is proposed, answered, fed and ended, and both
    // firms — and, when it starts, the client — hear the part that concerns them.
    case "collaboration_proposed": return { title: `${p.from_firm_name ?? "A firm"} has asked you to take something on`,
      body: `${p.case_title ?? "A matter"}${p.suit_number ? ` · ${p.suit_number}` : ""}`, url: "/firm/collaborations" };
    case "collaboration_accepted": return { title: `${p.with_firm_name ?? "The firm"} accepted`,
      body: "They are on the matter now.", url: `/firm/matters/${p.matter_id ?? ""}?tab=working` };
    case "collaboration_declined": return { title: `${p.with_firm_name ?? "The firm"} declined`,
      body: String(p.reason ?? "No reason given."), url: `/firm/matters/${p.matter_id ?? ""}?tab=working` };
    case "collaboration_document_shared": return { title: "A document was shared with you",
      body: `${p.name ?? "A document"}${p.case_title ? ` · ${p.case_title}` : ""}`, url: "/firm/collaborations" };
    case "collaboration_ended": return { title: "An arrangement between firms has ended",
      body: `${p.case_title ?? "A matter"} · ended by ${p.by_firm_name ?? "one of the firms"}`, url: "/firm/collaborations" };
    // The client's own notice: another firm is on their file.
    case "collaboration_started": return { title: `${p.with_firm_name ?? "Another firm"} is working on your matter`,
      body: `${firm} has brought them in. Open the matter to see what they are doing.`, url: `${matter}?tab=timeline` };
    case "new_message": return { title: `New message from ${firmMid}`, body: "Open it to read and reply.", url: p.matter_id ? `${matter}?tab=messages` : p.appointment_id ? `/app/messages/appointment/${p.appointment_id}` : "/app/messages" };
    // An event this list does not know yet: its name in words, never the code itself.
    default: {
      const named = event.replace(/_/g, " ").trim();
      return { title: named ? named.charAt(0).toUpperCase() + named.slice(1) : `Update from ${firmMid}`, body: "", url: "/app" };
    }
  }
}

export const PREFERENCE_EVENTS: Array<{ event: string; label: string }> = [
  { event: "appointment_confirmed", label: "Consultation confirmed" },
  { event: "appointment_held", label: "Booking held: what is still needed" },
  { event: "appointment_checkin_due", label: "Reminder: before your consultation" },
  { event: "appointment_reminder_24h", label: "Reminder: 24 hours before" },
  { event: "appointment_reminder_1h", label: "Reminder: 1 hour before" },
  { event: "appointment_reminder_10m", label: "Reminder: 10 minutes before" },
  { event: "appointment_rescheduled", label: "Consultation moved" },
  { event: "appointment_cancelled", label: "Consultation cancelled" },
  { event: "invoice_issued", label: "A new invoice" },
  { event: "payment_confirmed", label: "Payment received" },
  { event: "matter_update", label: "Updates on my matters" },
  { event: "court_date_t3", label: "Court date in 3 days" },
  { event: "court_date_t1", label: "Court date tomorrow" },
  { event: "new_message", label: "New message" },
  { event: "document_ready_to_sign", label: "A document to sign" },
];
export const PREFERENCE_CHANNELS: Array<{ channel: "push" | "email" | "sms"; label: string }> = [
  { channel: "push", label: "Push" },
  { channel: "email", label: "Email" },
  { channel: "sms", label: "SMS" },
];
