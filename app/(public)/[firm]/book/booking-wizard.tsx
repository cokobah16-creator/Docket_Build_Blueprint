"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
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
import { Alert } from "@/components/ui/alert";
import {
  BuildingIcon,
  ChevronLeftIcon,
  ClockIcon,
  PhoneIcon,
  UploadIcon,
  VideoIcon,
  type IconProps,
} from "@/components/ui/icons";
import { startPayment, saveContactEmail } from "@/lib/actions/booking";

// The booking wizard, on the firm's own site.
//
// This screen lives in the public tenant site, not in the phone shell, so it
// wears `brand-*` (the firm's colours from firms.brand) rather than the
// `dk-*` app tokens — but it takes the PWA artboard's geometry: a sticky step
// header with a 3px progress rule, choice cards that gain a primary border and
// a 1px inset ring when chosen, 42px chips, a 5-column day grid of 56px
// buttons and a 4-column slot grid of 46px ones.
//
// The step list is the real one: it grows a "lawyer" step when the firm
// publishes more than one, an "intake" step when the service has a form, and a
// "signin" step for an anonymous visitor. The header counts the steps that
// actually exist rather than the artboard's fixed five.

type Step = "service" | "mode" | "lawyer" | "date" | "slot" | "intake" | "signin" | "review";
type Mode = "virtual" | "in_person" | "phone";
type Answers = Record<string, string | string[]>;
interface SessionUser { id: string; email: string | null; phone: string | null }

const MODE_LABELS: Record<Mode, string> = {
  virtual: "Virtual — video call from your phone or laptop",
  in_person: "In person — at the firm's office",
  phone: "Phone call",
};

const MODE_ICONS: Record<Mode, (p: IconProps) => React.JSX.Element> = {
  virtual: VideoIcon,
  in_person: BuildingIcon,
  phone: PhoneIcon,
};

const STEP_NAMES: Record<Step, string> = {
  service: "Service",
  mode: "Format",
  lawyer: "Lawyer",
  date: "Date",
  slot: "Time",
  intake: "Details",
  signin: "Sign in",
  review: "Review",
};

// The artboard draws the format cards as a title with a line of explanation
// under it. The copy is the one label, split at its dash — nothing new is said.
function splitLabel(label: string): { title: string; hint: string | null } {
  const at = label.indexOf(" — ");
  if (at === -1) return { title: label, hint: null };
  const rest = label.slice(at + 3);
  return { title: label.slice(0, at), hint: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

// 16px, not the artboard's 14: iOS Safari zooms the page when a focused field
// is smaller than that, which on a booking form is a bug, not a detail.
const fieldClasses =
  "w-full rounded-[9px] border border-gray-300 bg-white px-3 py-[11px] text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-brand focus:outline focus:outline-2 focus:outline-brand";

const labelClasses = "block text-[12.5px] font-semibold text-gray-700";

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
    const s: Step[] = ["service", "mode"];
    if (lawyers.length > 1) s.push("lawyer");
    s.push("date", "slot");
    if (form) s.push("intake");
    if (!user) s.push("signin");
    s.push("review");
    return s;
  }, [lawyers.length, form, user]);
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
    setStepIdx(999); // clamps to the last step (review, or signin if still anonymous)
  }, [pendingResume, storageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ serviceId, mode, lawyerId, date, slot, answers }));
    } catch { /* ignore */ }
  }, [storageKey, serviceId, mode, lawyerId, date, slot, answers]);

  // When sign-in completes on the signin step, move on to review.
  useEffect(() => {
    if (user && step === "signin") setStepIdx(steps.indexOf("review"));
  }, [user, step, steps]);

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

  useEffect(() => { if (step === "slot" && date) loadSlots(date); }, [step, date, loadSlots]);

  const dates = useMemo(() => {
    const out: { iso: string; label: string; dow: string; day: string }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.now() + i * 86_400_000);
      out.push({
        iso: isoDateInTz(d, lawyerTz),
        label: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: lawyerTz }).format(d),
        dow: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: lawyerTz }).format(d),
        day: new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: lawyerTz }).format(d),
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
      case "lawyer": return Boolean(lawyerId);
      case "date": return Boolean(date);
      case "slot": return Boolean(slot);
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
      const { data, error: rpcErr } = await supabase.rpc("book_appointment", {
        p_firm: firm.id,
        p_service: service.id,
        p_lawyer: lawyerId,
        p_starts_at: slot.starts_at,
        p_mode: mode,
        p_client_timezone: visitorTz,
        p_intake: form ? { ...answers, ...uploaded } : null,
        p_intake_form: form?.id ?? null,
      });
      if (rpcErr) {
        if (rpcErr.message.includes("slot unavailable")) {
          setSlot(null);
          setStepIdx(steps.indexOf("slot"));
          throw new Error("That time was just taken. Please pick another slot.");
        }
        throw new Error(rpcErr.message);
      }
      const result = data as BookingResult;
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
  const payable = Boolean(service && service.price_minor > 0);

  return (
    <div>
      {/* Step header and progress rule. Full-bleed to the column edges, so it
          runs the width of the page the way it does on the artboard. */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-[#EBE7E0] bg-white/90 backdrop-blur-xl">
        <div className="flex min-h-[50px] items-center gap-2.5 px-2.5 py-1.5">
          <button
            type="button"
            onClick={back}
            disabled={stepIdx === 0 || submitting}
            aria-label="Back a step"
            className={cn(
              "grid h-11 w-11 flex-none place-items-center rounded-full",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              "disabled:opacity-40",
            )}
          >
            <span className="grid h-9 w-9 place-items-center rounded-full border border-gray-200 bg-white text-brand">
              <ChevronLeftIcon size={19} />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-gray-900">{STEP_NAMES[step]}</p>
            <p className="mt-px text-[11px] text-gray-500">
              Step {stepNumber} of {steps.length} · {firm.name}
            </p>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label="Booking progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={stepNumber}
          aria-valuetext={`Step ${stepNumber} of ${steps.length}`}
          className="h-[3px] w-full bg-gray-200"
        >
          <div
            className="h-full bg-brand transition-[width] duration-[250ms] ease-out"
            style={{ width: `${(stepNumber / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-[13px] pb-[22px] pt-4">
        {error && <Alert kind="error">{error}</Alert>}

        {step === "service" && (
          <Section title="What do you need help with?">
            {services.map((s) => (
              <ChoiceCard key={s.id} selected={serviceId === s.id} onClick={() => { setServiceId(s.id); setMode(null); setSlot(null); }}>
                <span className="block text-[14.5px] font-semibold text-gray-900">{s.name}</span>
                {s.description && (
                  <span className="mt-1 block text-[12.5px] leading-[1.45] text-gray-600">{s.description}</span>
                )}
                <span className="mt-1.5 block text-[13px] font-semibold text-brand">
                  {formatMoneyMinor(s.price_minor, s.currency)} · {s.duration_min} minutes
                </span>
              </ChoiceCard>
            ))}
          </Section>
        )}

        {step === "mode" && service && (
          <Section title="How would you like to meet?">
            {(["virtual", "in_person", "phone"] as Mode[])
              .filter((m) => m !== "virtual" || service.virtual_available)
              .map((m) => {
                const { title, hint } = splitLabel(MODE_LABELS[m]);
                const Glyph = MODE_ICONS[m];
                const on = mode === m;
                return (
                  <ChoiceCard key={m} selected={on} onClick={() => setMode(m)}>
                    <span className="flex items-start gap-[11px]">
                      <span
                        className={cn(
                          "grid h-[34px] w-[34px] flex-none place-items-center rounded-lg",
                          on ? "bg-brand text-brand-on" : "bg-gray-100 text-gray-500",
                        )}
                      >
                        <Glyph size={18} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14.5px] font-semibold text-gray-900">{title}</span>
                        {hint && (
                          <span className="mt-[3px] block text-[12.5px] leading-[1.45] text-gray-600">{hint}</span>
                        )}
                      </span>
                    </span>
                  </ChoiceCard>
                );
              })}
          </Section>
        )}

        {step === "lawyer" && (
          <Section title="Who would you like to see?">
            {lawyers.map((l) => (
              <ChoiceCard key={l.id} selected={lawyerId === l.id} onClick={() => { setLawyerId(l.id); setDate(null); setSlot(null); }}>
                <span className="block text-[14.5px] font-semibold text-gray-900">{lawyerName(l, firm.name)}</span>
                {l.title && <span className="mt-1 block text-[12.5px] leading-[1.45] text-gray-600">{l.title}</span>}
              </ChoiceCard>
            ))}
          </Section>
        )}

        {step === "date" && (
          <Section
            title="Pick a day"
            hint={`Times are shown in your timezone (${visitorTz})${visitorTz !== lawyerTz ? ` and the lawyer's (${lawyerTz})` : ""}.`}
          >
            <div className="grid grid-cols-5 gap-[7px]">
              {dates.map((d) => {
                const on = date === d.iso;
                return (
                  <button
                    key={d.iso}
                    type="button"
                    aria-pressed={on}
                    aria-label={d.label}
                    onClick={() => { setDate(d.iso); setSlot(null); }}
                    className={cn(
                      "min-h-[56px] rounded-[9px] border px-1 transition",
                      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                      on ? "border-brand bg-brand text-brand-on" : "border-gray-200 bg-white text-gray-900 hover:border-brand",
                    )}
                  >
                    <span className="block text-[10.5px] uppercase tracking-[0.06em] opacity-[0.72]">{d.dow}</span>
                    <span className="mt-[3px] block text-[17px] font-bold">{d.day}</span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {step === "slot" && (
          <Section title="Pick a time">
            {slotsLoading ? (
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
                        "min-h-[46px] rounded-[9px] border px-1 py-1.5 text-[13px] font-semibold transition",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                        on ? "border-brand bg-brand text-brand-on" : "border-gray-200 bg-white text-gray-900 hover:border-brand",
                      )}
                    >
                      <span className="block">{fmtTime(s.starts_at, visitorTz)}</span>
                      {visitorTz !== lawyerTz && (
                        <span className="block text-[10.5px] font-normal leading-tight opacity-80">
                          {fmtTime(s.starts_at, lawyerTz)} lawyer time
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[11.5px] leading-[1.5] text-gray-500">
              A two-hour lead time, the daily cap and the firm&rsquo;s breaks are already taken out.
            </p>
          </Section>
        )}

        {step === "intake" && form && (
          <Section
            title="A few details for your lawyer"
            hint={`Only what is needed to prepare. Your answers are private to ${firm.name}.`}
          >
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
          </Section>
        )}

        {step === "signin" && (
          <Section title="Sign in to hold your slot" hint="We'll remember your choices while you sign in.">
            {!authChecked ? (
              <p className="text-[12.5px] text-gray-600">Checking your session…</p>
            ) : (
              <SignInForms redirectNext={`/${firm.slug}/book?resume=1`} />
            )}
          </Section>
        )}

        {step === "review" && service && slot && mode && (
          <Section title={payable ? "Review and pay" : "Review and confirm"}>
            <div className="rounded-[12px] border border-gray-200 bg-white px-4 py-[15px]">
              <dl className="flex flex-col gap-3 text-[13.5px]">
                <Row label="Service" value={service.name} />
                <Row label="Lawyer" value={lawyerName(lawyer, firm.name)} />
                <Row label="Format" value={MODE_LABELS[mode]} />
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
                <Row
                  ruled
                  label="Fee"
                  value={`${formatMoneyMinor(service.price_minor, service.currency)}${payable ? " — payable now to confirm" : ""}`}
                />
              </dl>
            </div>

            {payable && (
              <div className="flex items-start gap-[9px] rounded-[10px] border border-[#E3D9C4] bg-[#FBF7EE] px-[13px] py-[11px]">
                <ClockIcon size={16} className="mt-px flex-none text-[#7A6A46]" />
                <p className="text-[12px] leading-[1.45] text-[#5C4F35]">
                  Your slot is held for <strong className="font-semibold">15 minutes</strong> while you pay. The fee
                  settles to {firm.name}&rsquo;s own account — Docket never holds it.
                </p>
              </div>
            )}

            {needEmail && (
              <div className="space-y-1.5">
                <label htmlFor="booking-contact-email" className={labelClasses}>
                  Email for your receipt
                </label>
                <input
                  id="booking-contact-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  aria-describedby="booking-contact-email-hint"
                  className={fieldClasses}
                />
                <p id="booking-contact-email-hint" className="text-[11.5px] text-gray-500">
                  Required by the payment provider.
                </p>
              </div>
            )}

            {firm.policies.cancellation?.text ? (
              <p className="text-[11.5px] leading-[1.5] text-gray-500">{String(firm.policies.cancellation.text)}</p>
            ) : null}
            {firm.policies.disclaimer?.text ? (
              <p className="text-[11.5px] leading-[1.5] text-gray-500">{String(firm.policies.disclaimer.text)}</p>
            ) : null}
          </Section>
        )}
      </div>

      {step !== "signin" && (
        <div className="pb-[22px]">
          {step === "review" ? (
            <button
              type="button"
              onClick={submit}
              disabled={submitting || (needEmail && !contactEmail)}
              className={ctaClasses}
            >
              {submitting ? "Holding your slot…" : payable ? "Confirm and pay" : "Confirm booking"}
            </button>
          ) : (
            <button type="button" onClick={next} disabled={!canProceed} className={ctaClasses}>
              Continue
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// --- small pieces ----------------------------------------------------------------

const ctaClasses = cn(
  "inline-flex w-full min-h-[50px] items-center justify-center gap-2 rounded-[10px]",
  "bg-brand px-5 text-[15px] font-semibold text-brand-on transition",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
  "disabled:opacity-50",
);

/** A step: the 20px heading in the firm's face, an optional line of help, then the body. */
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[13px]">
      <h2 className="font-heading text-[20px] font-semibold leading-[1.25] tracking-[-0.01em] text-brand">
        {title}
      </h2>
      {hint && <p className="text-[12px] leading-[1.5] text-gray-500">{hint}</p>}
      {children}
    </section>
  );
}

/**
 * The artboard's choice card: a full-width white panel at an 11px radius that
 * takes the firm's primary on its border and a 1px inset ring when chosen.
 * `aria-pressed` carries the choice for anyone who cannot see the ring.
 */
function ChoiceCard({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "block w-full rounded-[11px] border bg-white px-[15px] py-[14px] text-left transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        selected ? "border-brand ring-1 ring-inset ring-brand" : "border-gray-200 hover:border-brand",
      )}
    >
      {children}
    </button>
  );
}

/** A 42px pill. Selection is a fill plus `aria-pressed`, never the colour alone. */
function Chip({ selected, onClick, className, children }: {
  selected: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-[42px] items-center justify-center rounded-full border px-3.5 text-[12.5px] font-medium transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        selected ? "border-brand bg-brand text-brand-on" : "border-gray-300 bg-white text-gray-700 hover:border-brand",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Row({ label, value, ruled }: { label: string; value: string; ruled?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", ruled && "border-t border-gray-100 pt-3")}>
      <dt className="flex-none text-gray-500">{label}</dt>
      <dd className="text-right font-semibold text-gray-900">{value}</dd>
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
  const helpId = `${id}-help`;

  if (q.type === "text") {
    return (
      <div className="space-y-2">
        <label htmlFor={id} className={labelClasses}>{q.label}</label>
        <input
          id={id}
          required={q.required}
          aria-describedby={q.help ? helpId : undefined}
          className={fieldClasses}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
        {q.help && <p id={helpId} className="text-[11.5px] text-gray-500">{q.help}</p>}
      </div>
    );
  }

  if (q.type === "longtext") {
    return (
      <div className="space-y-2">
        <label htmlFor={id} className={labelClasses}>{q.label}</label>
        <textarea
          id={id}
          rows={4}
          maxLength={q.max_length}
          required={q.required}
          aria-describedby={q.help ? helpId : undefined}
          className={cn(fieldClasses, "min-h-[76px] leading-[1.5]")}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
        {q.help && <p id={helpId} className="text-[11.5px] text-gray-500">{q.help}</p>}
      </div>
    );
  }

  if (q.type === "choice" && q.multiple) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="min-w-0" aria-describedby={q.help ? helpId : undefined}>
        <legend className={cn(labelClasses, "mb-2")}>{q.label}</legend>
        <div className="flex flex-wrap gap-[7px]">
          {(q.options ?? []).map((opt) => (
            <Chip
              key={opt}
              selected={selected.includes(opt)}
              onClick={() =>
                onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt])
              }
            >
              {opt}
            </Chip>
          ))}
        </div>
        {q.help && <p id={helpId} className="mt-2 text-[11.5px] text-gray-500">{q.help}</p>}
      </fieldset>
    );
  }

  if (q.type === "choice") {
    const current = typeof value === "string" ? value : "";
    const options = q.options ?? [];
    // Two options read as one segmented row on the artboard; more than two wrap.
    const wide = options.length === 2;
    return (
      <fieldset className="min-w-0" aria-describedby={q.help ? helpId : undefined}>
        <legend className={cn(labelClasses, "mb-2")}>{q.label}</legend>
        <div className="flex flex-wrap gap-[7px]">
          {options.map((opt) => (
            <Chip
              key={opt}
              selected={current === opt}
              className={wide ? "flex-1" : undefined}
              onClick={() => onChange(current === opt ? "" : opt)}
            >
              {opt}
            </Chip>
          ))}
        </div>
        {q.help && <p id={helpId} className="mt-2 text-[11.5px] text-gray-500">{q.help}</p>}
      </fieldset>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className={labelClasses}>{q.label}</label>
      <div className="flex min-h-[46px] items-center gap-2.5 rounded-[9px] border border-dashed border-[#C3C8D0] bg-white px-3 py-2.5">
        <UploadIcon size={17} className="flex-none text-brand" />
        <input
          id={id}
          type="file"
          multiple={(q.max_files ?? 1) > 1}
          accept="application/pdf,image/jpeg,image/png,image/heic,.docx"
          className={cn(
            "block w-full text-[12.5px] text-gray-700",
            "file:mr-3 file:min-h-[30px] file:rounded-full file:border file:border-gray-300",
            "file:bg-white file:px-3 file:text-[12.5px] file:font-semibold file:text-brand",
          )}
          onChange={(e) => onFiles(Array.from<File>(e.target.files ?? []).slice(0, q.max_files ?? 1))}
        />
      </div>
      {files.length > 0 && <p className="text-[11.5px] text-gray-500">{files.map((f) => f.name).join(", ")}</p>}
      <p className="text-[11.5px] text-gray-500">PDF or images, up to 25 MB each. Uploaded securely after you sign in.</p>
    </div>
  );
}
