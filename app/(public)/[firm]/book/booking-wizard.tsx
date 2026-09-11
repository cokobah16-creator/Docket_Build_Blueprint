"use client";

// The booking wizard, folded for the phone.
//
// The flow used to be eight conditional steps — service, format, lawyer, date,
// slot, intake, sign-in, review — which is a lot of "Continue" on a phone. It
// is now five, by putting the choices that belong together on one screen:
// lawyer sits with the day and time it constrains, and signing in happens on
// the review screen, next to the thing it is for. Nothing was dropped.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { formatMoneyMinor } from "@/lib/money";
import type {
  AppointmentSlot,
  BookingResult,
  FirmPublic,
  IntakeForm,
  IntakeQuestion,
  LawyerPublic,
  ServiceRow,
} from "@/lib/db/types";
import { SignInForms } from "@/components/auth/sign-in-forms";
import { Button } from "@/components/ui/button";
import { Input, Select, chipClasses, choiceCardClasses } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { bookAppointment, startPayment, saveContactEmail } from "@/lib/actions/booking";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { startPayment, saveContactEmail } from "@/lib/actions/booking";

type Step = "service" | "mode" | "when" | "intake" | "review";
type Mode = "virtual" | "in_person" | "phone";
type Answers = Record<string, string | string[]>;
interface SessionUser { id: string; email: string | null; phone: string | null }

const STEP_TITLES: Record<Step, string> = {
  service: "Service",
  mode: "Format",
  when: "Date & time",
  intake: "Details",
  review: "Review",
};

const MODES: Record<Mode, { label: string; hint: string; icon: IconName }> = {
  virtual: {
    label: "Virtual",
    hint: "Video call from your phone — audio-only if the network is weak.",
    icon: "video",
  },
  in_person: { label: "In person", hint: "At the firm's office.", icon: "building" },
  phone: { label: "Phone call", hint: "A call on the number you signed in with.", icon: "phone" },
};

const fieldClasses =
  "w-full rounded-[9px] border border-gray-300 bg-white px-3 py-[11px] text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-brand focus:outline focus:outline-2 focus:outline-brand";

function isoDateInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: tz }).format(new Date(iso));
}
function fmtDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: tz }).format(new Date(iso));
}
function lawyerName(l: LawyerPublic | undefined, firmName: string): string {
  return l?.full_name ?? `${firmName} lawyer`;
}
function isVisible(q: IntakeQuestion, answers: Answers): boolean {
  if (!q.show_if) return true;
  const v = answers[q.show_if.question];
  return Array.isArray(v) ? v.includes(q.show_if.equals) : v === q.show_if.equals;
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

  const [serviceId, setServiceId] = useState<string | null>(
    services.find((s) => s.slug === initialServiceSlug)?.id ?? null,
  );
  const [mode, setMode] = useState<Mode | null>(null);
  const [lawyerId, setLawyerId] = useState<string | null>(
    lawyers.find((l) => l.id === initialLawyerId)?.id ?? (lawyers.length === 1 ? lawyers[0]!.id : null),
  );
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState<AppointmentSlot | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profileEmail, setProfileEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [stepIdx, setStepIdx] = useState(0);
  const [pendingResume, setPendingResume] = useState(resume);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const service = services.find((s) => s.id === serviceId);
  const lawyer = lawyers.find((l) => l.id === lawyerId);
  const form = service ? forms.find((f) => f.service_id === service.id) ?? forms.find((f) => f.service_id === null) : undefined;
  const lawyerTz = lawyer?.timezone ?? firm.timezone;

  const steps = useMemo<Step[]>(() => {
    const s: Step[] = ["service", "mode", "when"];
    if (form) s.push("intake");
    s.push("review");
    return s;
  }, [form]);
  const step = steps[Math.min(stepIdx, steps.length - 1)]!;

  // --- session ---------------------------------------------------------------
  useEffect(() => {
    if (!supabase) { setAuthChecked(true); return; }
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      const u = data.user;
      setUser(u ? { id: u.id, email: u.email ?? null, phone: u.phone ?? null } : null);
      if (u) {
        const { data: p } = await supabase.from("profiles").select("email").eq("id", u.id).maybeSingle();
        if (active) setProfileEmail((p as { email: string | null } | null)?.email ?? null);
      }
      setAuthChecked(true);
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      setUser(u ? { id: u.id, email: u.email ?? null, phone: u.phone ?? null } : null);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [supabase]);

  // --- persistence across the magic-link round trip ----------------------
  useEffect(() => {
    if (!pendingResume) return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as {
          serviceId: string | null; mode: Mode | null; lawyerId: string | null;
          date: string | null; slot: AppointmentSlot | null; answers: Answers;
        };
        setServiceId(saved.serviceId); setMode(saved.mode); setLawyerId(saved.lawyerId);
        setDate(saved.date); setSlot(saved.slot); setAnswers(saved.answers ?? {});
      }
    } catch { /* ignore */ }
    setPendingResume(false);
    setStepIdx(999); // clamps to the last step (review)
  }, [pendingResume, storageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ serviceId, mode, lawyerId, date, slot, answers }));
    } catch { /* ignore */ }
  }, [storageKey, serviceId, mode, lawyerId, date, slot, answers]);

  // --- slots -------------------------------------------------------------------
  const loadSlots = useCallback(async (d: string) => {
    if (!supabase || !serviceId || !lawyerId) return;
    setSlotsLoading(true);
    setSlots([]);
    const { data, error: err } = await supabase.rpc("available_slots", {
      p_firm: firm.id, p_lawyer: lawyerId, p_service: serviceId, p_date: d,
    });
    setSlotsLoading(false);
    if (err) { setError(err.message); return; }
    setSlots((data ?? []) as AppointmentSlot[]);
  }, [supabase, serviceId, lawyerId, firm.id]);

  // Day and time are one screen now, so the slots load as soon as a day is
  // picked rather than on the way to a separate step.
  useEffect(() => { if (step === "when" && date) loadSlots(date); }, [step, date, loadSlots]);

  const dates = useMemo(() => {
    const out: { iso: string; dow: string; num: string }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.now() + i * 86_400_000);
      out.push({
        iso: isoDateInTz(d, lawyerTz),
        dow: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: lawyerTz }).format(d),
        num: new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: lawyerTz }).format(d),
      });
    }
    return out;
  }, [lawyerTz]);

  // --- navigation --------------------------------------------------------------
  const visibleQuestions = form ? form.schema.questions.filter((q) => isVisible(q, answers)) : [];
  const canProceed = (() => {
    switch (step) {
      case "service": return Boolean(service);
      case "mode": return Boolean(mode);
      case "when": return Boolean(lawyerId && date && slot);
      case "intake":
        return visibleQuestions.every((q) => {
          if (!q.required) return true;
          if (q.type === "file") return true;
          const v = answers[q.key];
          return Array.isArray(v) ? v.length > 0 : Boolean(v && v.trim());
        });
      default: return true;
    }
  })();

  const next = () => { setError(null); setStepIdx((i) => Math.min(i + 1, steps.length - 1)); };
  const back = () => { setError(null); setStepIdx((i) => Math.max(i - 1, 0)); };

  // --- submit --------------------------------------------------------------------
  const needEmail = Boolean(user && !user.email && !profileEmail);

  async function submit() {
    if (!supabase || !user || !service || !lawyerId || !slot || !mode) return;
    setSubmitting(true);
    setError(null);
    try {
      if (needEmail) {
        const r = await saveContactEmail(contactEmail);
        if (r?.error) throw new Error(r.error);
      }
      const uploaded: Record<string, string[]> = {};
      for (const [key, list] of Object.entries(files)) {
        const paths: string[] = [];
        for (const [i, file] of list.entries()) {
          const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
          const path = `${firm.id}/${user.id}/${Date.now()}-${i}-${safe}`;
          const { error: upErr } = await supabase.storage.from("intake-uploads").upload(path, file);
          if (upErr) throw new Error(`Upload failed for ${file.name}: ${upErr.message}`);
          paths.push(path);
        }
        uploaded[key] = paths;
      }
      // Through the server action, not straight at the RPC. The action is where the booking rate
      // limit is applied and where the funnel's "booking started" is recorded — calling the RPC
      // from here would skip both, which is exactly what used to happen.
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
      if ("error" in booked) {
        if (booked.error.includes("slot unavailable")) {
          setSlot(null);
          setStepIdx(steps.indexOf("when"));
          throw new Error("That time was just taken. Please pick another slot.");
        }
        throw new Error(booked.error);
      }
      const result = booked.booking;
      try { sessionStorage.removeItem(storageKey); } catch { /* ignore */ }
      if (result.status === "awaiting_payment") {
        const r = await startPayment(result.appointment_id);
        if (r?.error) throw new Error(r.error);
      } else {
        router.push(`/app/appointments/${result.appointment_id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  // --- render --------------------------------------------------------------------
  if (!supabase) {
    return <Alert kind="warning" title="Not configured">Booking is not available yet.</Alert>;
  }
  if (services.length === 0) {
    return <Alert kind="info">Online booking opens once the firm publishes its services.</Alert>;
  }
  if (lawyers.length === 0) {
    return <Alert kind="info">Online booking opens once the firm publishes lawyer availability. Please contact the firm directly.</Alert>;
  }

  const stepNumber = stepIdx + 1;
  const feeMinor = service?.price_minor ?? 0;

  return (
    <div>
      <header className="sticky top-0 z-20 -mx-4 flex min-h-[50px] items-center gap-2.5 border-b border-[#EBE7E0] bg-white/[0.92] px-3.5 py-2.5 backdrop-blur-xl">
        <button
          type="button"
          onClick={back}
          disabled={stepIdx === 0 || submitting}
          aria-label="Back a step"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-gray-200 bg-white text-brand disabled:opacity-40"
        >
          <Icon name="chevron-left" size={19} strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-gray-900">{STEP_TITLES[step]}</p>
          <p className="mt-px truncate text-[11px] text-gray-500">
            Step {stepNumber} of {steps.length} · {firm.name}
          </p>
        </div>
      </header>
      <div className="-mx-4 h-[3px] bg-gray-200" aria-hidden="true">
        <div
          className="h-full bg-brand transition-[width] duration-300"
          style={{ width: `${(stepNumber / steps.length) * 100}%` }}
        />
      </div>

      <div className="flex flex-col gap-3 pt-4">
        {error && <Alert kind="error">{error}</Alert>}

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
                <span className="block text-[14.5px] font-semibold text-gray-900">{s.name}</span>
                {s.description && <span className="mt-1 block text-[12.5px] leading-[1.45] text-gray-600">{s.description}</span>}
                <span className="mt-1.5 block text-[13px] font-semibold text-brand">
                  {formatMoneyMinor(s.price_minor, s.currency)} · {s.duration_min} minutes
                </span>
              </button>
            ))}
          </>
        )}

        {step === "mode" && service && (
          <>
            <StepTitle>How would you like to meet?</StepTitle>
            {(["virtual", "in_person", "phone"] as Mode[])
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
                          "grid size-[34px] shrink-0 place-items-center rounded-lg",
                          on ? "bg-brand text-brand-on" : "bg-gray-100 text-gray-500",
                        )}
                      >
                        <Icon name={MODES[m].icon} size={18} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14.5px] font-semibold text-gray-900">{MODES[m].label}</span>
                        <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-gray-600">{MODES[m].hint}</span>
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
            <p className="text-xs leading-relaxed text-gray-500">
              Times are shown in your timezone ({visitorTz})
              {visitorTz !== lawyerTz ? `, and the lawyer's (${lawyerTz}) under each` : ", the same as the lawyer's"}.
              The slot is held for fifteen minutes while you pay.
            </p>

            {/* The lawyer decides which slots exist, so the choice sits here. */}
            {lawyers.length > 1 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-[12.5px] font-semibold text-gray-700">Who would you like to see?</legend>
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

            <div className="-mx-4 grid grid-flow-col justify-start gap-[7px] overflow-x-auto px-4 pb-0.5">
              {dates.map((d) => {
                const on = date === d.iso;
                return (
                  <button
                    key={d.iso}
                    type="button"
                    aria-pressed={on}
                    onClick={() => { setDate(d.iso); setSlot(null); }}
                    className={cn(
                      "min-h-14 w-[62px] rounded-[9px] border",
                      on ? "border-brand bg-brand text-brand-on" : "border-gray-200 bg-white text-gray-900",
                    )}
                  >
                    <span className="block text-[10.5px] uppercase tracking-[0.06em] opacity-70">{d.dow}</span>
                    <span className="mt-0.5 block text-[17px] font-bold">{d.num}</span>
                  </button>
                );
              })}
            </div>

            {!date ? (
              <p className="text-[12.5px] text-gray-500">Pick a day to see the free times.</p>
            ) : slotsLoading ? (
              <p className="text-[12.5px] text-gray-600">Checking availability…</p>
            ) : slots.length === 0 ? (
              <Alert kind="info">No free times on this day. Try another day.</Alert>
            ) : (
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
                        "min-h-[46px] rounded-[9px] border text-[13px] font-semibold",
                        on ? "border-brand bg-brand text-brand-on" : "border-gray-200 bg-white text-gray-900",
                      )}
                    >
                      <span className="block">{fmtTime(s.starts_at, visitorTz)}</span>
                      {visitorTz !== lawyerTz && (
                        <span className="block text-[10px] font-normal opacity-75">{fmtTime(s.starts_at, lawyerTz)}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[11.5px] text-gray-500">
              Two-hour lead time, the daily cap and the firm&apos;s breaks are already taken out.
            </p>
          </>
        )}

        {step === "intake" && form && (
          <>
            <StepTitle>A few details for your lawyer</StepTitle>
            <p className="text-xs leading-relaxed text-gray-500">
              Only what is needed to prepare. Your answers are private to {firm.name}.
            </p>
            {visibleQuestions.map((q) => (
              <IntakeField
                key={q.key}
                q={q}
                value={answers[q.key]}
                files={files[q.key] ?? []}
                onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
                onFiles={(list) => setFiles((f) => ({ ...f, [q.key]: list }))}
              />
            ))}
          </>
        )}

        {step === "review" && service && slot && mode && (
          <>
            <StepTitle>Review and {feeMinor > 0 ? "pay" : "confirm"}</StepTitle>
            <dl className="flex flex-col gap-3 rounded-card border border-gray-200 bg-white px-4 py-[15px] text-[13.5px]">
              <Row label="Service" value={service.name} />
              <Row label="Lawyer" value={lawyerName(lawyer, firm.name)} />
              <Row label="Format" value={MODES[mode].label} />
              <Row label="Date" value={fmtDate(slot.starts_at, visitorTz)} />
              <Row
                label="Time"
                value={
                  visitorTz === lawyerTz
                    ? `${fmtTime(slot.starts_at, visitorTz)} (${visitorTz})`
                    : `${fmtTime(slot.starts_at, visitorTz)} your time · ${fmtTime(slot.starts_at, lawyerTz)} lawyer's time`
                }
              />
              <Row label="Duration" value={`${service.duration_min} minutes`} />
              <div className="border-t border-gray-100 pt-3">
                <Row label="Fee" value={formatMoneyMinor(service.price_minor, service.currency)} bold />
              </div>
            </dl>

            {feeMinor > 0 && (
              <Alert kind="notice">
                Your slot is held for <strong>15 minutes</strong> while you pay. The fee settles to{" "}
                {firm.name}&apos;s own account — Docket never holds it.
              </Alert>
            )}

            {/* Signing in is what the confirm button needs, so it lives beside it. */}
            {!user && (
              <div className="flex flex-col gap-2.5 rounded-card border border-gray-200 bg-white px-4 py-[15px]">
                <p className="text-[13.5px] font-semibold text-gray-900">Sign in to hold your slot</p>
                <p className="text-xs leading-relaxed text-gray-500">
                  Your choices above are remembered while you sign in.
                </p>
                {!authChecked ? (
                  <p className="text-[12.5px] text-gray-600">Checking your session…</p>
                ) : (
                  <SignInForms redirectNext={`/${firm.slug}/book?resume=1`} />
                )}
              </div>
            )}

            {needEmail && (
              <Input
                label="Email for your receipt"
                type="email"
                autoComplete="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                hint="Required by the payment provider."
                required
              />
            )}

            {firm.policies.cancellation?.text ? (
              <p className="text-[11.5px] leading-relaxed text-gray-500">{String(firm.policies.cancellation.text)}</p>
            ) : null}
            {firm.policies.disclaimer?.text ? (
              <p className="text-[11.5px] leading-relaxed text-gray-500">{String(firm.policies.disclaimer.text)}</p>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-gray-500">
                Submitting an inquiry or booking a consultation does not create a lawyer-client
                relationship. Formal legal advice and representation begin only on a signed engagement.
              </p>
            )}
          </>
        )}
      </div>

      <div className="pt-5">
        {step === "review" ? (
          <Button
            size="lg"
            className="w-full"
            onClick={submit}
            disabled={!user || submitting || (needEmail && !contactEmail)}
          >
            {submitting
              ? "Holding your slot…"
              : !user
                ? "Sign in to confirm"
                : feeMinor > 0
                  ? `Confirm and pay ${formatMoneyMinor(service!.price_minor, service!.currency)}`
                  : "Confirm booking"}
          </Button>
        ) : (
          <Button size="lg" className="w-full" onClick={next} disabled={!canProceed}>
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

// --- small pieces ----------------------------------------------------------------

function StepTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-heading text-[20px] font-semibold leading-tight tracking-[-0.01em] text-brand">
      {children}
    </h2>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className={cn("text-right text-gray-900", bold ? "font-bold" : "font-semibold")}>{value}</dd>
    </div>
  );
}

function IntakeField({
  q, value, files, onChange, onFiles,
}: {
  q: IntakeQuestion;
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
        <label htmlFor={id} className="block text-[12.5px] font-semibold text-gray-700">{q.label}</label>
        <textarea id={id} rows={4} maxLength={q.max_length} required={q.required} className={cn(fieldClasses, "min-h-[76px] leading-relaxed")} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
        {q.help && <p className="text-[11.5px] text-gray-500">{q.help}</p>}
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
        <legend className="mb-1 text-[12.5px] font-semibold text-gray-700">{q.label}</legend>
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
        {q.help && <p className="text-[11.5px] text-gray-500">{q.help}</p>}
      </fieldset>
    );
  }
  if (q.type === "choice" && q.multiple) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-2">
        <legend className="text-[12.5px] font-semibold text-gray-700">{q.label}</legend>
        {(q.options ?? []).map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-[13.5px] text-gray-700">
            <input
              type="checkbox"
              className="size-4"
              checked={selected.includes(opt)}
              onChange={(e) => onChange(e.target.checked ? [...selected, opt] : selected.filter((v) => v !== opt))}
            />
            {opt}
          </label>
        ))}
      </fieldset>
    );
  }
  if (q.type === "choice") {
    return (
      <Select id={id} label={q.label} required={q.required} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {(q.options ?? []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </Select>
    );
  }
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[12.5px] font-semibold text-gray-700">{q.label}</label>
      <label
        htmlFor={id}
        className="flex min-h-[46px] cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-dashed border-gray-300 bg-white text-[13px] font-semibold text-brand"
      >
        <Icon name="upload" size={17} />
        Choose files
      </label>
      <input
        id={id}
        type="file"
        multiple={(q.max_files ?? 1) > 1}
        accept="application/pdf,image/jpeg,image/png,image/heic,.docx"
        className="sr-only"
        onChange={(e) => onFiles(Array.from<File>(e.target.files ?? []).slice(0, q.max_files ?? 1))}
      />
      {files.length > 0 && <p className="text-[11.5px] text-gray-600">{files.map((f) => f.name).join(", ")}</p>}
      <p className="text-[11.5px] text-gray-500">PDF or images, up to 25 MB each. Uploaded securely after you sign in.</p>
    </div>
  );
}
