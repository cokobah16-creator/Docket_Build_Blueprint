import Link from "next/link";
import { safeNotice } from "@/lib/user-error-message";
import { notFound, redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { publishedPolicyText } from "@/lib/policy-text";
import { breakdownMoney, buildBreakdown } from "@/lib/payment-breakdown";
import { clientStatusLabel, modeLabel } from "@/lib/client-words";
import { dayWords, timeWords, whenWords } from "@/lib/notifications-copy";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill, isStatus } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Disclosure } from "@/components/ui/disclosure";
import { Screen, ScreenHeader, FactRow } from "@/components/portal/screen";
import { PayPanel } from "@/components/portal/pay-panel";
import { BeforeYouPay } from "@/components/portal/before-you-pay";
import { clientTimezone } from "@/lib/portal-data";
import type { PaymentChannel } from "@/lib/providers/payments";
import { cancelAppointment, startPayment } from "@/lib/actions/booking";
import { DocumentsTab } from "@/components/portal/documents-tab";
import { firmPageHref } from "../../firm-href";
import { BeforeCard, CancelConsultation } from "./before-card";
import type { AppointmentReadiness, DocumentRequestRow, DocumentVersionRow, DocumentRow, IntakeForm, InvoiceItemRow, InvoiceRow } from "@/lib/db/types";

export const metadata = { title: "Consultation" };

interface Appt {
  id: string; firm_id: string; reference: string; status: string; mode: string;
  starts_at: string; ends_at: string; client_timezone: string | null;
  fee_minor: number | null; currency: string | null; invoice_id: string | null;
  lawyer_id: string | null; service_id: string | null; hold_expires_at: string | null;
  cancellation_reason: string | null;
}

type Invoice = Pick<InvoiceRow, "id" | "number" | "status" | "currency" | "subtotal_minor" | "vat_minor" | "total_minor" | "paid_minor">;

/**
 * The one thing this screen is for right now (docs/VOICE.md, rule 15). Only that action is drawn
 * filled; every other action on the page is a ghost button or a text link.
 *
 *   pay          the pay panel: Pay, or Choose a new time once the hold has ended
 *   join         a video call within the hour
 *   intake, documents, consent, payment
 *                what the firm still needs from the client before the consultation
 *   pay-invoice  an invoice the firm sends to be paid after booking
 *   message      nothing to do: the firm is there if the client has a question
 *   rebook       cancelled or missed
 *   null         completed: the summary is what the screen is for, and it is read, not tapped
 */
type MainAction = "pay" | "join" | "intake" | "documents" | "consent" | "payment" | "pay-invoice" | "message" | "rebook" | null;

/** The waiting room is offered from an hour before, when the one-hour reminder lands. It opens
 *  ten minutes before (consultation-room.tsx), and until then it is where the client tests their
 *  camera and microphone while a countdown runs, rather than a page they have to keep reloading. */
const ROOM_OFFERED_BEFORE_MS = 60 * 60 * 1000;
/** The room itself opens ten minutes before the start and closes an hour after the end. */
const ROOM_OPENS_BEFORE_MS = 10 * 60 * 1000;
const ROOM_CLOSES_AFTER_MS = 60 * 60 * 1000;

export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; total?: string; payment?: string }>;
}) {
  const { id } = await params;
  const { error: actionError, total: totalFlag, payment: paymentFlag } = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const { data } = await supabase
    .from("appointments")
    .select("id, firm_id, reference, status, mode, starts_at, ends_at, client_timezone, fee_minor, currency, invoice_id, lawyer_id, service_id, hold_expires_at, cancellation_reason")
    .eq("id", id)
    .maybeSingle();
  const appt = (data ?? null) as Appt | null;
  if (!appt) notFound();

  const [{ data: service }, { data: lawyer }, { data: invoice }, { data: itemRows }, { data: notesRow }, owner, { data: readinessRow }, { data: docRows }, { data: requestRows }] = await Promise.all([
    appt.service_id ? supabase.from("services").select("name, duration_min").eq("id", appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.lawyer_id ? supabase.from("lawyer_public").select("full_name, title").eq("id", appt.lawyer_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.invoice_id ? supabase.from("invoices").select("id, number, status, currency, subtotal_minor, vat_minor, total_minor, paid_minor").eq("id", appt.invoice_id).maybeSingle() : Promise.resolve({ data: null }),
    // The lines of the invoice, so "Before you pay" can say how the total is made.
    appt.invoice_id ? supabase.from("invoice_items").select("description, quantity, unit_minor").eq("invoice_id", appt.invoice_id) : Promise.resolve({ data: [] }),
    supabase.from("consultation_notes").select("client_summary, advice_given, follow_up, updated_at").eq("appointment_id", id).maybeSingle(),
    // The firm that owns this consultation, which is not always the one the portal has selected:
    // a client of two firms can open either firm's consultation from a link, and a document
    // written with the other firm's id is refused by the row-firm trigger. firm_public through
    // firmById(), which also carries legal_name, rc_number and vat_rate for "Before you pay", and
    // copes with a database that does not have migration 51 yet.
    firmById(appt.firm_id),
    // What is still needed before the consultation, computed by the database (migration 35).
    supabase.rpc("appointment_readiness", { p_appointment: id }),
    supabase.from("documents").select("id, firm_id, matter_id, appointment_id, name, category, client_visible, current_version_id, uploaded_by, reviewed_at, reviewed_by, created_at").eq("appointment_id", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
    supabase.from("document_requests").select("id, firm_id, matter_id, appointment_id, title, why, due_on, requested_by, requested_at, fulfilled_document_id, fulfilled_at, cancelled_at").eq("appointment_id", id).order("requested_at", { ascending: false }).limit(50),
  ]);
  const readiness = (readinessRow ?? null) as AppointmentReadiness | null;
  const docs = (docRows ?? []) as DocumentRow[];
  const requests = (requestRows ?? []) as DocumentRequestRow[];
  const { data: versionRows } = docs.length
    ? await supabase.from("document_versions").select("id, document_id, storage_path, mime, size_bytes, uploaded_by, created_at").in("document_id", docs.map((d) => d.id))
    : { data: [] as DocumentVersionRow[] };
  const versions = (versionRows ?? []) as DocumentVersionRow[];
  const documents = docs.map((d) => ({ ...d, version: versions.find((v) => v.id === d.current_version_id) ?? null, version_count: versions.filter((v) => v.document_id === d.id).length }));
  // The questions still to answer come from the form the readiness item names.
  const intakeItem = readiness?.items.find((i) => i.kind === "intake");
  const { data: formRow } = intakeItem?.ref ? await supabase.from("intake_forms").select("id, firm_id, service_id, name, schema").eq("id", intakeItem.ref).maybeSingle() : { data: null };
  const questions = ((formRow as IntakeForm | null)?.schema?.questions ?? []);
  const notes = notesRow as { client_summary: string | null; advice_given: string | null; follow_up: string | null; updated_at: string } | null;
  const svc = service as { name: string; duration_min: number } | null;
  const law = lawyer as { full_name: string | null; title: string | null } | null;
  const inv = invoice as Invoice | null;
  const items = (itemRows ?? []) as Array<Pick<InvoiceItemRow, "description" | "quantity" | "unit_minor">>;

  // The zone the viewer reads in, not the one captured at booking: a document's dates belong to
  // the person looking at them, as on every other portal screen. The consultation's own time
  // stays in the zone it was booked in, which is what client_timezone is for.
  const tz = appt.client_timezone ?? "Africa/Lagos";
  const viewerTz = await clientTimezone(supabase, user.id);
  // The firm by name wherever only the firm can act (docs/VOICE.md, rule 2). Null only when its
  // public row cannot be read, and each sentence then says "your firm".
  const firmName = owner?.name ?? null;
  const Firm = firmName ?? "Your firm";
  const firm = firmName ?? "your firm";
  // The owning firm's own cancellation text, and only once it has published it: a "0-" draft is
  // placeholder wording the firm never adopted. Nothing is promised in its place.
  const cancellationText = publishedPolicyText(owner?.policies?.cancellation);
  const bookHref = owner ? await firmPageHref(owner, "/book") : null;
  const messageHref = `/app/messages/appointment/${appt.id}`;
  // The booking wizard sends the client here, instead of to checkout, when the invoice the
  // database raised is not for the total the wizard showed, or when the wizard said to pay now and
  // the booking does not need it (or the other way round). The notices below are fixed text and
  // each is shown only when the appointment's own state bears it out.
  const totalChanged = totalFlag === "changed";
  const paymentChanged = paymentFlag === "changed";

  const now = Date.now();
  const start = new Date(appt.starts_at);
  const startMs = start.getTime();
  const endMs = new Date(appt.ends_at).getTime();
  const when = whenWords(start, tz);
  const opensAt = timeWords(new Date(startMs - ROOM_OPENS_BEFORE_MS), tz);
  const lawyerName = law?.full_name ?? null;
  const live = ["awaiting_payment", "pending", "confirmed", "rescheduled"].includes(appt.status);
  const upcoming = startMs > now;
  const confirmed = appt.status === "confirmed" || appt.status === "rescheduled";
  const over = now > endMs;
  const joinable =
    appt.mode === "virtual" && confirmed && now >= startMs - ROOM_OFFERED_BEFORE_MS && now <= endMs + ROOM_CLOSES_AFTER_MS;

  // Who is paid, for what, and how the total is made, from the invoice as the database has it:
  // the same builder the pay actions read, so the amount on the button is the amount charged.
  const b = inv
    ? buildBreakdown({
        currency: inv.currency,
        payee: { name: firm, legalName: owner?.legal_name, rcNumber: owner?.rc_number },
        purpose: `${svc?.name ?? "Consultation"}${lawyerName ? ` with ${lawyerName}` : ""}, ${when}`,
        lines: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unitMinor: Number(i.unit_minor) })),
        subtotalMinor: Number(inv.subtotal_minor),
        vatMinor: Number(inv.vat_minor),
        vatRatePercent: owner?.vat_rate ?? null,
        totalMinor: Number(inv.total_minor),
        paidMinor: Number(inv.paid_minor),
      })
    : null;
  const unpaid = Boolean(inv && b && ["issued", "partially_paid", "overdue"].includes(inv.status) && b.chargeMinor > 0);
  // The pay panel is for a booking that is paid to be confirmed. Anything else the firm invoices
  // is paid from the invoice's own page, which shows the same breakdown first.
  const payOnPage = appt.status === "awaiting_payment" && unpaid;
  const invoiceDue = !payOnPage && unpaid;
  const paidMinor = Number(inv?.paid_minor ?? 0);

  // What the client still owes the firm before the consultation, in the database's order. The fee
  // is left out while the pay panel is on the screen, because the panel is where it is paid.
  const outstanding = (readiness?.items ?? []).filter(
    (i) => !i.satisfied && i.kind !== "conflict" && !(i.kind === "payment" && payOnPage),
  );
  // Documents go first among them. Their upload buttons are drawn filled by the documents list
  // itself, so with documents still to send, those are the screen's main action and the answers
  // button below steps back to a ghost rather than a second filled button.
  const firstNeed = outstanding[0]?.kind;
  const needed: MainAction = outstanding.some((i) => i.kind === "documents")
    ? "documents"
    : firstNeed && firstNeed !== "conflict"
      ? firstNeed
      : null;
  const showBefore = Boolean(readiness && live && (readiness.held || outstanding.length > 0 || readiness.items.some((i) => !i.satisfied && i.kind === "conflict")));

  let main: MainAction;
  if (payOnPage) main = "pay";
  else if (appt.status === "cancelled") main = paidMinor > 0 ? "message" : bookHref ? "rebook" : "message";
  else if (appt.status === "no_show") main = bookHref ? "rebook" : "message";
  else if (appt.status === "completed") main = invoiceDue ? "pay-invoice" : null;
  // A call about to start outranks anything still on the list: the questions can wait, the call cannot.
  else if (joinable) main = "join";
  else if (needed) main = needed;
  else if (invoiceDue) main = "pay-invoice";
  else main = "message";

  const appointmentId = appt.id;
  const pay = async (channel: PaymentChannel) => {
    "use server";
    // Every refusal startPayment() returns is one of PAYMENT_NOTICES' client sentences, Paystack's
    // own wording included (src/lib/user-error-message.ts), so it is shown as it comes.
    const r = await startPayment(appointmentId, channel);
    if (r?.error) return r;
  };
  // Form actions must return void; errors come back through the query string.
  const cancel = async () => {
    "use server";
    const r = await cancelAppointment(appointmentId);
    if (r?.error) redirect(`/app/appointments/${appointmentId}?error=${encodeURIComponent(r.error)}`);
    redirect(`/app/appointments/${appointmentId}`);
  };

  const summaryCard = notes && notes.client_summary && (
    <Card>
      <CardHeader title="Your consultation summary" />
      <CardBody className="flex flex-col gap-3 text-15 leading-relaxed text-ink">
        <p className="whitespace-pre-wrap">{notes.client_summary}</p>
        {notes.advice_given && (
          <div><p className="text-11 font-semibold uppercase tracking-wide text-ink-muted">Advice</p><p className="whitespace-pre-wrap">{notes.advice_given}</p></div>
        )}
        {notes.follow_up && (
          <div><p className="text-11 font-semibold uppercase tracking-wide text-ink-muted">Next steps</p><p className="whitespace-pre-wrap">{notes.follow_up}</p></div>
        )}
        <p className="text-13 text-ink-muted">
          Written by {lawyerName ?? "your lawyer"} on {dayWords(notes.updated_at, tz)}.
        </p>
      </CardBody>
    </Card>
  );

  // The cancelled booking's own story, in the order a client asks it: what happened, then
  // whether money moved and who sorts it out. cancel_appointment() refunds nothing and
  // release_expired_holds() leaves a paid invoice as it is, so no sentence here says otherwise.
  const cancelledBecause =
    appt.cancellation_reason === "payment_timeout"
      ? "Your hold ended before Paystack confirmed a payment, so the time was released."
      : appt.cancellation_reason === "not_confirmed"
        ? "It was not confirmed before its start time."
        : appt.cancellation_reason === "cancelled by client"
          ? "You cancelled it."
          : null;

  const mainLink =
    main === "pay-invoice" && inv && b
      ? { href: `/app/payments/${inv.id}`, label: `See and pay ${breakdownMoney(b, b.chargeMinor)}`, note: "The invoice for this consultation is still to pay." }
      : main === "message"
        ? { href: messageHref, label: `Message ${firm}`, note: null }
        : main === "rebook" && bookHref
          ? { href: bookHref, label: "Book again", note: null }
          : null;

  const quiet: Array<{ href: string; label: string }> = [];
  if (main !== "message") quiet.push({ href: messageHref, label: `Message ${firm}` });
  if (appt.status === "completed" && bookHref) quiet.push({ href: bookHref, label: "Book another consultation" });
  // A booking that was paid for and then cancelled is the firm's to sort out, so it is not offered
  // a second booking to pay for in the same breath.
  if (appt.status === "cancelled" && main !== "rebook" && paidMinor === 0 && bookHref) quiet.push({ href: bookHref, label: "Book again" });

  const openRequests = requests.filter((r) => !r.fulfilled_at && !r.cancelled_at).length;
  const documentsTab = (
    <DocumentsTab
      firmId={appt.firm_id}
      matterId={null}
      appointmentId={appt.id}
      documents={documents}
      timezone={viewerTz}
      requests={requests}
      userId={user.id}
      mainAction={main === "documents"}
    />
  );

  return (
    <>
      <ScreenHeader back="/app/appointments" backLabel="Back to consultations" title="Your consultation" />
      <Screen>
        <header className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-heading text-21 font-semibold leading-tight tracking-[-0.015em] text-brand">
              {svc?.name ?? "Consultation"}
            </h1>
            {isStatus(appt.status) && <StatusPill status={appt.status} label={clientStatusLabel(appt.status)} />}
          </div>
          <p className="text-15 font-semibold text-ink">{when}</p>
          <p className="text-15 text-ink-muted">
            {modeLabel(appt.mode)} with {lawyerName ? `${lawyerName}${law?.title ? `, ${law.title}` : ""}` : `a lawyer from ${firm}`}
          </p>
        </header>

        {actionError && <Alert kind="error" title="That did not go through">{safeNotice(actionError)}</Alert>}

        {totalChanged && inv && b && inv.status !== "paid" && (
          <Alert kind="warning" title="Check the amount">
            The invoice for this booking is for {breakdownMoney(b, inv.total_minor)}. That is not the total you were shown when
            you booked. Check how it is made before you pay.
          </Alert>
        )}

        {paymentChanged && appt.status === "awaiting_payment" && inv && inv.status !== "paid" && (
          <Alert kind="warning" title="This booking needs payment now">
            The booking page did not ask you to pay now, so you were not sent to Paystack. This booking does need payment now.
            If it is not paid before the hold ends, the time is released.
          </Alert>
        )}

        {paymentChanged && (appt.status === "confirmed" || appt.status === "pending") && (
          <Alert kind="info" title="You do not need to pay now">
            The booking page asked you to pay now. This booking was made without payment, so you were not sent to Paystack.
            {inv ? " Its invoice is in the details below." : ""}
          </Alert>
        )}

        {appt.status === "rescheduled" && upcoming && (
          <Alert kind="info" title="This consultation was moved">
            Your new time is shown above. Reminders are sent again for the new time.
          </Alert>
        )}

        {payOnPage && b && (
          <PayPanel
            amount={breakdownMoney(b, b.chargeMinor)}
            summary={<BeforeYouPay breakdown={b} policyText={cancellationText} />}
            holdExpiresAt={appt.hold_expires_at}
            rebookHref={bookHref}
            onPay={pay}
          />
        )}

        {showBefore && readiness && (
          <Card>
            <CardHeader title="Before your consultation" />
            <CardBody>
              <BeforeCard
                appointmentId={appt.id}
                readiness={readiness}
                questions={questions}
                firmName={firmName}
                mainKind={main === "intake" || main === "consent" || main === "payment" ? main : null}
                payAbove={payOnPage}
              />
            </CardBody>
          </Card>
        )}

        {/* The held message lives in the card above. Without the database's readiness to hang it
            on, it is said here instead, once. */}
        {appt.status === "pending" && !showBefore && (
          <Alert kind="info" title="Your time is held">{Firm} will confirm your booking.</Alert>
        )}

        {confirmed && (
          <Card>
            <CardHeader title="What happens next" />
            <CardBody className="flex flex-col gap-3 text-15 leading-relaxed text-ink">
              {over && !joinable ? (
                <p>The time for this consultation has passed.</p>
              ) : appt.mode === "virtual" ? (
                <>
                  <p>The room opens at {opensAt}, 10 minutes before your consultation.</p>
                  {joinable ? (
                    <p>Test your camera and microphone in the waiting room. Then wait for {lawyerName ?? "your lawyer"} to let you in.</p>
                  ) : (
                    <p>
                      From an hour before, you can go into the waiting room and test your camera and microphone.{" "}
                      {lawyerName ?? "Your lawyer"} lets you in when it is time.
                    </p>
                  )}
                </>
              ) : appt.mode === "phone" ? (
                <p>{lawyerName ?? Firm} will call you at {timeWords(start, tz)}.</p>
              ) : (
                <>
                  <p>Your consultation is at {firm}&apos;s office.</p>
                  {owner?.brand?.contact?.address && <p className="font-semibold">{owner.brand.contact.address}</p>}
                </>
              )}
              {main === "join" && (
                <Link href={`/app/appointments/${appt.id}/waiting-room`} className={buttonClasses("primary", "lg", "w-full")}>
                  Join the waiting room
                </Link>
              )}
            </CardBody>
          </Card>
        )}

        {appt.status === "completed" && (summaryCard || (
          <Card>
            <CardHeader title="Your consultation summary" />
            <CardBody>
              <p className="text-15 leading-relaxed text-ink">
                {lawyerName ?? "Your lawyer"} has not written the summary yet. It shows here once it is ready.
              </p>
            </CardBody>
          </Card>
        ))}

        {appt.status === "cancelled" && (
          <Card>
            <CardHeader title="This consultation was cancelled" />
            <CardBody className="flex flex-col gap-3 text-15 leading-relaxed text-ink">
              {cancelledBecause && <p>{cancelledBecause}</p>}
              {paidMinor > 0 && b ? (
                <>
                  <p>You paid {breakdownMoney(b, paidMinor)} for it.</p>
                  <p>A cancelled booking is not refunded automatically. Any refund is {firm}&apos;s to make, so message {firm} about it.</p>
                </>
              ) : inv ? (
                <p>If money left your account for it, message {firm} with your bank reference.</p>
              ) : null}
            </CardBody>
          </Card>
        )}

        {appt.status === "no_show" && (
          <Card>
            <CardHeader title="This consultation was missed" />
            <CardBody>
              <p className="text-15 leading-relaxed text-ink">If you think that is wrong, message {firm}.</p>
            </CardBody>
          </Card>
        )}

        {mainLink && (
          <div className="flex flex-col gap-2">
            {mainLink.note && <p className="text-15 text-ink">{mainLink.note}</p>}
            <Link href={mainLink.href} className={buttonClasses("primary", "lg", "w-full")}>{mainLink.label}</Link>
          </div>
        )}

        {/* Documents stay open while the firm is waiting on them, and then their upload button is
            the screen's one filled button. Otherwise they fold away and every button in them is a
            ghost (mainAction={false}), so opening the fold never puts a second filled button beside
            the screen's main one. The override lets the list run edge to edge inside the fold. */}
        {live && (main === "documents" ? (
          <Card>
            <CardHeader title="Documents" />
            {documentsTab}
          </Card>
        ) : (
          <Disclosure
            summary="Documents"
            hint={
              openRequests > 0
                ? `${openRequests} still to send`
                : documents.length > 0
                  ? `${documents.length} ${documents.length === 1 ? "document" : "documents"}`
                  : "None yet"
            }
            className="[&>div]:p-0"
          >
            {documentsTab}
          </Disclosure>
        ))}

        {appt.status !== "completed" && summaryCard}

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="flex flex-col gap-3">
              {svc && <FactRow label="Duration">{svc.duration_min} minutes</FactRow>}
              {inv && b && (
                <FactRow label="Invoice">
                  <span className="flex flex-col items-end gap-1">
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {breakdownMoney(b, inv.total_minor)}
                      {isStatus(inv.status) && <StatusPill status={inv.status} label={clientStatusLabel(inv.status)} />}
                    </span>
                    <Link
                      href={`/app/payments/${inv.id}`}
                      className="inline-flex min-h-11 items-center rounded-control font-semibold text-brand underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-strong"
                    >
                      See the invoice
                    </Link>
                  </span>
                </FactRow>
              )}
              <FactRow label="Reference"><span className="font-mono">{appt.reference}</span></FactRow>
            </dl>
          </CardBody>
        </Card>

        {quiet.length > 0 && (
          <div className="flex flex-col gap-2.5 sm:flex-row">
            {quiet.map((q) => (
              <Link key={q.label} href={q.href} className={buttonClasses("ghost", "lg", "w-full sm:flex-1")}>{q.label}</Link>
            ))}
          </div>
        )}

        {live && upcoming && (
          <Disclosure summary="Cancel this consultation">
            <div className="flex flex-col gap-3">
              {/* The consequence before the button (docs/VOICE.md, rule 16). The firm's text is
                  shown once on the page: in "Before you pay" while the pay panel is up, here
                  otherwise. */}
              {cancellationText && !payOnPage && (
                <div className="flex flex-col gap-1">
                  <p className="text-13 font-semibold text-ink">If plans change</p>
                  <p className="text-15 leading-relaxed text-ink">{cancellationText}</p>
                </div>
              )}
              {cancellationText && payOnPage && (
                <p className="text-15 leading-relaxed text-ink">{Firm}&apos;s cancellation terms are shown above, under “If plans change”.</p>
              )}
              {/* cancel_appointment() cancels the booking and an unpaid invoice, and refunds
                  nothing. A free consultation has nothing to refund, so it is not told this. */}
              {inv && (
                <p className="text-15 leading-relaxed text-ink">
                  Cancelling does not refund you automatically. Any refund is {firm}&apos;s to make.
                </p>
              )}
              <p className="text-15 leading-relaxed text-ink">To move it to another time instead, message {firm}.</p>
              <CancelConsultation action={cancel} when={when} />
            </div>
          </Disclosure>
        )}
      </Screen>
    </>
  );
}
