"use client";

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
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { bookAppointment, startPayment, saveContactEmail } from "@/lib/actions/booking";

type Step = "service" | "mode" | "lawyer" | "date" | "slot" | "intake" | "signin" | "review";
type Mode = "virtual" | "in_person" | "phone";
type Answers = Record<string, string | string[]>;
interface SessionUser { id: string; email: string | null; phone: string | null }

const MODE_LABELS: Record<Mode, string> = {
  virtual: "Virtual — video call from your phone or laptop",
  in_person: "In person — at the firm's office",
  phone: "Phone call",
};

const fieldClasses =
  "w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-base text-gray-900 " +
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
    const out: { iso: string; label: string }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.now() + i * 86_400_000);
      out.push({
        iso: isoDateInTz(d, lawyerTz),
        label: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: lawyerTz }).format(d),
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
          setStepIdx(steps.indexOf("slot"));
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

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-2 text-xs text-gray-500" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s} className={i === stepIdx ? "font-semibold text-brand" : i < stepIdx ? "text-gray-700" : ""}>
            {i + 1}. {{ service: "Service", mode: "Format", lawyer: "Lawyer", date: "Date", slot: "Time", intake: "Details", signin: "Sign in", review: "Review" }[s]}
          </li>
        ))}
      </ol>

      {error && <Alert kind="error">{error}</Alert>}

      {step === "service" && (
        <Section title="What do you need help with?">
          <div className="grid gap-3">
            {services.map((s) => (
              <ChoiceCard key={s.id} selected={serviceId === s.id} onClick={() => { setServiceId(s.id); setMode(null); setSlot(null); }}>
                <p className="font-medium text-gray-900">{s.name}</p>
                {s.description && <p className="mt-1 text-sm text-gray-600">{s.description}</p>}
                <p className="mt-1 text-sm font-medium text-brand">
                  {formatMoneyMinor(s.price_minor, s.currency)} · {s.duration_min} minutes
                </p>
              </ChoiceCard>
            ))}
          </div>
        </Section>
      )}

      {step === "mode" && service && (
        <Section title="How would you like to meet?">
          <div className="grid gap-3">
            {(["virtual", "in_person", "phone"] as Mode[])
              .filter((m) => m !== "virtual" || service.virtual_available)
              .map((m) => (
                <ChoiceCard key={m} selected={mode === m} onClick={() => setMode(m)}>
                  <p className="font-medium text-gray-900">{MODE_LABELS[m]}</p>
                </ChoiceCard>
              ))}
          </div>
        </Section>
      )}

      {step === "lawyer" && (
        <Section title="Who would you like to see?">
          <div className="grid gap-3">
            {lawyers.map((l) => (
              <ChoiceCard key={l.id} selected={lawyerId === l.id} onClick={() => { setLawyerId(l.id); setDate(null); setSlot(null); }}>
                <p className="font-medium text-gray-900">{lawyerName(l, firm.name)}</p>
                {l.title && <p className="text-sm text-gray-600">{l.title}</p>}
              </ChoiceCard>
            ))}
          </div>
        </Section>
      )}

      {step === "date" && (
        <Section title="Pick a day" hint={`Times are shown in your timezone (${visitorTz})${visitorTz !== lawyerTz ? ` and the lawyer's (${lawyerTz})` : ""}.`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {dates.map((d) => (
              <button
                key={d.iso}
                type="button"
                onClick={() => { setDate(d.iso); setSlot(null); }}
                className={`rounded-lg border px-3 py-3 text-sm ${date === d.iso ? "border-brand bg-brand text-brand-on" : "border-gray-300 bg-white text-gray-800 hover:border-brand"}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </Section>
      )}

      {step === "slot" && (
        <Section title="Pick a time">
          {slotsLoading ? (
            <p className="text-sm text-gray-600">Checking availability…</p>
          ) : slots.length === 0 ? (
            <Alert kind="info">No free times on this day. Try another day.</Alert>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {slots.map((s) => (
                <button
                  key={s.starts_at}
                  type="button"
                  onClick={() => setSlot(s)}
                  className={`rounded-lg border px-3 py-3 text-sm ${slot?.starts_at === s.starts_at ? "border-brand bg-brand text-brand-on" : "border-gray-300 bg-white text-gray-800 hover:border-brand"}`}
                >
                  <span className="block font-medium">{fmtTime(s.starts_at, visitorTz)}</span>
                  {visitorTz !== lawyerTz && (
                    <span className="block text-xs opacity-80">{fmtTime(s.starts_at, lawyerTz)} lawyer time</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </Section>
      )}

      {step === "intake" && form && (
        <Section title="A few details for your lawyer" hint="Only what's needed to prepare. Your answers are private to the firm.">
          <div className="space-y-4">
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
          </div>
        </Section>
      )}

      {step === "signin" && (
        <Section title="Sign in to hold your slot" hint="We'll remember your choices while you sign in.">
          {!authChecked ? (
            <p className="text-sm text-gray-600">Checking your session…</p>
          ) : (
            <SignInForms redirectNext={`/${firm.slug}/book?resume=1`} />
          )}
        </Section>
      )}

      {step === "review" && service && slot && mode && (
        <Section title="Review and confirm">
          <dl className="space-y-3 text-sm">
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
            <Row label="Fee" value={`${formatMoneyMinor(service.price_minor, service.currency)}${service.price_minor > 0 ? " — payable now to confirm" : ""}`} />
          </dl>
          {firm.policies.cancellation?.text ? (
            <p className="mt-4 text-xs text-gray-500">{String(firm.policies.cancellation.text)}</p>
          ) : null}
          {firm.policies.disclaimer?.text ? (
            <p className="mt-2 text-xs text-gray-500">{String(firm.policies.disclaimer.text)}</p>
          ) : null}
          {needEmail && (
            <div className="mt-4">
              <Input
                label="Email for your receipt"
                type="email"
                autoComplete="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                hint="Required by the payment provider."
                required
              />
            </div>
          )}
        </Section>
      )}

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={back} disabled={stepIdx === 0 || submitting}>
          Back
        </Button>
        {step === "review" ? (
          <Button size="lg" onClick={submit} disabled={submitting || (needEmail && !contactEmail)}>
            {submitting ? "Holding your slot…" : service && service.price_minor > 0 ? "Confirm and pay" : "Confirm booking"}
          </Button>
        ) : step === "signin" ? null : (
          <Button size="lg" onClick={next} disabled={!canProceed}>
            Continue
          </Button>
        )}
      </div>
      <p className="text-xs text-gray-400">Step {stepNumber} of {steps.length}</p>
    </div>
  );
}

// --- small pieces ----------------------------------------------------------------

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {hint && <p className="mb-4 text-sm text-gray-500">{hint}</p>}
        {children}
      </CardBody>
    </Card>
  );
}

function ChoiceCard({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-lg border p-4 text-left transition ${selected ? "border-brand ring-2 ring-brand" : "border-gray-300 bg-white hover:border-brand"}`}
    >
      {children}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-900">{value}</dd>
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
        <label htmlFor={id} className="block text-sm font-medium text-gray-800">{q.label}</label>
        <textarea id={id} rows={4} maxLength={q.max_length} required={q.required} className={fieldClasses} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
        {q.help && <p className="text-sm text-gray-500">{q.help}</p>}
      </div>
    );
  }
  if (q.type === "choice" && q.multiple) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-800">{q.label}</legend>
        {(q.options ?? []).map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="h-4 w-4"
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
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">{q.label}</label>
      <input
        id={id}
        type="file"
        multiple={(q.max_files ?? 1) > 1}
        accept="application/pdf,image/jpeg,image/png,image/heic,.docx"
        className="block w-full text-sm text-gray-700"
        onChange={(e) => onFiles(Array.from<File>(e.target.files ?? []).slice(0, q.max_files ?? 1))}
      />
      {files.length > 0 && <p className="text-xs text-gray-500">{files.map((f) => f.name).join(", ")}</p>}
      <p className="text-xs text-gray-500">PDF or images, up to 25 MB each. Uploaded securely after you sign in.</p>
    </div>
  );
}
