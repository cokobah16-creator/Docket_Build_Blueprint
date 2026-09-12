"use client";

// The baseline, as the database computed it, and the records already taken.
//
// Two things this screen refuses to do. It does not compute anything — every number below is a
// number firm_metrics() returned, so a figure on screen is a figure the rows support. And it
// never presents what the firm says about the past as a measurement: the claims live under their
// own heading, marked as stated by a person, beside the computed figures and never mixed in.
// A rate is shown only where its denominator is not zero, because "0% attended" out of nothing
// attended is a sentence about arithmetic and not about the firm.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { recordBaseline } from "@/lib/actions/baseline";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatMoneyByCurrency } from "@/lib/money";
import { BASELINE_CLAIMS, type FirmBaselineRow, type FirmMetrics } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

/** A share, or a dash where there is nothing to take a share of. */
function share(n: number, of: number): string {
  if (!of) return "—";
  return `${Math.round((n / of) * 100)}%`;
}
function hours(n: number): string {
  if (!n) return "—";
  if (n < 1) return `${Math.round(n * 60)} min`;
  if (n < 48) return `${n.toFixed(1)} h`;
  return `${(n / 24).toFixed(1)} days`;
}
function days(n: number): string {
  return n ? `${n.toFixed(1)} days` : "—";
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-xs text-gray-600">{label}</p>
      <p className="mt-0.5 font-heading text-lg font-semibold text-[#141414]">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

export function Figures({ m, currency = "NGN" }: { m: FirmMetrics; currency?: string }) {
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-semibold text-gray-900">Consultations</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Figure label="Booked in the window" value={String(m.bookings.made)} sub={`${m.bookings.paid} paid`} />
          <Figure label="Paid, after" value={hours(m.bookings.median_hours_to_pay)} sub="median, from booking" />
          <Figure label="Attended" value={share(m.attendance.attended, m.attendance.attended + m.attendance.missed)}
                  sub={`${m.attendance.attended} of ${m.attendance.attended + m.attendance.missed} recorded · ${m.attendance.unrecorded} never written up`} />
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold text-gray-900">From a consultation to a matter</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Figure label="Consultations held" value={String(m.consultation_to_matter.consultations)} />
          <Figure label="Followed by a matter" value={share(m.consultation_to_matter.followed_by_a_matter, m.consultation_to_matter.consultations)}
                  sub={`${m.consultation_to_matter.followed_by_a_matter} within ${m.consultation_to_matter.within_days} days`} />
          <Figure label="After" value={days(m.consultation_to_matter.median_days)} sub="median" />
        </div>
        <p className="mt-1 text-xs text-gray-500">An inference, not a record: nothing joins a consultation to a matter.</p>
      </section>
      <section>
        <h3 className="text-sm font-semibold text-gray-900">Telling the client</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Figure label="Sittings updated" value={share(m.sittings.with_an_update, m.sittings.sat)} sub={`${m.sittings.with_an_update} of ${m.sittings.sat}`} />
          <Figure label="Within a day of the sitting" value={share(m.sittings.updated_within_24h, m.sittings.sat)} sub={`median ${hours(m.sittings.median_hours_to_update)}`} />
          <Figure label="Client updates posted" value={String(m.work.client_updates_posted)} />
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold text-gray-900">Answering</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Figure label="Messages from clients" value={String(m.replies.messages_from_clients)} sub={`${m.replies.answered} answered`} />
          <Figure label="First reply, after" value={hours(m.replies.median_hours_to_first_reply)} sub="median" />
          <Figure label="Still unanswered" value={String(m.replies.still_unanswered)} sub={m.replies.still_unanswered ? `oldest ${hours(m.replies.oldest_unanswered_hours)}` : undefined} />
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Figure label="Documents asked for" value={String(m.document_requests.asked)} sub={`${m.document_requests.answered} sent in`} />
          <Figure label="Sent in, after" value={hours(m.document_requests.median_hours_to_answer)} sub="median" />
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold text-gray-900">Money and work</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Figure label="Invoiced" value={formatMoneyByCurrency(m.money.invoiced, currency)} />
          <Figure label="Collected" value={formatMoneyByCurrency(m.money.collected, currency)} sub={`median ${days(m.money.median_days_to_collect)} to collect`} />
          <Figure label="Open matters now" value={String(m.work.open_matters)} sub={`${m.work.matters_opened_in_window} opened in the window`} />
          <Figure label="Next actions overdue now" value={String(m.work.next_actions_overdue_now)} />
        </div>
      </section>
      <section>
        <h3 className="text-sm font-semibold text-gray-900">Clients</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Figure label="Used the app in the window" value={String(m.clients.active_in_window)} />
          <Figure label="Consultations ahead" value={String(m.attendance.upcoming_now)} />
        </div>
      </section>
      {m.caveats.length > 0 && (
        <section className="rounded-lg bg-gray-50 p-3">
          <h3 className="text-sm font-semibold text-gray-900">What these numbers do not say</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-700">
            {m.caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

export function BaselinePanel({ firmId, timezone, canWrite, from, to, metrics, baselines }: {
  firmId: string;
  timezone: string;
  canWrite: boolean;
  from: string;
  to: string;
  metrics: FirmMetrics | null;
  baselines: FirmBaselineRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [stated, setStated] = useState<Record<string, string>>({});
  const [showing, setShowing] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone });
  const fmtFull = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  function move(days: number) {
    const t = new Date(to);
    const f = new Date(t.getTime() - days * 24 * 60 * 60 * 1000);
    router.push(`/firm/admin/baseline?from=${f.toISOString()}&to=${t.toISOString()}`);
  }

  async function record(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await recordBaseline({ firmId, from, to, note, stated });
      if (r?.error) { setError(r.error); return; }
      setOpen(false); setNote(""); setStated({});
      setNotice("Recorded. It cannot be edited afterwards — that is what makes it a baseline.");
      router.refresh();
    } catch { setError("Nothing was recorded — the connection may have dropped. Try again."); }
    finally { setBusy(false); }
  }

  const windowDays = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000)));

  return (
    <div className="space-y-6">
      {error && <Alert kind="error" title="That was refused">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card>
        <CardHeader
          title={`${fmt.format(new Date(from))} to ${fmt.format(new Date(to))}`}
          action={canWrite && metrics ? <Button size="sm" onClick={() => setOpen((o) => !o)}>{open ? "Cancel" : "Record this as a baseline"}</Button> : undefined}
        />
        <CardBody>
          <div className="mb-3 flex flex-wrap gap-2">
            {[7, 30, 90, 180].map((d) => (
              <button key={d} type="button" onClick={() => move(d)}
                className={d === windowDays
                  ? "min-h-[36px] rounded-full border border-brand bg-brand px-3 text-sm text-brand-on"
                  : "min-h-[36px] rounded-full border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:border-brand"}>
                Last {d} days
              </button>
            ))}
          </div>
          {metrics ? <Figures m={metrics} /> : <p className="text-sm text-gray-600">No figures — the read did not return.</p>}
        </CardBody>
      </Card>

      {open && (
        <Card>
          <CardHeader title="Record this baseline" />
          <CardBody>
            <p className="mb-3 text-xs text-gray-600">
              The figures above are stored exactly as they are, with this window and your name against them, and cannot be
              edited afterwards. Below them you may record what the firm says about how the work went <em>before</em> Docket.
              Those are your words, kept as a stated claim: Docket cannot measure them and never presents them as if it had.
            </p>
            <form onSubmit={record} className="space-y-3">
              <label className="block text-sm">
                <span className="font-medium text-gray-800">Note</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="What was happening at the firm over this window" className={field} />
              </label>
              <fieldset className="rounded-lg border border-gray-200 p-3">
                <legend className="px-1 text-sm font-medium text-gray-800">Before Docket — what the firm says</legend>
                <p className="text-xs text-gray-500">Optional, and every one of them is recorded as a statement by you on today&apos;s date, never as a figure Docket computed.</p>
                <div className="mt-2 space-y-2">
                  {BASELINE_CLAIMS.map((c) => (
                    <label key={c.key} className="block text-sm">
                      <span className="text-gray-800">{c.label}</span>
                      <input value={stated[c.key] ?? ""} onChange={(e) => setStated((s) => ({ ...s, [c.key]: e.target.value }))}
                             maxLength={500} placeholder={c.hint} className={field} />
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" disabled={busy}>{busy ? "Recording…" : "Record"}</Button>
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Baselines already taken" />
        <CardBody>
          {baselines.length === 0 ? (
            <p className="text-sm text-gray-600">
              None yet. Take one before you change how the firm works, or there is nothing to compare with later — and any
              claim about what Docket saved would be a guess.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {baselines.map((b) => (
                <li key={b.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {fmt.format(new Date(b.window_from))} to {fmt.format(new Date(b.window_to))}
                      </p>
                      <p className="text-xs text-gray-600">Taken {fmtFull.format(new Date(b.taken_at))}{b.note ? ` · ${b.note}` : ""}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setShowing(showing === b.id ? null : b.id)}>{showing === b.id ? "Hide" : "Show the figures"}</Button>
                  </div>
                  {Object.keys(b.stated ?? {}).length > 0 && (
                    <div className="mt-2 rounded-lg bg-[#FFFAEB] p-3">
                      <p className="text-xs font-semibold text-[#92400E]">Stated by the firm, not measured by Docket</p>
                      <ul className="mt-1 space-y-0.5 text-xs text-gray-800">
                        {Object.entries(b.stated).map(([k, v]) => (
                          <li key={k}><span className="text-gray-600">{BASELINE_CLAIMS.find((c) => c.key === k)?.label ?? k.replace(/_/g, " ")}:</span> {v}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {showing === b.id && <div className="mt-3"><Figures m={b.metrics} /></div>}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
