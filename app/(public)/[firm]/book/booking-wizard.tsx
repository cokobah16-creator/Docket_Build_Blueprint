"use client";

// The booking wizard, folded for the phone.
//
// The flow used to be eight conditional steps — service, format, lawyer, date,
// slot, intake, sign-in, review — which is a lot of "Continue" on a phone. It
// is now five, by putting the choices that belong together on one screen:
// lawyer sits with the day and time it constrains, and signing in happens on
// the review screen, next to the thing it is for. Nothing was dropped.
//
// THE REVIEW STEP READS LIKE THE INVOICE IT IS ABOUT TO CREATE. "Before you pay"
// (src/components/portal/before-you-pay.tsx) says who is paid, for what, and how
// the total is made, before the button. Its figures come from buildBreakdown(),
// fed with the invoice book_appointment() writes for a priced booking: one line,
// "{service} ({n} min)", at the service's price, and the firm's VAT on it worked
// out the way Postgres works it out. So the review and the invoice say the same
// thing, and the amount on the button is the amount Paystack is asked for.
//
// ONE MAIN ACTION PER STEP. Each step has one filled button, and a disabled one
// says under it what is missing. Signed out on the review step, the action is
// signing in and the sign-in form brings its own button, so the wizard shows no
// button of its own until there is a session, rather than a dead one beside it.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { vatMinor } from "@/lib/money";
import { breakdownMoney, buildBreakdown, type BreakdownInput } from "@/lib/payment-breakdown";
import { modeLabel, zoneLabel } from "@/lib/client-words";
import { policyDocumentHref, publishedPolicyText } from "@/lib/policy-text";
import type {
  AppointmentSlot,
  FirmPublic,
  IntakeForm,
  IntakeQuestion,
  LawyerPublic,
  ServiceRow,
} from "@/lib/db/types";
import { SignInForms } from "@/components/auth/sign-in-forms";
import { BeforeYouPay } from "@/components/portal/before-you-pay";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input, Select, chipClasses, choiceCardClasses } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { bookAppointment, recordBookingConsent, startPayment, saveContactEmail } from "@/lib/actions/booking";
import { priceIncludingVat } from "../_components/site-words";

type Step = "service" | "mode" | "when" | "intake" | "review";
type Mode = "virtual" | "in_person" | "phone";
type Answers = Record<string, string | string[]>;
interface SessionUser { id: string; email: string | null; phone: string | null }

/**
 * What survives the sign-in round trip, in sessionStorage. A File cannot be written there, so
 * only whether any were chosen is kept: that is how the client is asked to choose them again
 * rather than booking without them unawares.
 */
interface SavedChoices {
  serviceId: string | null;
  mode: Mode | null;
  lawyerId: string | null;
  date: string | null;
  slot: AppointmentSlot | null;
  answers: Answers;
  hadFiles?: boolean;
}

/**
 * Where submit() has got to. The button names it while it runs (docs/VOICE.md, rule 10), and a
 * failure is worded from it, because what was done before it stopped is what the client needs
 * to hear: whether anything is booked, and whether they have paid.
 */
type Phase = "consent" | "email" | "upload" | "book" | "pay" | "open";

const PHASE_LABELS: Record<Phase, string> = {
  consent: "Recording your acceptance…",
  email: "Saving your email address…",
  upload: "Uploading your files…",
  book: "Booking your consultation…",
  pay: "Opening Paystack…",
  open: "Opening your booking…",
};

const STEP_TITLES: Record<Step, string> = {
  service: "Service",
  mode: "How you meet",
  when: "Day and time",
  intake: "Details",
  review: "Check and book",
};

const MODE_ORDER: Mode[] = ["virtual", "in_person", "phone"];
const MODE_ICONS: Record<Mode, IconName> = { virtual: "video", in_person: "building", phone: "phone" };

function modeHint(m: Mode, firmName: string): string {
  switch (m) {
    case "virtual":
      // The room offers sound only before joining, with its data cost named
      // (src/components/video/consultation-room.tsx). It is a choice, not a switch it makes.
      return "From your phone or computer. If your network is weak, you can choose sound only.";
    case "in_person":
      return `At ${firmName}'s office.`;
    case "phone":
      return "Your lawyer phones you at the time you choose.";
  }
}

/** The firm's own disclaimer, when it has written one, takes this one's place. */
const DEFAULT_DISCLAIMER =
  "Submitting an enquiry or booking a consultation does not create a lawyer-client relationship. " +
  "Formal legal advice and representation begin only on a signed engagement.";

/**
 * The booking is made and holds the time, but checkout did not open. Booking again from here
 * would only collide with that hold, so the wizard stops offering to and sends the client to the
 * consultation page, whose pay panel shows the hold and the breakdown and can open Paystack.
 */
const PAYSTACK_DID_NOT_OPEN =
  "Your booking is made, and the time is held for you for 15 minutes. Paystack did not open, so you have not paid yet. " +
  "You can still pay from your consultation page.";

/**
 * How a sentence ends when online booking is closed to this client for now. It is a dead end for
 * someone who cannot wait, so wherever it is shown the urgent-help link is shown beside it.
 */
const CONTACT_DIRECTLY = "Please contact the firm directly.";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const fieldClasses =
  "w-full rounded-control border border-edge bg-raised px-3 py-[11px] text-base text-ink " +
  "placeholder:text-ink-muted focus:border-brand focus:outline focus:outline-2 focus:outline-brand";

function isoDateInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** "10:00": 24-hour, in `tz`. */
function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(
    new Date(iso),
  );
}
/**
 * "Wednesday 4 November 2026" (docs/VOICE.md, rule 11). Put together from its parts, because
 * en-GB writes "Wednesday, 4 November 2026" once the year is in it, and browsers do not agree.
 */
function fmtDate(iso: string, tz: string, withYear = true): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: withYear ? "numeric" : undefined,
    timeZone: tz,
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return [part("weekday"), part("day"), part("month"), part("year")].filter(Boolean).join(" ");
}
function lawyerName(l: LawyerPublic | undefined, firmName: string): string {
  return l?.full_name ?? `${firmName} lawyer`;
}
function isVisible(q: IntakeQuestion, answers: Answers): boolean {
  if (!q.show_if) return true;
  const v = answers[q.show_if.question];
  return Array.isArray(v) ? v.includes(q.show_if.equals) : v === q.show_if.equals;
}
/** The service's own form, else the firm's general one. */
function formFor(service: ServiceRow | undefined, forms: IntakeForm[]): IntakeForm | undefined {
  if (!service) return undefined;
  return forms.find((f) => f.service_id === service.id) ?? forms.find((f) => f.service_id === null);
}
function stepsFor(hasForm: boolean): Step[] {
  return hasForm ? ["service", "mode", "when", "intake", "review"] : ["service", "mode", "when", "review"];
}
/**
 * The first question the client still has to answer, of those the form shows them. A file
 * question never holds the client back here, as before: files go up when they book.
 */
function firstMissingAnswer(form: IntakeForm | undefined, answers: Answers): IntakeQuestion | undefined {
  return form?.schema.questions.find((q) => {
    if (!q.required || q.type === "file" || !isVisible(q, answers)) return false;
    const v = answers[q.key];
    return Array.isArray(v) ? v.length === 0 : !(v && v.trim());
  });
}

/**
 * The invoice book_appointment() writes for a priced booking (migration 35), as a breakdown:
 * one line, format('%s (%s min)', name, duration_min), quantity 1, at the service's price; VAT
 * at the firm's rate on that price; and the two added up. Built from the same values here, so
 * the review shows the invoice's own line, and the wizard can tell when the invoice the
 * database raised is not the one it showed.
 */
function bookingInvoice(firm: FirmPublic, service: ServiceRow): BreakdownInput {
  const rate = Number(firm.vat_rate) || 0;
  const vat = vatMinor(service.price_minor, rate);
  return {
    currency: service.currency,
    payee: { name: firm.name, legalName: firm.legal_name, rcNumber: firm.rc_number },
    lines: [
      { description: `${service.name} (${service.duration_min} min)`, quantity: 1, unitMinor: service.price_minor },
    ],
    subtotalMinor: service.price_minor,
    vatMinor: vat,
    vatRatePercent: rate,
    totalMinor: service.price_minor + vat,
  };
}

interface Problem {
  sentence: string;
  /** The step where the client can put it right. */
  goTo?: Step;
  /** The database no longer sees a session, so the sign-in form comes back. */
  signedOut?: boolean;
}

/**
 * The sentence a client reads when booking stops part way (docs/VOICE.md, rule 12): what was not
 * done, that nothing was booked, and what to do next. `raw` is whatever came back: the database's
 * own words, which bookAppointment() passes on unchanged on purpose, a server action's sentence,
 * or the network's. It is matched and never shown. "slot unavailable" and "has not published its
 * terms" are book_appointment()'s phrases, which SQL tests pin too, so they are matched as the
 * database writes them and reworded only here.
 */
function bookingProblem(
  at: Phase,
  raw: string,
  ctx: { firmName: string; untouched: string; fileName?: string },
): Problem {
  const text = raw.toLowerCase();
  const { firmName, untouched } = ctx;
  const offline = /failed to fetch|load failed|networkerror|network error|fetch failed|timed out|timeout|could not be reached/.test(
    text,
  );

  if (at === "upload") {
    const name = ctx.fileName ?? "A file";
    if (/too large|maximum allowed size|exceeded the maximum/.test(text)) {
      return { sentence: `${name} is larger than 25 MB, so it did not upload. ${untouched} Choose a smaller file, then book again.`, goTo: "intake" };
    }
    if (/mime type|invalid file type|not supported/.test(text)) {
      return { sentence: `${name} is not a PDF, a Word document or a photo, so it did not upload. ${untouched} Choose another file, then book again.`, goTo: "intake" };
    }
    if (offline) return { sentence: `${name} did not upload because Docket could not be reached. ${untouched} Check your connection and try again.` };
    return { sentence: `${name} did not upload. ${untouched} Please try again in a moment.` };
  }

  if (text.includes("slot unavailable")) {
    return { sentence: `That time is no longer free. ${untouched} Please choose another time.`, goTo: "when" };
  }
  if (text.includes("has not published its terms")) {
    return { sentence: `${firmName} has not published its terms of service and privacy notice yet, so it cannot take bookings online. ${untouched} ${CONTACT_DIRECTLY}` };
  }
  if (text.includes("changed its terms")) {
    return { sentence: `${firmName} has changed its terms of service or privacy notice since this page opened. ${untouched} Reload the page and read the new version before you book. It can take up to a minute to appear.` };
  }
  if (text.includes("service unavailable")) {
    return { sentence: `${firmName} is not offering this service online any more. ${untouched} Please choose another service.`, goTo: "service" };
  }
  if (text.includes("not available virtually")) {
    return { sentence: `This service is not offered as a video call any more. ${untouched} Please choose another way to meet.`, goTo: "mode" };
  }
  if (text.includes("set up to receive payments")) {
    return { sentence: `${firmName} cannot take payments online yet, so this consultation cannot be booked here. ${untouched} ${CONTACT_DIRECTLY}` };
  }
  if (text.includes("not taking bookings")) {
    return { sentence: `${firmName} is not taking bookings online at the moment. ${untouched} ${CONTACT_DIRECTLY}` };
  }
  // The booking limit, in book_appointment() and in the action in front of it (tooFast()).
  if (text.includes("attempts in")) {
    return { sentence: `There have been too many booking attempts in the last hour, so this one was not made. ${untouched} Please try again in an hour.` };
  }
  if (text.includes("not authenticated") || text.includes("sign in first") || text.includes("not signed in")) {
    return { sentence: `You are no longer signed in. ${untouched} Please sign in again, then book.`, signedOut: true };
  }
  if (text.includes("tick both boxes")) return { sentence: `${untouched} Tick both boxes above, then book.` };
  if (at === "email" && text.includes("look right")) {
    return { sentence: `That email address does not look right. ${untouched} Check it, then book again.` };
  }
  if (offline) return { sentence: `Docket could not be reached. ${untouched} Check your connection and try again.` };
  return { sentence: `That did not go through. ${untouched} Please try again in a moment. If it keeps happening, contact ${firmName}.` };
}

export function BookingWizard({
  firm,
  services,
  lawyers,
  forms,
  initialServiceSlug,
  initialLawyerId,
  resume,
}: {
  firm: FirmPublic;
  services: ServiceRow[];
  lawyers: LawyerPublic[];
  forms: IntakeForm[];
  initialServiceSlug: string | null;
  initialLawyerId: string | null;
  resume: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const storageKey = `docket-booking:${firm.id}`;
  const visitorTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const soleLawyerId = lawyers.length === 1 ? lawyers[0]!.id : null;

  const [serviceId, setServiceId] = useState<string | null>(
    services.find((s) => s.slug === initialServiceSlug)?.id ?? null,
  );
  const [mode, setMode] = useState<Mode | null>(null);
  const [lawyerId, setLawyerId] = useState<string | null>(
    lawyers.find((l) => l.id === initialLawyerId)?.id ?? soleLawyerId,
  );
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsFailed, setSlotsFailed] = useState(false);
  const [slot, setSlot] = useState<AppointmentSlot | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // Signed in on this page, by a code: the sign-in form disappears, so the screen says why.
  const [signedInHere, setSignedInHere] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [stepIdx, setStepIdx] = useState(0);
  const [pendingResume, setPendingResume] = useState(resume);
  // A calm word about the round trip: choices or files that did not survive it.
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  // Set once a booking exists but checkout did not open (PAYSTACK_DID_NOT_OPEN).
  const [bookedId, setBookedId] = useState<string | null>(null);
  // Two boxes, never ticked for the client, and not remembered across the sign-in round trip:
  // the acceptance is given on the screen where it is recorded.
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const submitting = phase !== null;
  const locked = submitting || bookedId !== null;

  const service = services.find((s) => s.id === serviceId);
  const lawyer = lawyers.find((l) => l.id === lawyerId);
  // The firm's VAT rate, as a percentage. book_appointment() adds vatMinor(price, rate) to a priced
  // booking and raises the invoice for the total (bookingInvoice() above), so every figure a client
  // is asked to confirm here is that invoice, worked out the same way.
  const vatRate = Number(firm.vat_rate) || 0;
  const priced = (service?.price_minor ?? 0) > 0;
  // requires_prepayment defaults to true in the database, so only an explicit false is "invoiced
  // after". A prepaid booking waits for payment with a 15-minute hold; any other priced booking is
  // made at once with its invoice already raised, and nothing is paid here.
  const paysNow = priced && service?.requires_prepayment !== false;
  const invoicedAfter = priced && service?.requires_prepayment === false;
  const breakdown = service ? buildBreakdown(bookingInvoice(firm, service)) : null;
  const payAmount = breakdown ? breakdownMoney(breakdown, breakdown.chargeMinor) : "";
  const form = formFor(service, forms);
  const lawyerTz = lawyer?.timezone ?? firm.timezone;
  // The versions the client is asked to accept. A '0-' version is the unpublished skeleton every
  // firm starts with, and book_appointment() refuses to book until both are published, so the
  // wizard says so on the first screen rather than after four steps of choices.
  const termsVersion = firm.policies.terms?.version ? String(firm.policies.terms.version) : null;
  const privacyVersion = firm.policies.privacy?.version ? String(firm.policies.privacy.version) : null;
  const policiesPublished =
    termsVersion !== null && privacyVersion !== null && !termsVersion.startsWith("0-") && !privacyVersion.startsWith("0-");
  const consentGiven = policiesPublished && acceptTerms && acceptPrivacy;
  const cancellationText = publishedPolicyText(firm.policies.cancellation);
  const disclaimer = firm.policies.disclaimer?.text ? String(firm.policies.disclaimer.text) : DEFAULT_DISCLAIMER;
  const urgentHref = `/${firm.slug}/urgent`;

  const steps = useMemo<Step[]>(() => stepsFor(Boolean(form)), [form]);
  // Clamped, because the steps shrink when a service without a form is chosen.
  const idx = Math.max(0, Math.min(stepIdx, steps.length - 1));
  const step = steps[idx]!;
  const stepTitle = (s: Step) => (s === "review" && paysNow ? "Check and pay" : STEP_TITLES[s]);

  // --- session ---------------------------------------------------------------
  // The profile's email is read whenever a different person signs in, a code on this page
  // included. It decides whether the receipt address is asked for, and a client who signed in
  // here used to be asked for an address their profile already had.
  useEffect(() => {
    if (!supabase) { setAuthChecked(true); return; }
    let active = true;
    // The id last applied: undefined before the first answer, null for "signed out".
    let seen: string | null | undefined;
    const apply = (u: User | null | undefined) => {
      if (!active) return;
      const id = u?.id ?? null;
      setUser(u ? { id: u.id, email: u.email ?? null, phone: u.phone ?? null } : null);
      if (id === seen) return;
      if (seen === null && id) setSignedInHere(true);
      seen = id;
      setProfileEmail(null);
      if (!u) return;
      void supabase.from("profiles").select("email").eq("id", u.id).maybeSingle().then(({ data }) => {
        if (active && seen === u.id) setProfileEmail((data as { email: string | null } | null)?.email ?? null);
      });
    };
    supabase.auth.getUser().then(
      ({ data }) => {
        apply(data.user);
        if (active) setAuthChecked(true);
      },
      () => {
        if (active) setAuthChecked(true);
      },
    );
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // Out of the callback: supabase-js calls it while it holds its auth lock, and the profile
      // read that apply() starts would wait on that same lock.
      setTimeout(() => apply(session?.user), 0);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [supabase]);

  // --- persistence across the sign-in round trip ------------------------------
  // An email link or Google sends the client away and back to ?resume=1. Their choices come back
  // from sessionStorage and they land on the first step that still needs something, which is the
  // review step when everything came back. It used to set the step to 999 and let the screen
  // clamp it, which left the header reading "Step 1000 of 5" and Back walking to 998.
  // sessionStorage belongs to one tab, so a link opened in a new tab finds nothing: then the
  // client starts again with a sentence saying why, rather than on an empty review step.
  useEffect(() => {
    if (!pendingResume) return;
    let saved: SavedChoices | null = null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      saved = raw ? (JSON.parse(raw) as SavedChoices) : null;
    } catch {
      saved = null;
    }
    const svc = services.find((s) => s.id === saved?.serviceId);
    const kept = saved && svc ? saved : null;
    const keptMode = kept?.mode === "virtual" && !svc?.virtual_available ? null : (kept?.mode ?? null);
    const keptLawyer = kept?.lawyerId ?? soleLawyerId;
    const keptForm = formFor(svc, forms);
    if (kept && svc) {
      setServiceId(svc.id);
      setMode(keptMode);
      setLawyerId(keptLawyer);
      setDate(kept.date);
      setSlot(kept.slot);
      setAnswers(kept.answers ?? {});
    }
    const target: Step = !kept
      ? "service"
      : !keptMode
        ? "mode"
        : !keptLawyer || !kept.date || !kept.slot
          ? "when"
          : keptForm && (kept.hadFiles || firstMissingAnswer(keptForm, kept.answers ?? {}))
            ? "intake"
            : "review";
    setStepIdx(stepsFor(Boolean(keptForm)).indexOf(target));
    setNote(
      !kept
        ? "Your choices from before you signed in were not kept. Please choose them again."
        : target === "intake" && kept.hadFiles
          ? "Files are not kept while you sign in. Please choose your files again."
          : null,
    );
    setPendingResume(false);
  }, [pendingResume, storageKey, services, forms, soleLawyerId]);

  useEffect(() => {
    // Not while a resume is still to be read. This runs straight after that effect, in the same
    // commit and with the state from before the restore, and would overwrite the very choices
    // being restored (which React's development double run would then read back).
    if (pendingResume) return;
    try {
      const saved: SavedChoices = {
        serviceId, mode, lawyerId, date, slot, answers,
        hadFiles: Object.values(files).some((list) => list.length > 0),
      };
      sessionStorage.setItem(storageKey, JSON.stringify(saved));
    } catch { /* private mode or full: a round trip then starts again, and says so */ }
  }, [pendingResume, storageKey, serviceId, mode, lawyerId, date, slot, answers, files]);

  // --- slots -------------------------------------------------------------------
  const slotTicket = useRef(0);
  const loadSlots = useCallback(async (d: string) => {
    if (!supabase || !serviceId || !lawyerId) return;
    const ticket = ++slotTicket.current;
    setSlotsLoading(true);
    setSlotsFailed(false);
    setSlots([]);
    let found: AppointmentSlot[] | null = null;
    try {
      const { data, error: err } = await supabase.rpc("available_slots", {
        p_firm: firm.id, p_lawyer: lawyerId, p_service: serviceId, p_date: d,
      });
      if (!err) found = (data ?? []) as AppointmentSlot[];
    } catch {
      found = null;
    }
    // Only the day picked last is shown: a slow answer for an earlier day must not land on it.
    if (ticket !== slotTicket.current) return;
    setSlotsLoading(false);
    // A failed read is not an empty day. It used to show "No free times on this day".
    if (found) setSlots(found);
    else setSlotsFailed(true);
  }, [supabase, serviceId, lawyerId, firm.id]);

  // Day and time are one screen now, so the slots load as soon as a day is
  // picked rather than on the way to a separate step.
  useEffect(() => { if (step === "when" && date) void loadSlots(date); }, [step, date, loadSlots]);

  const dates = useMemo(() => {
    const out: { iso: string; dow: string; num: string; month: string }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.now() + i * 86_400_000);
      const part = (opts: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: lawyerTz }).format(d);
      out.push({
        iso: isoDateInTz(d, lawyerTz),
        dow: part({ weekday: "short" }),
        num: part({ day: "numeric" }),
        month: part({ month: "long" }),
      });
    }
    return out;
  }, [lawyerTz]);

  // Whether the client's clock and the lawyer's read differently. Two zone names can share a
  // clock (Douala and Lagos), and then one time, in the lawyer's words ("WAT"), is the honest one.
  const zonesDiffer = useMemo(() => {
    const now = new Date();
    const reading = (tz: string) => `${isoDateInTz(now, tz)} ${fmtTime(now.toISOString(), tz)}`;
    return reading(visitorTz) !== reading(lawyerTz);
  }, [visitorTz, lawyerTz]);
  const timeWords = (iso: string) =>
    zonesDiffer
      ? `${fmtTime(iso, visitorTz)} ${zoneLabel(visitorTz)} (${fmtTime(iso, lawyerTz)} ${zoneLabel(lawyerTz)} for your lawyer)`
      : `${fmtTime(iso, lawyerTz)} ${zoneLabel(lawyerTz)}`;

  // --- navigation --------------------------------------------------------------
  const visibleQuestions = form ? form.schema.questions.filter((q) => isVisible(q, answers)) : [];
  const missingAnswer = firstMissingAnswer(form, answers);
  // What the step's Continue is waiting for, said under it (docs/VOICE.md, rule 14).
  const blocker: string | null = (() => {
    switch (step) {
      case "service": return service ? null : "Choose a service to continue.";
      case "mode": return mode ? null : "Choose how you would like to meet to continue.";
      case "when":
        if (!lawyerId) return "Choose a lawyer to continue.";
        if (!date) return "Choose a day to continue.";
        if (!slot) return "Choose a time to continue.";
        return null;
      case "intake": return missingAnswer ? `Answer “${missingAnswer.label}” to continue.` : null;
      default: return null;
    }
  })();

  const next = () => { setError(null); setNote(null); setStepIdx(Math.min(idx + 1, steps.length - 1)); };
  const back = () => { setError(null); setNote(null); setSignedInHere(false); setStepIdx(Math.max(idx - 1, 0)); };

  // A step that starts above the fold reads as nothing having happened, so moving between steps
  // brings the top of the wizard back into view. Not on the first render, and not when it shows.
  const topRef = useRef<HTMLDivElement>(null);
  const shownIdx = useRef<number | null>(null);
  useEffect(() => {
    if (shownIdx.current !== null && shownIdx.current !== idx) {
      const el = topRef.current;
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
    }
    shownIdx.current = idx;
  }, [idx]);

  // --- submit --------------------------------------------------------------------
  // Paystack needs an address for its receipt, so it is asked for only when there is a fee: a free
  // consultation used to ask a phone-only client for an email nothing would ever use.
  const needEmail = Boolean(user && !user.email && !profileEmail && priced);
  const emailMissing = needEmail && !contactEmail.trim();
  const reviewBlocker =
    emailMissing && !consentGiven
      ? "Add your email address and tick both boxes above to book."
      : emailMissing
        ? "Add your email address above to book."
        : !consentGiven
          ? "Tick both boxes above to book."
          : null;

  async function submit() {
    if (!supabase || !user || !service || !lawyerId || !slot || !mode) return;
    if (!consentGiven || !termsVersion || !privacyVersion || emailMissing) return;
    const shown = bookingInvoice(firm, service);
    const ctx = { firmName: firm.name, untouched: paysNow ? "Nothing was booked, and you have not paid." : "Nothing was booked." };
    const stop = (p: Problem) => {
      setError(p.sentence);
      setPhase(null);
      if (p.signedOut) setUser(null);
      if (p.goTo === "when") setSlot(null);
      if (p.goTo === "mode") setMode(null);
      const to = p.goTo ? steps.indexOf(p.goTo) : -1;
      if (to >= 0) setStepIdx(to);
    };
    let at: Phase = "consent";
    // The booking exists, so the client is sent to it rather than offered "Book" again.
    const madeButStopped = (id: string) => {
      setBookedId(id);
      setPhase(null);
      setError(at === "pay" ? PAYSTACK_DID_NOT_OPEN : "Your booking is made. You can see it on your consultation page.");
    };
    let appointmentId: string | null = null;
    setError(null);
    setNote(null);
    setPhase("consent");
    try {
      // The acceptance is recorded first, so a refusal stops here: no file has been uploaded
      // and no slot has been taken.
      const consent = await recordBookingConsent({
        firmId: firm.id,
        acceptTerms,
        acceptPrivacy,
        termsVersion,
        privacyVersion,
      });
      if (consent?.error) return stop(bookingProblem(at, consent.error, ctx));
      if (needEmail) {
        at = "email";
        setPhase("email");
        const r = await saveContactEmail(contactEmail.trim());
        if (r?.error) return stop(bookingProblem(at, r.error, ctx));
      }
      at = "upload";
      if (Object.values(files).some((list) => list.length > 0)) setPhase("upload");
      const uploaded: Record<string, string[]> = {};
      for (const [key, list] of Object.entries(files)) {
        const paths: string[] = [];
        for (const [i, file] of list.entries()) {
          const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
          const path = `${firm.id}/${user.id}/${Date.now()}-${i}-${safe}`;
          const { error: upErr } = await supabase.storage.from("intake-uploads").upload(path, file);
          if (upErr) return stop(bookingProblem(at, upErr.message, { ...ctx, fileName: file.name }));
          paths.push(path);
        }
        uploaded[key] = paths;
      }
      // Through the server action, not straight at the RPC. The action is where the booking rate
      // limit is applied and where the funnel's "booking started" is recorded — calling the RPC
      // from here would skip both, which is exactly what used to happen.
      at = "book";
      setPhase("book");
      const booked = await bookAppointment({
        firmId: firm.id,
        firmSlug: firm.slug,
        serviceId: service.id,
        lawyerId,
        startsAt: slot.starts_at,
        mode,
        clientTimezone: visitorTz,
        intake: form ? { ...answers, ...uploaded } : null,
        intakeFormId: form?.id ?? null,
      });
      if ("error" in booked) return stop(bookingProblem(at, booked.error, ctx));
      const result = booked.booking;
      appointmentId = result.appointment_id;
      try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
      // The button promised the breakdown's total; the database raised the invoice for its own.
      // They differ only when the firm's price or VAT rate changed after the figures on this page
      // were read (the firm row and the catalogue are cached for a minute or two). Then no checkout
      // is opened for an amount the client never agreed to: the appointment page shows the
      // invoice total, and the client pays from there or does not. Totals are compared, not the
      // amount charged, so a processing fee added to the charge later cannot trip this.
      const totalChanged =
        result.invoice_id !== null &&
        (Number(result.amount_minor) !== shown.totalMinor || result.currency !== shown.currency);
      // The same goes for WHETHER to pay now. Checkout opens only when this page said so
      // (paysNow) and the database agrees (awaiting_payment). When the two differ, the service
      // changed after the page read it, and the appointment page says what happens instead.
      const paymentChanged = (result.status === "awaiting_payment") !== paysNow;
      if (result.status === "awaiting_payment" && paysNow && !totalChanged) {
        at = "pay";
        setPhase("pay");
        // startPayment() redirects to Paystack and does not come back, so the button goes on
        // saying "Opening Paystack…" while the browser leaves. It comes back only to refuse.
        const r = await startPayment(result.appointment_id);
        if (r?.error) return madeButStopped(result.appointment_id);
      } else {
        setPhase("open");
        const flags = new URLSearchParams();
        if (totalChanged) flags.set("total", "changed");
        if (paymentChanged) flags.set("payment", "changed");
        const query = flags.toString();
        router.push(`/app/appointments/${result.appointment_id}${query ? `?${query}` : ""}`);
      }
    } catch (err) {
      // A redirect from a server action arrives here as a thrown navigation that Next is already
      // carrying out. That is not a failure, and nothing should be said over it.
      try {
        unstable_rethrow(err);
      } catch {
        return;
      }
      if (appointmentId) return madeButStopped(appointmentId);
      stop(bookingProblem(at, err instanceof Error ? err.message : "", ctx));
    }
  }

  // --- render --------------------------------------------------------------------
  if (!supabase) {
    return <CannotBookOnline urgentHref={urgentHref}>Online booking is not open yet. Please contact the firm directly.</CannotBookOnline>;
  }
  if (services.length === 0) {
    return (
      <CannotBookOnline urgentHref={urgentHref}>
        {firm.name} has not listed its services for online booking yet. Please contact the firm directly.
      </CannotBookOnline>
    );
  }
  if (lawyers.length === 0) {
    return (
      <CannotBookOnline urgentHref={urgentHref}>
        Online booking opens once {firm.name} publishes when its lawyers are free. Please contact the firm directly.
      </CannotBookOnline>
    );
  }
  if (!policiesPublished) {
    return (
      <CannotBookOnline urgentHref={urgentHref}>
        {firm.name} has not published its terms of service and privacy notice yet, so it cannot take bookings online.
        Please contact the firm directly.
      </CannotBookOnline>
    );
  }

  const stepNumber = idx + 1;
  const prev = idx > 0 ? steps[idx - 1] : undefined;
  const errorBlock = error ? (
    <>
      <Alert kind="error">{error}</Alert>
      {error.endsWith(CONTACT_DIRECTLY) && <UrgentHelpLink href={urgentHref} />}
    </>
  ) : null;
  const dayWords = date ? fmtDate(`${date}T12:00:00Z`, "UTC", false) : "";
  const footer: ReactNode =
    step !== "review" ? (
      <>
        <Button
          size="lg"
          className="w-full"
          onClick={next}
          disabled={blocker !== null}
          aria-describedby={blocker ? "booking-step-needs" : undefined}
        >
          Continue
        </Button>
        {blocker && <p id="booking-step-needs" className="text-center text-13 text-ink-muted">{blocker}</p>}
      </>
    ) : bookedId ? (
      <Link href={`/app/appointments/${bookedId}`} className={buttonClasses("primary", "lg", "w-full")}>
        {paysNow ? "Pay from my consultation page" : "Open my consultation"}
      </Link>
    ) : user && service && slot && mode ? (
      <>
        <Button
          size="lg"
          className="w-full"
          onClick={submit}
          pending={submitting}
          disabled={!submitting && reviewBlocker !== null}
          aria-describedby={reviewBlocker && !submitting ? "booking-review-needs" : undefined}
        >
          {phase ? PHASE_LABELS[phase] : paysNow ? `Book and pay ${payAmount}` : "Book this consultation"}
        </Button>
        {reviewBlocker && !submitting && (
          <p id="booking-review-needs" className="text-center text-13 text-ink-muted">{reviewBlocker}</p>
        )}
      </>
    ) : null;

  return (
    <div ref={topRef} className="booking-wizard">
      <header className="sticky top-0 z-20 -mx-4 flex min-h-[50px] items-center gap-2.5 border-b border-hairline bg-raised px-2.5 py-1.5">
        {/* A 44px target with its own focus ring: it was 36px. Hidden on the first step, where
            there is nowhere to go back to, and held still while a booking is being made. */}
        <button
          type="button"
          onClick={back}
          disabled={idx === 0 || locked}
          aria-label={prev ? `Back to ${stepTitle(prev).toLowerCase()}` : "Back"}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-control border border-edge bg-raised text-ink-strong transition duration-fast hover:bg-hover disabled:opacity-40",
            focusRing,
            idx === 0 && "invisible",
          )}
        >
          <Icon name="chevron-left" size={19} strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-13 font-semibold text-ink">{stepTitle(step)}</p>
          <p className="mt-px truncate text-11 text-ink-muted">
            Step {stepNumber} of {steps.length}
          </p>
        </div>
      </header>
      <div className="-mx-4 h-[3px] bg-hairline" aria-hidden="true">
        <div
          className="h-full bg-brand transition-[width] duration-base"
          style={{ width: `${(stepNumber / steps.length) * 100}%` }}
        />
      </div>

      <div className="flex flex-col gap-3 pt-4">
        {note && <Alert kind="info">{note}</Alert>}
        {/* On the review step an error sits above the button, where the client is looking. A step
            the client was sent back to opens at its top, so the error is shown there instead. */}
        {step !== "review" && errorBlock}

        {step === "service" && (
          <>
            <StepTitle>What do you need help with?</StepTitle>
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={serviceId === s.id}
                onClick={() => { setServiceId(s.id); setMode(null); setSlot(null); }}
                className={choiceCardClasses(serviceId === s.id)}
              >
                <span className="block text-15 font-semibold text-ink">{s.name}</span>
                {s.description && <span className="mt-1 block text-13 leading-[1.45] text-ink-muted">{s.description}</span>}
                <span className="mt-1.5 block text-13 font-semibold text-brand">
                  {/* The services pages' own words for the same price, "Nothing to pay" included:
                      never "₦0" (docs/VOICE.md, rule 7). */}
                  {priceIncludingVat(s.price_minor, s.currency, vatRate)} · {s.duration_min} minutes
                </span>
              </button>
            ))}
          </>
        )}

        {step === "mode" && service && (
          <>
            <StepTitle>How would you like to meet?</StepTitle>
            {MODE_ORDER
              .filter((m) => m !== "virtual" || service.virtual_available)
              .map((m) => {
                const on = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setMode(m)}
                    className={choiceCardClasses(on)}
                  >
                    <span className="flex items-start gap-3">
                      <span
                        className={cn(
                          "grid size-[34px] shrink-0 place-items-center rounded-control",
                          on ? "bg-brand text-brand-on" : "bg-sunken text-ink-muted",
                        )}
                      >
                        <Icon name={MODE_ICONS[m]} size={18} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-15 font-semibold text-ink">{modeLabel(m)}</span>
                        <span className="mt-0.5 block text-13 leading-[1.45] text-ink-muted">{modeHint(m, firm.name)}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
          </>
        )}

        {step === "when" && (
          <>
            <StepTitle>Pick a day and time</StepTitle>
            <p className="text-13 leading-relaxed text-ink-muted">
              {zonesDiffer
                ? `Times are in ${zoneLabel(visitorTz)}. Your lawyer's time, in ${zoneLabel(lawyerTz)}, is under each one.`
                : `Times are in ${zoneLabel(lawyerTz)}.`}
              {paysNow ? " When you book, the time is held for 15 minutes while you pay." : ""}
            </p>

            {/* The lawyer decides which slots exist, so the choice sits here. */}
            {lawyers.length > 1 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-13 font-semibold text-ink">Who would you like to see?</legend>
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5">
                  {lawyers.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={lawyerId === l.id}
                      onClick={() => { setLawyerId(l.id); setDate(null); setSlot(null); }}
                      className={chipClasses(lawyerId === l.id, "shrink-0")}
                    >
                      {lawyerName(l, firm.name)}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {/* -my-1 py-1: room inside the scrolling strip for the 2px ring at its 2px offset, which an
                overflow box would otherwise clip top and bottom, without moving the step's spacing. */}
            <div className="-mx-4 -my-1 grid grid-flow-col justify-start gap-[7px] overflow-x-auto px-4 py-1">
              {dates.map((d) => {
                const on = date === d.iso;
                return (
                  <button
                    key={d.iso}
                    type="button"
                    aria-pressed={on}
                    onClick={() => { setDate(d.iso); setSlot(null); }}
                    className={cn(
                      "min-h-14 w-[62px] rounded-control border",
                      focusRing,
                      on ? "border-brand bg-brand text-brand-on" : "border-edge bg-raised text-ink",
                    )}
                  >
                    <span className="block text-11 uppercase tracking-[0.06em] opacity-70">{d.dow}</span>
                    <span className="mt-0.5 block text-17 font-bold">{d.num}</span>
                    <span className="sr-only"> {d.month}</span>
                  </button>
                );
              })}
            </div>

            {/* What the day holds, said once it is known. Always mounted, so a screen reader hears the
                change of text; a region mounted together with its text is not reliably spoken. A failure
                is the Alert below, which speaks for itself. */}
            <p className="sr-only" role="status">
              {!date || slotsFailed
                ? ""
                : slotsLoading
                  ? "Checking the free times…"
                  : slots.length === 0
                    ? "No free times on this day."
                    : `Free times on ${dayWords}.`}
            </p>
            {!date ? (
              <p className="text-13 text-ink-muted">Pick a day to see the free times.</p>
            ) : slotsLoading ? (
              <p className="text-13 text-ink-muted">Checking the free times…</p>
            ) : slotsFailed ? (
              <div className="flex flex-col items-start gap-2">
                <Alert kind="error" className="w-full">
                  The free times for this day did not load. Check your connection and try again.
                </Alert>
                <Button variant="ghost" size="sm" onClick={() => void loadSlots(date)}>
                  Check the free times again
                </Button>
              </div>
            ) : slots.length === 0 ? (
              <EmptyState
                title="No free times on this day"
                hint={lawyers.length > 1 ? "Try another day, or another lawyer." : "Try another day."}
                action={<UrgentHelpLink href={urgentHref} />}
              />
            ) : (
              <>
                <p className="text-13 font-semibold text-ink">Free times on {dayWords}</p>
                <div className="grid grid-cols-4 gap-[7px]">
                  {slots.map((s) => {
                    const on = slot?.starts_at === s.starts_at;
                    return (
                      <button
                        key={s.starts_at}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSlot(s)}
                        className={cn(
                          "min-h-[46px] rounded-control border text-13 font-semibold",
                          focusRing,
                          on ? "border-brand bg-brand text-brand-on" : "border-edge bg-raised text-ink",
                        )}
                      >
                        <span className="block">
                          {fmtTime(s.starts_at, zonesDiffer ? visitorTz : lawyerTz)}
                          <span className="sr-only"> {zoneLabel(zonesDiffer ? visitorTz : lawyerTz)}</span>
                        </span>
                        {zonesDiffer && (
                          <span className="block text-11 font-normal opacity-75">
                            {fmtTime(s.starts_at, lawyerTz)}
                            <span className="sr-only"> {zoneLabel(lawyerTz)} for your lawyer</span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {/* available_slots() offers nothing under two hours away, for every firm. */}
            <p className="text-13 text-ink-muted">The earliest time you can book is 2 hours from now.</p>
          </>
        )}

        {step === "intake" && form && (
          <>
            <StepTitle>A few details for your lawyer</StepTitle>
            <p className="text-13 leading-relaxed text-ink-muted">
              Your lawyer reads these before you meet. Your answers are private to {firm.name}.
            </p>
            {visibleQuestions.map((q) => (
              <IntakeField
                key={q.key}
                q={q}
                firmName={firm.name}
                value={answers[q.key]}
                files={files[q.key] ?? []}
                onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
                onFiles={(list) => setFiles((f) => ({ ...f, [q.key]: list }))}
              />
            ))}
          </>
        )}

        {step === "review" && service && slot && mode && breakdown && (
          <>
            <StepTitle>{paysNow ? "Check and pay" : "Check and book"}</StepTitle>
            <dl className="flex flex-col gap-3 rounded-card border border-hairline bg-raised px-4 py-[15px] text-13">
              <Row label="Service" value={service.name} />
              <Row label="Lawyer" value={lawyerName(lawyer, firm.name)} />
              <Row label="How you meet" value={modeLabel(mode)} />
              <Row label="Date" value={fmtDate(slot.starts_at, visitorTz)} />
              <Row label="Time" value={timeWords(slot.starts_at)} />
              <Row label="Duration" value={`${service.duration_min} minutes`} />
              {/* A free consultation has no register below it, and never a "₦0" row. */}
              {!priced && <Row label="Fee" value="Nothing to pay" bold />}
            </dl>

            {/* The firm's cancellation text rides in the register, shown open: it is a consequence,
                read before the tap. Paystack's own checkout offers bank transfer, which is where
                people pay twice, so a prepaid booking carries that note too, folded. */}
            {priced ? (
              <BeforeYouPay
                breakdown={breakdown}
                variant="pay"
                title={invoicedAfter ? "What you will pay" : undefined}
                policyText={cancellationText}
                showBankTransferNote={paysNow}
              >
                <p className="text-13 leading-relaxed text-ink-muted">
                  {paysNow
                    ? "Booking holds this time for you for 15 minutes while you pay on Paystack."
                    : `You pay nothing now. Booking creates an invoice for ${payAmount}. You can pay it from Payments in your client portal.`}
                </p>
              </BeforeYouPay>
            ) : cancellationText ? (
              <PlansChange text={cancellationText} />
            ) : null}

            <p className="text-13 leading-relaxed text-ink-muted">{disclaimer}</p>

            {/* Signing in is what the booking needs, so it lives here, and until it is done the
                sign-in form's own button is the one main action on the screen. */}
            {!user ? (
              <div className="flex flex-col gap-2.5 rounded-card border border-hairline bg-raised px-4 py-[15px]">
                <h3 className="text-15 font-semibold text-ink">Sign in to book</h3>
                <p className="text-13 leading-relaxed text-ink-muted">Your choices are kept while you sign in.</p>
                {!authChecked ? (
                  <p className="text-13 text-ink-muted">Checking whether you are signed in…</p>
                ) : (
                  <SignInForms redirectNext={`/${firm.slug}/book?resume=1`} />
                )}
              </div>
            ) : (
              <>
                {signedInHere && (
                  <Alert kind="success">
                    You are signed in.{" "}
                    {needEmail ? "Add your email address and tick both boxes below, then book." : "Tick both boxes below, then book."}
                  </Alert>
                )}

                {needEmail && (
                  <Input
                    label="Email for your receipt"
                    type="email"
                    autoComplete="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    hint="Paystack needs an email address to send your receipt."
                    disabled={locked}
                    required
                  />
                )}

                <fieldset className="flex flex-col gap-3 rounded-card border border-hairline bg-raised px-4 py-[15px]">
                  <legend className="sr-only">Terms and privacy</legend>
                  <label htmlFor="booking-accept-terms" className="flex min-h-11 items-center gap-3 text-13 leading-relaxed text-ink">
                    <input
                      id="booking-accept-terms"
                      name="acceptTerms"
                      type="checkbox"
                      className="size-5 shrink-0"
                      checked={acceptTerms}
                      onChange={(e) => setAcceptTerms(e.target.checked)}
                      disabled={locked}
                    />
                    <span>
                      I accept the{" "}
                      <a
                        href={policyDocumentHref(firm.policies.terms, `/${firm.slug}/terms`)}
                        target="_blank"
                        rel="noreferrer"
                        className={cn("font-medium text-brand underline", focusRing)}
                      >
                        terms of service
                      </a>{" "}
                      (version {termsVersion}).
                    </span>
                  </label>
                  <label htmlFor="booking-accept-privacy" className="flex min-h-11 items-center gap-3 text-13 leading-relaxed text-ink">
                    <input
                      id="booking-accept-privacy"
                      name="acceptPrivacy"
                      type="checkbox"
                      className="size-5 shrink-0"
                      checked={acceptPrivacy}
                      onChange={(e) => setAcceptPrivacy(e.target.checked)}
                      disabled={locked}
                    />
                    <span>
                      I have read the{" "}
                      <a
                        href={policyDocumentHref(firm.policies.privacy, `/${firm.slug}/privacy`)}
                        target="_blank"
                        rel="noreferrer"
                        className={cn("font-medium text-brand underline", focusRing)}
                      >
                        privacy notice
                      </a>{" "}
                      (version {privacyVersion}).
                    </span>
                  </label>
                  <p className="text-13 leading-relaxed text-ink-muted">
                    Both open in a new tab. Your acceptance is recorded with your account when you book.
                  </p>
                </fieldset>
              </>
            )}
          </>
        )}
      </div>

      {(footer || (error && step === "review")) && (
        <div className="flex flex-col gap-2 pt-5">
          {step === "review" && errorBlock}
          {footer}
        </div>
      )}
      {/* The button's label names each step as it runs; this says it to a screen reader too. */}
      <p className="sr-only" aria-live="polite">{phase ? PHASE_LABELS[phase] : ""}</p>
    </div>
  );
}

// --- small pieces ----------------------------------------------------------------

/**
 * "Is it urgent? Get help now": the firm's urgent help page, for someone who cannot wait for a
 * consultation. A quiet text link, never a button, so booking stays the one main action. The
 * booking page uses it too, with firmPath(), so the two read and look the same.
 */
export function UrgentHelpLink({ href, className }: { href: string; className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1 text-13 text-ink-muted", className)}>
      Is it urgent?
      <Link
        href={href}
        className={cn("inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-2", focusRing)}
      >
        Get help now
      </Link>
    </p>
  );
}

/** Online booking cannot happen at all: the reason, and the way to urgent help beside it. */
function CannotBookOnline({ urgentHref, children }: { urgentHref: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-4">
      <Alert kind="info">{children}</Alert>
      <UrgentHelpLink href={urgentHref} />
    </div>
  );
}

/**
 * The firm's cancellation text for a free consultation, which has no "Before you pay" register
 * to carry it. Drawn as the register draws it, so it reads the same either way.
 */
function PlansChange({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-control bg-sunken px-3 py-2.5">
      <p className="text-13 font-semibold text-ink">If plans change</p>
      <p className="text-13 leading-relaxed text-ink">{text}</p>
    </div>
  );
}

function StepTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-heading text-21 font-semibold leading-tight tracking-[-0.01em] text-brand">
      {children}
    </h2>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className={cn("text-right text-ink", bold ? "font-bold" : "font-semibold")}>{value}</dd>
    </div>
  );
}

function IntakeField({
  q, firmName, value, files, onChange, onFiles,
}: {
  q: IntakeQuestion;
  firmName: string;
  value: string | string[] | undefined;
  files: File[];
  onChange: (v: string | string[]) => void;
  onFiles: (list: File[]) => void;
}) {
  const id = `intake-${q.key}`;
  if (q.type === "text") {
    return (
      <Input id={id} label={q.label} hint={q.help} required={q.required} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (q.type === "longtext") {
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-13 font-semibold text-ink">{q.label}</label>
        <textarea id={id} rows={4} maxLength={q.max_length} required={q.required} className={cn(fieldClasses, "min-h-[76px] leading-relaxed")} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
        {q.help && <p className="text-11 text-ink-muted">{q.help}</p>}
      </div>
    );
  }
  // Short option lists read better as chips on a phone than as a stack of
  // radios or a select the thumb has to scroll inside.
  if (q.type === "choice" && (q.options ?? []).length <= 8) {
    const multiple = Boolean(q.multiple);
    const selected = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
    const toggle = (opt: string) => {
      if (!multiple) return onChange(opt);
      onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt]);
    };
    return (
      <fieldset className="space-y-2">
        <legend className="mb-1 text-13 font-semibold text-ink">{q.label}</legend>
        <div className="flex flex-wrap gap-[7px]">
          {(q.options ?? []).map((opt) => (
            <button
              key={opt}
              type="button"
              role={multiple ? "checkbox" : "radio"}
              aria-checked={selected.includes(opt)}
              onClick={() => toggle(opt)}
              className={chipClasses(selected.includes(opt))}
            >
              {opt}
            </button>
          ))}
        </div>
        {q.help && <p className="text-11 text-ink-muted">{q.help}</p>}
      </fieldset>
    );
  }
  if (q.type === "choice" && q.multiple) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-1">
        <legend className="mb-1 text-13 font-semibold text-ink">{q.label}</legend>
        {(q.options ?? []).map((opt) => (
          // The label is the tap target, so it carries the 44px.
          <label key={opt} className="flex min-h-11 items-center gap-3 text-13 text-ink">
            <input
              type="checkbox"
              className="size-5 shrink-0"
              checked={selected.includes(opt)}
              onChange={(e) => onChange(e.target.checked ? [...selected, opt] : selected.filter((v) => v !== opt))}
            />
            {opt}
          </label>
        ))}
        {q.help && <p className="text-11 text-ink-muted">{q.help}</p>}
      </fieldset>
    );
  }
  if (q.type === "choice") {
    return (
      <Select id={id} label={q.label} required={q.required} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose one</option>
        {(q.options ?? []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </Select>
    );
  }
  const many = (q.max_files ?? 1) > 1;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-13 font-semibold text-ink">{q.label}</label>
      {/* The input is hidden and the dashed box is what a thumb taps, so the box wears the focus
          ring when the input has keyboard focus. The input comes first for `peer` to reach it. */}
      <input
        id={id}
        type="file"
        multiple={many}
        accept="application/pdf,image/jpeg,image/png,image/heic,.docx"
        className="peer sr-only"
        aria-describedby={`${id}-hint`}
        onChange={(e) => onFiles(Array.from<File>(e.target.files ?? []).slice(0, q.max_files ?? 1))}
      />
      <label
        htmlFor={id}
        className="flex min-h-[46px] cursor-pointer items-center justify-center gap-2 rounded-control border border-dashed border-edge bg-raised text-13 font-semibold text-brand peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand"
      >
        <Icon name="upload" size={17} />
        {many ? "Choose files" : "Choose a file"}
      </label>
      {files.length > 0 && <p className="text-11 text-ink-muted">Chosen: {files.map((f) => f.name).join(", ")}</p>}
      {q.help && <p className="text-11 text-ink-muted">{q.help}</p>}
      {/* The intake-uploads bucket's own limits: 25 MB, PDF, Word, JPEG, PNG and HEIC. */}
      <p id={`${id}-hint`} className="text-11 text-ink-muted">
        PDF, Word or photos, up to 25 MB each. They go privately to {firmName} when you book.
      </p>
    </div>
  );
}
