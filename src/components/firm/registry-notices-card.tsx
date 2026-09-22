"use client";

// "From the registry": the court registry's own notices about this firm's suits, each waiting for
// a lawyer on the matter to decide. Nothing here is in the diary until they do.
//
// The screen holds no rule. confirm_registry_notice() asks matter_row_w() — staff with a second
// factor, inside the wall — checks the matter really carries the suit, refuses a weekend or a
// public holiday in words, and chooses for itself whether to attach to a sitting already in the
// diary, make a new one, or vacate an earlier date first. The refusal, when there is one, is the
// database's sentence.
//
// A listed day is a calendar day and is shown with formatDay(), never through a timezone.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDay } from "@/lib/days";
import { formatWhen } from "@/lib/time";
import { confirmRegistryNotice, rejectRegistryNotice } from "@/lib/actions/registry";
import type { FirmRegistryNoticeRow } from "@/lib/db/types";

const field = "mt-1 block w-full min-h-11 rounded-lg border border-edge px-3 text-base text-ink focus:border-[#141414] focus:outline focus:outline-2 focus:outline-[#141414]";

export function RegistryNoticesCard({ firmId, firmParam, timezone, notices }: {
  firmId: string;
  firmParam: string;
  timezone: string;
  notices: FirmRegistryNoticeRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [times, setTimes] = useState<Record<string, string>>({});
  const [vacate, setVacate] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const open = notices.filter((n) => n.decision === null && n.status === "published");
  const decided = notices.filter((n) => n.decision !== null);
  const key = (n: FirmRegistryNoticeRow) => `${n.notice_id}:${n.matter_id}`;

  async function confirm(n: FirmRegistryNoticeRow) {
    const k = key(n);
    setBusy(k); setError(null); setDone(null);
    try {
      const r = await confirmRegistryNotice(n.notice_id, n.matter_id, times[k] ?? (n.listed_time ? n.listed_time.slice(0, 5) : null),
                                            Boolean(vacate[k]), reasons[k] ?? null);
      if ("error" in r) { setError(r.error); return; }
      setDone(`${n.suit_number} is in the diary for ${formatDay(n.listed_on)}. The client has been told.`);
      router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function reject(n: FirmRegistryNoticeRow) {
    const reason = window.prompt("Why is this not yours, or not to be diarised? Kept on the record.");
    if (reason === null) return;
    if (reason.trim().length < 3) return;
    const k = key(n);
    setBusy(k); setError(null); setDone(null);
    try {
      const r = await rejectRegistryNotice(n.notice_id, n.matter_id, reason);
      if (r?.error) setError(r.error); else { setDone(`Noted. The registry is not told, and nothing reached the diary.`); router.refresh(); }
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  return (
    <Card className={open.length > 0 ? "border-[#141414]" : undefined}>
      <div id="registry" />
      <CardHeader title={`From the court registry (${open.length} to decide)`} />
      <CardBody className="border-b border-hairline text-13 leading-[1.55] text-[#57534E]">
        A court registry on Docket has published its cause list. These are its listings for suits this firm holds.
        <strong> Nothing is in the diary until a lawyer on the matter confirms it</strong>; the registry is never told
        what you decided. Confirm to diarise the date and tell the client, or say it is not yours.
      </CardBody>
      {error && <div className="px-[15px] pt-3"><Alert kind="error" title="The diary refused that">{error}</Alert></div>}
      {done && <div className="px-[15px] pt-3"><Alert kind="success">{done}</Alert></div>}

      {open.length === 0 ? (
        <CardBody className="text-15 text-ink-muted">Nothing waiting. A new listing appears here the moment the registry publishes it.</CardBody>
      ) : (
        <ul className="divide-y divide-hairline">
          {open.map((n) => {
            const k = key(n);
            const sameDayAlready = n.existing_scheduled_at
              ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(n.existing_scheduled_at)) === n.listed_on
              : false;
            return (
              <li key={k} className="px-4 py-4 sm:px-5">
                <p className="text-15 font-medium text-ink">
                  {formatDay(n.listed_on)}{n.listed_time ? ` · ${n.listed_time.slice(0, 5)}` : " · no time given"} · {n.cause_title}
                </p>
                <p className="text-13 text-ink-muted">
                  <span className="font-mono">{n.suit_number}</span> · {n.reference} · {n.court_name}
                  {n.purpose ? ` · ${n.purpose}` : n.purpose_kind ? ` · ${n.purpose_kind.replace(/_/g, " ")}` : ""}
                  {n.judge ? ` · ${n.judge}` : ""}{n.courtroom ? ` · ${n.courtroom}` : ""}
                </p>
                <p className="text-13 text-ink-muted">
                  Published by {n.registry_name}{n.published_at ? ` on ${formatWhen(n.published_at, timezone)}` : ""}
                  {n.registry_cause_title && n.registry_cause_title !== n.cause_title ? ` · the registry calls it “${n.registry_cause_title}”` : ""}
                </p>
                {n.listed_on_non_sitting_day && (
                  <p className="mt-1 text-13 font-medium text-[#B42318]">This day is a weekend or a public holiday. The diary will refuse it; ask the registry.</p>
                )}
                {n.listed_in_vacation && !n.listed_on_non_sitting_day && (
                  <p className="mt-1 text-13 font-medium text-amber-800">This day falls inside the court&rsquo;s vacation — a vacation judge&rsquo;s sitting. It will be diarised and marked as such.</p>
                )}
                {n.existing_scheduled_at && (
                  <p className="mt-1 text-13 text-ink">
                    The diary already has this matter on {formatWhen(n.existing_scheduled_at, timezone, { dateStyle: "medium", timeStyle: "short" })}.
                    {sameDayAlready
                      ? " Same day: confirming attaches the registry's notice to that sitting rather than adding a second."
                      : " A different day: confirm alone to add the new sitting, or vacate the earlier date at the same time."}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-end gap-3">
                  {!sameDayAlready && (
                    <label className="block text-13 text-ink">Time{n.listed_time ? "" : " (the registry gave none)"}
                      <input type="time" value={times[k] ?? (n.listed_time ? n.listed_time.slice(0, 5) : "09:00")}
                             onChange={(e) => setTimes({ ...times, [k]: e.target.value })} className={`${field} w-32`} />
                    </label>
                  )}
                  {n.existing_scheduled_at && !sameDayAlready && (
                    <label className="flex items-start gap-2 text-13 text-ink">
                      <input type="checkbox" className="mt-0.5" checked={Boolean(vacate[k])} onChange={(e) => setVacate({ ...vacate, [k]: e.target.checked })} />
                      <span>Vacate the earlier date and refix it to this one (the client reads why)</span>
                    </label>
                  )}
                  {vacate[k] && (
                    <input type="text" maxLength={500} placeholder="Why the earlier date is vacated" value={reasons[k] ?? ""}
                           onChange={(e) => setReasons({ ...reasons, [k]: e.target.value })} className={`${field} min-w-[16rem] flex-1`} />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy === k || n.listed_on_non_sitting_day} onClick={() => void confirm(n)}>
                    {busy === k ? "Confirming…" : sameDayAlready ? "Confirm — it is the sitting in the diary" : "Confirm into the diary"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === k} onClick={() => void reject(n)}>Not ours / not to be diarised</Button>
                  <Link href={`/firm/matters/${n.matter_id}${firmParam ? `?firm=${encodeURIComponent(firmParam)}` : ""}`} className="self-center text-13 text-brand underline">Open the matter →</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {decided.length > 0 && (
        <details className="border-t border-hairline px-4 py-3 sm:px-5">
          <summary className="cursor-pointer text-13 font-medium text-ink">Decided ({decided.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {decided.map((n) => (
              <li key={key(n)} className="text-13 text-ink-muted">
                <span className="font-mono">{n.suit_number}</span> · {formatDay(n.listed_on)} · {n.reference} —{" "}
                {n.decision === "confirmed" ? "confirmed into the diary" : `not diarised: ${n.decision_reason ?? ""}`}
                {n.decided_at ? ` (${formatWhen(n.decided_at, timezone)})` : ""}
                {n.status === "withdrawn" ? <span className="font-medium text-[#B42318]"> · the registry has since withdrawn this notice{n.withdrawn_reason ? `: ${n.withdrawn_reason}` : ""}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
