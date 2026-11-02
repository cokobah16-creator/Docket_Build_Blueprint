"use client";

// What is still needed before the consultation, as the database computed it, and the one thing
// the client can answer here: the questions the firm's form still requires. Documents are
// uploaded in Documents below; the fee is paid in the pay panel above, or from its invoice when
// there is no panel; terms are accepted where the app asks for them. A conflict item says only
// that the firm has its own checks to finish.
//
// The database decides WHAT is needed and whether it is in. The words are this screen's:
// appointment_readiness() labels its items for the console ("Invoice AK-INV-0188 is issued."),
// so each kind is said here in the client's words, with the firm by name (docs/VOICE.md, rules 2
// and 4). An item of a kind this file does not know keeps the database's own label.
//
// The cancel confirmation lives in this file too. It is the consultation screen's other piece
// that needs the browser (a dialog has to open and close), and this is that screen's client
// module.

import { useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { amendIntakeAnswers } from "@/lib/actions/checkin";
import { userErrorMessage } from "@/lib/user-error-message";
import { cn } from "@/lib/cn";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import type { AppointmentReadiness, IntakeQuestion, ReadinessItem } from "@/lib/db/types";

// The shared field (src/components/ui/input.tsx), at 16px so a phone does not zoom on focus.
// Written out rather than imported because a question's help text sits between its label and
// its field here, which the shared components do not do.
const field =
  "mt-1 min-h-11 w-full rounded-control border border-edge bg-raised px-3 py-[11px] text-base text-ink " +
  "focus:border-brand focus:outline focus:outline-2 focus:outline-brand";

/** A quiet link that is still a 44px target with a visible focus ring. */
const quietLink =
  "inline-flex min-h-11 items-center rounded-control text-13 font-semibold text-brand underline underline-offset-2 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-strong";

function itemWords(item: ReadinessItem, firm: string, Firm: string): { label: string; detail: string } {
  // Taken before the switch: a kind added to the database after this file was written still
  // has its own label to show.
  const asStored = { label: item.label, detail: item.detail };
  switch (item.kind) {
    case "payment":
      return { label: "Pay the consultation fee", detail: item.satisfied ? "Paid." : "Not paid yet." };
    case "intake": {
      const left = item.missing?.length ?? 0;
      return {
        label: `Answer ${firm}'s questions`,
        detail: item.satisfied ? "Answered." : left > 0 ? `${left} still to answer.` : "Not answered yet.",
      };
    }
    case "documents": {
      const left = item.open?.length ?? 0;
      return {
        label: `Send the documents ${firm} asked for`,
        detail: item.satisfied ? "All sent." : left > 0 ? `${left} still to send.` : "Not sent yet.",
      };
    }
    case "consent":
      return { label: `Accept ${firm}'s terms and privacy notice`, detail: item.satisfied ? "Accepted." : "Not accepted yet." };
    case "conflict":
      return {
        label: `${Firm}'s own checks`,
        detail: item.satisfied ? "Done." : `${Firm} is finishing its own checks. Nothing is needed from you.`,
      };
    default:
      return asStored;
  }
}

export function BeforeCard({
  appointmentId,
  readiness,
  questions,
  firmName = null,
  mainKind,
  payAbove = false,
}: {
  appointmentId: string;
  readiness: AppointmentReadiness;
  questions: IntakeQuestion[];
  /** The firm by name, for the client's words. Null reads "your firm". */
  firmName?: string | null;
  /**
   * Which item's action is the screen's one main action (docs/VOICE.md, rule 15). It alone is
   * drawn filled; every other action here is quiet. Left out, the answers button is the filled
   * one, as it always was.
   */
  mainKind?: ReadinessItem["kind"] | null;
  /** The pay panel is on the screen above this card, so the fee is paid there. */
  payAbove?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const firm = firmName ?? "your firm";
  const Firm = firmName ?? "Your firm";
  const intake = readiness.items.find((i) => i.kind === "intake");
  const missingKeys = new Set((intake?.missing ?? []).map((m) => m.key));
  const toAsk = questions.filter((q) => missingKeys.has(q.key));
  const allIn = readiness.items.every((i) => i.satisfied);
  // What is the client's to do. The conflict item is the firm's own work and never counts.
  const clientOutstanding = readiness.items.filter((i) => !i.satisfied && i.kind !== "conflict");
  const answersMain = mainKind === undefined || mainKind === "intake";
  // The action refuses an empty form with a sentence of its own. Saying what is missing under
  // the button stops it being sent empty, so anything the action does return is a failure the
  // client did not cause.
  const hasAnswer = toAsk.some((q) => {
    const v = answers[q.key];
    return Array.isArray(v) ? v.length > 0 : String(v ?? "").trim() !== "";
  });

  function submit() {
    if (!hasAnswer) return;
    setError(null);
    start(async () => {
      const r = await amendIntakeAnswers(appointmentId, answers);
      // The action passes the database's own words back (src/lib/actions/checkin.ts), and those
      // are written for developers: the client reads what was not saved and what to do instead.
      if (r?.error) {
        setError(userErrorMessage({ message: r.error }, "What you entered"));
        return;
      }
      setAnswers({});
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {readiness.held && (
        <p className="text-15 leading-relaxed text-ink">
          {allIn
            ? `Your time is held. Everything ${firm} asked for is in. ${Firm} will confirm your booking.`
            : clientOutstanding.length > 0
              ? `Your time is held. ${Firm} will confirm your booking once the items below are done.`
              : `Your time is held. Nothing more is needed from you. ${Firm} will confirm your booking once its own checks are done.`}
        </p>
      )}
      {allIn ? (
        !readiness.held && <p className="text-15 text-ink">Everything {firm} asked for is in.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {readiness.items.map((i) => {
            const words = itemWords(i, firm, Firm);
            return (
              <li key={i.kind} className="flex items-start gap-3 py-2.5">
                {/* The mark and the words say the same thing, so nothing rests on colour, and the
                    mark is not a status colour of its own (DESIGN.md, "Status"): what is still
                    needed is the strong dot and the bold line, what is done is muted. */}
                <Icon
                  name={i.satisfied ? "check" : "dot"}
                  size={16}
                  strokeWidth={2.4}
                  className={cn("mt-0.5 shrink-0", i.satisfied ? "text-ink-muted" : "text-ink-strong")}
                />
                <div className="min-w-0">
                  <p className={i.satisfied ? "text-15 text-ink-muted" : "text-15 font-semibold text-ink"}>{words.label}</p>
                  <p className="text-13 text-ink-muted">{words.detail}</p>
                  {!i.satisfied && i.kind === "consent" && (
                    <Link href="/app" className={mainKind === "consent" ? buttonClasses("primary", "md", "mt-2") : quietLink}>
                      Read and accept them
                    </Link>
                  )}
                  {!i.satisfied && i.kind === "payment" &&
                    (payAbove ? (
                      <p className="text-13 text-ink-muted">Pay above to confirm your booking.</p>
                    ) : (
                      i.ref && (
                        // To the invoice, whose page shows who is paid and for what before its
                        // button. Nothing on this card opens a checkout.
                        <Link
                          href={`/app/payments/${i.ref}`}
                          className={mainKind === "payment" ? buttonClasses("primary", "md", "mt-2") : quietLink}
                        >
                          See and pay the fee
                        </Link>
                      )
                    ))}
                  {!i.satisfied && i.kind === "documents" && (
                    <p className="text-13 text-ink-muted">
                      {(i.open?.length ?? 0) > 1 ? "Upload them in Documents below." : "Upload it in Documents below."}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {toAsk.length > 0 && (
        <form
          className="flex flex-col gap-3 rounded-card border border-hairline p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-15 font-semibold text-ink">Still to answer</p>
          {error && <Alert kind="error">{error}</Alert>}
          {toAsk.map((q) => (
            <div key={q.key}>
              <label htmlFor={`q-${q.key}`} className="text-15 font-medium text-ink">{q.label}</label>
              {q.help && <p className="text-13 text-ink-muted">{q.help}</p>}
              {q.type === "longtext" ? (
                <textarea id={`q-${q.key}`} rows={3} maxLength={q.max_length ?? 4000} value={String(answers[q.key] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} className={field} />
              ) : q.type === "choice" && q.multiple ? (
                <div className="mt-1 flex flex-col gap-1">
                  {(q.options ?? []).map((o) => {
                    const cur = Array.isArray(answers[q.key]) ? (answers[q.key] as string[]) : [];
                    return (
                      <label key={o} className="flex min-h-11 items-center gap-2 text-15 text-ink">
                        <input type="checkbox" checked={cur.includes(o)} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.checked ? [...cur, o] : cur.filter((x) => x !== o) }))} className="h-5 w-5" />
                        {o}
                      </label>
                    );
                  })}
                </div>
              ) : q.type === "choice" ? (
                <select id={`q-${q.key}`} value={String(answers[q.key] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} className={field}>
                  <option value="">Choose</option>
                  {(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input id={`q-${q.key}`} type="text" maxLength={q.max_length ?? 500} value={String(answers[q.key] ?? "")} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} className={field} />
              )}
            </div>
          ))}
          <Button type="submit" variant={answersMain ? "primary" : "ghost"} size="lg" fullWidth pending={pending} disabled={!hasAnswer}>
            Send my answers
          </Button>
          {!hasAnswer && <p className="text-13 text-ink-muted">Answer at least one question to send.</p>}
        </form>
      )}
    </div>
  );
}

function ConfirmCancel() {
  // The form's own state: the button stays where the thumb is and says it is working while the
  // page's action runs and redirects.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" size="lg" fullWidth pending={pending}>
      Cancel my consultation
    </Button>
  );
}

/**
 * "Cancel my consultation", and the question that comes before it runs. The page says the
 * consequence first, where the client reads it before reaching this button (the firm's own
 * cancellation text, and that any refund is the firm's to make), and this asks once more,
 * because cancelling releases the time at once and the client cannot take it back.
 *
 * `action` is the page's own server action, so the form posts exactly what it always has.
 */
export function CancelConsultation({
  action,
  when,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** "Wednesday 4 November 2026 at 10:00 WAT" */
  when: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="lg" fullWidth onClick={() => setOpen(true)}>
        Cancel my consultation
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Cancel this consultation?">
        <form action={action} className="flex flex-col gap-3">
          <p className="text-15 leading-relaxed text-ink">Your time on {when} will be released for someone else to book.</p>
          <p className="text-15 leading-relaxed text-ink">You cannot undo this.</p>
          <ConfirmCancel />
          <Button variant="ghost" size="lg" fullWidth onClick={() => setOpen(false)}>
            Keep my consultation
          </Button>
        </form>
      </Modal>
    </>
  );
}
