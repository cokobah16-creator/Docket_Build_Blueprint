"use client";

// Serve a court process on counsel for another party — the other half of the
// conversation between firms that the court conducts.
//
// Rules stated plainly here, because they are the rules of court and the
// database enforces every one of them:
//  · Only a document with an uploaded version can be served: what is served is
//    pinned to that version and its checksum, so it can never be swapped later.
//  · Service through Docket is stamped by the database at the moment it lands in
//    the other firm's inbox — it cannot be back-dated, and it is refused unless
//    that firm has undertaken to accept service here.
//  · An originating process may only be served on counsel who has undertaken to
//    accept service, or under an order for substituted service; otherwise it must
//    be served on the party.
//  · Substituted service needs the court's order attached.
//  · A process served outside the state that issued it needs the Sheriffs and
//    Civil Process Act endorsement.
// Every refusal is shown exactly as the database words it.
//
// Dates are typed in the viewer's zone and sent as UTC instants. Nothing here is
// firm-specific: the matter, counsel, the documents and the zone all arrive as props.

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { serveProcess } from "@/lib/actions/service";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SERVICE_METHODS, type MatterCounselRow } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

/** Methods that reach the party through counsel rather than the party themselves. */
const THROUGH_COUNSEL = new Set(["platform", "email", "counsel_address", "whatsapp"]);

/**
 * The UTC instant for a wall-clock date and time in `tz` — the database keeps
 * UTC, the lawyer records the day service was effected. Two passes because the
 * offset itself depends on the instant.
 */
function zonedInstant(ymd: string, hhmm: string, tz: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wanted = Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0);
  let ts = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    ts -= asUtc - wanted;
  }
  return new Date(ts).toISOString();
}

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function timeNowIn(tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}

export function counselLabel(counsel: MatterCounselRow): string {
  const who = counsel.counsel_name?.trim();
  const chambers = counsel.counsel_firm_name?.trim();
  if (who && chambers) return `${who}, ${chambers}`;
  return who || chambers || "counsel on Docket";
}

export function ServeProcessForm({
  matterId, counsel, documents, timezone, onDone,
}: {
  matterId: string;
  counsel: MatterCounselRow;
  documents: Array<{ id: string; name: string; current_version_id: string | null }>;
  timezone: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const onPlatform = Boolean(counsel.counsel_firm_id);
  const servable = useMemo(() => documents.filter((d) => d.current_version_id), [documents]);
  const unservable = documents.length - servable.length;

  const [documentId, setDocumentId] = useState("");
  const [processTitle, setProcessTitle] = useState("");
  const [method, setMethod] = useState(onPlatform ? "platform" : "counsel_address");
  const [servedDay, setServedDay] = useState(() => todayIn(timezone));
  const [servedTime, setServedTime] = useState(() => timeNowIn(timezone));
  const [isOriginating, setIsOriginating] = useState(false);
  const [substituted, setSubstituted] = useState(false);
  const [authorityDocumentId, setAuthorityDocumentId] = useState("");
  const [servedOnName, setServedOnName] = useState("");
  const [servedOnCapacity, setServedOnCapacity] = useState("");
  const [servedAtAddress, setServedAtAddress] = useState(counsel.address_for_service ?? "");
  const [serverName, setServerName] = useState("");
  const [outsideIssuingState, setOutsideIssuingState] = useState(false);
  const [deemedServedOn, setDeemedServedOn] = useState("");
  const [note, setNote] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [served, setServed] = useState(false);
  const [pending, startTransition] = useTransition();

  const isPlatform = method === "platform";
  const willBeRefused = isOriginating && THROUGH_COUNSEL.has(method) && !counsel.accepts_service && !substituted;
  const canSubmit = Boolean(documentId) && processTitle.trim().length >= 2 && !pending;

  if (servable.length === 0) {
    return (
      <div className="space-y-3">
        <Alert kind="warning" title="Nothing on this matter can be served yet">
          A document with no uploaded file cannot be served: the service record pins the exact version and its
          checksum, which is what makes it proof of service.
          {documents.length > 0 && ` ${documents.length} document${documents.length === 1 ? " is" : "s are"} on the matter with no file uploaded.`}
        </Alert>
        <p className="text-sm text-gray-600">
          Upload the process on the matter&apos;s Documents tab, then serve it from here.
        </p>
        {onDone && <Button variant="ghost" onClick={onDone}>Close</Button>}
      </div>
    );
  }

  if (served) {
    return (
      <div className="space-y-3">
        <Alert kind="success" title="Served">
          The service record is filed with the document version and its checksum, and your client can see that the
          process was served.{" "}
          {isPlatform
            ? "It is in the other firm's inbox now; their acknowledgement will appear on this matter."
            : "Attach the affidavit of service or the courier slip to the matter when you have it."}
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setServed(false);
              setDocumentId("");
              setProcessTitle("");
              setIsOriginating(false);
              setSubstituted(false);
              setAuthorityDocumentId("");
              setDeemedServedOn("");
              setNote("");
            }}
          >
            Serve another process
          </Button>
          {onDone && <Button onClick={onDone}>Done</Button>}
        </div>
      </div>
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!documentId) { setError("Choose the process you are serving."); return; }
    setError(null);

    startTransition(async () => {
      const result = await serveProcess({
        matterId,
        counselId: counsel.id,
        documentId,
        processTitle: processTitle.trim(),
        method,
        servedAt: isPlatform ? null : zonedInstant(servedDay, servedTime || "09:00", timezone),
        note: note.trim() || null,
        isOriginating,
        substitutedByOrder: substituted,
        authorityDocumentId: substituted ? authorityDocumentId || null : null,
        servedOnName: servedOnName.trim() || null,
        servedOnCapacity: servedOnCapacity.trim() || null,
        servedAtAddress: servedAtAddress.trim() || null,
        serverName: serverName.trim() || null,
        outsideIssuingState,
        deemedServedOn: deemedServedOn || null,
      });
      if ("error" in result) { setError(result.error); return; }
      setServed(true);
      router.refresh();
    });
  }

  const id = (name: string) => `sp_${name}_${counsel.id}`;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert kind="error" title="The database refused this">{error}</Alert>}

      <p className="text-sm text-gray-600">
        Serving <span className="font-medium text-gray-900">{counselLabel(counsel)}</span>
        {counsel.party_name ? <> for <span className="font-medium text-gray-900">{counsel.party_name}</span></> : null}.
      </p>

      <div>
        <label htmlFor={id("doc")} className="text-sm font-medium text-gray-900">
          The process <span className="text-red-700">*</span>
        </label>
        <select id={id("doc")} required value={documentId} onChange={(e) => setDocumentId(e.target.value)} className={field}>
          <option value="">Choose a document…</option>
          {servable.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          The exact version and its checksum are recorded, so what you served cannot be changed afterwards.
          {unservable > 0 && ` ${unservable} document${unservable === 1 ? "" : "s"} on this matter ${unservable === 1 ? "has" : "have"} no uploaded file and cannot be served.`}
        </p>
      </div>

      <div>
        <label htmlFor={id("title")} className="text-sm font-medium text-gray-900">
          Title of the process <span className="text-red-700">*</span>
        </label>
        <input
          id={id("title")} type="text" required maxLength={300} value={processTitle}
          onChange={(e) => setProcessTitle(e.target.value)}
          placeholder="Motion on notice for interlocutory injunction" className={field}
        />
        <p className="mt-1 text-xs text-gray-500">As it reads on the face of the process.</p>
      </div>

      <div>
        <label htmlFor={id("method")} className="text-sm font-medium text-gray-900">How was it served?</label>
        <select id={id("method")} value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
          {SERVICE_METHODS.map((m) => (
            <option key={m.value} value={m.value} disabled={m.value === "platform" && !onPlatform}>
              {m.label}{m.value === "platform" && !onPlatform ? " — counsel is not on Docket" : ""}
            </option>
          ))}
        </select>
        {isPlatform && (
          <p className="mt-1 text-xs text-gray-500">
            The process lands in the other firm&apos;s inbox and it is notified. If that firm has not undertaken to accept
            service through Docket, the database refuses and tells you to serve at its address for service.
          </p>
        )}
      </div>

      {isPlatform ? (
        <Alert kind="info" title="The time of service is stamped for you">
          Service through Docket is stamped at the moment it lands in their inbox — it cannot be back-dated.
        </Alert>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[9rem] flex-1">
            <label htmlFor={id("day")} className="text-sm font-medium text-gray-900">Date served</label>
            <input
              id={id("day")} type="date" value={servedDay} max={todayIn(timezone)}
              onChange={(e) => setServedDay(e.target.value)} className={field}
            />
          </div>
          <div className="w-28">
            <label htmlFor={id("time")} className="text-sm font-medium text-gray-900">Time</label>
            <input id={id("time")} type="time" value={servedTime} onChange={(e) => setServedTime(e.target.value)} className={field} />
          </div>
          <p className="pb-2 text-xs text-gray-500">Times in {timezone}</p>
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <label className="flex min-h-[44px] items-start gap-2 text-sm font-medium text-amber-900">
          <input
            type="checkbox" checked={isOriginating} onChange={(e) => setIsOriginating(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          This is an originating process
        </label>
        <p className="text-xs text-amber-900">
          A writ, originating summons, petition, notice of appeal or other process that begins a case. It may only be
          served on counsel who has undertaken to accept service, or under an order for substituted service — otherwise
          it must be served on the party.
        </p>
        {isOriginating && (
          <p className="text-xs text-amber-900">
            {counsel.accepts_service
              ? "This counsel has undertaken to accept service for their party."
              : "This counsel has not undertaken to accept service. Record the undertaking on the roster, serve the party direct, or serve under an order for substituted service."}
          </p>
        )}
      </div>

      {willBeRefused && (
        <Alert kind="warning" title="The database will refuse this">
          An originating process may only be served on counsel who has undertaken to accept service, or under an order
          for substituted service.
        </Alert>
      )}

      <div className="space-y-2 rounded-lg border border-gray-200 p-3">
        <label className="flex min-h-[44px] items-start gap-2 text-sm font-medium text-gray-900">
          <input
            type="checkbox" checked={substituted}
            onChange={(e) => { setSubstituted(e.target.checked); if (!e.target.checked) setAuthorityDocumentId(""); }}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          Served under an order for substituted service
        </label>
        {substituted && (
          <div>
            <label htmlFor={id("order")} className="text-sm font-medium text-gray-900">
              The court&apos;s order <span className="text-red-700">*</span>
            </label>
            <select
              id={id("order")} value={authorityDocumentId}
              onChange={(e) => setAuthorityDocumentId(e.target.value)} className={field}
            >
              <option value="">Choose the order on this matter…</option>
              {documents.filter((d) => d.id !== documentId).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Substituted service needs the order attached, and it must be a document on this matter.
            </p>
          </div>
        )}
      </div>

      <fieldset className="space-y-3 rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-sm font-medium text-gray-900">Who was served</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={id("on")} className="text-sm font-medium text-gray-900">Served on</label>
            <input
              id={id("on")} type="text" maxLength={200} value={servedOnName}
              onChange={(e) => setServedOnName(e.target.value)} placeholder="Name of the person served" className={field}
            />
          </div>
          <div>
            <label htmlFor={id("capacity")} className="text-sm font-medium text-gray-900">In what capacity</label>
            <input
              id={id("capacity")} type="text" maxLength={200} value={servedOnCapacity}
              onChange={(e) => setServedOnCapacity(e.target.value)} placeholder="Litigation secretary" className={field}
            />
          </div>
        </div>
        <div>
          <label htmlFor={id("address")} className="text-sm font-medium text-gray-900">Address where served</label>
          <textarea
            id={id("address")} rows={2} maxLength={600} value={servedAtAddress}
            onChange={(e) => setServedAtAddress(e.target.value)}
            placeholder={counsel.address_for_service ?? "Counsel's address for service"} className={field}
          />
        </div>
        <div>
          <label htmlFor={id("server")} className="text-sm font-medium text-gray-900">Who served it</label>
          <input
            id={id("server")} type="text" maxLength={200} value={serverName}
            onChange={(e) => setServerName(e.target.value)} placeholder="Bailiff, process server or member of chambers" className={field}
          />
        </div>
      </fieldset>

      <div className="space-y-2 rounded-lg border border-gray-200 p-3">
        <label className="flex min-h-[44px] items-start gap-2 text-sm font-medium text-gray-900">
          <input
            type="checkbox" checked={outsideIssuingState} onChange={(e) => setOutsideIssuingState(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          Served outside the state that issued the process
        </label>
        <p className="text-xs text-gray-500">
          Sheriffs and Civil Process Act: a writ served outside the issuing state must carry the endorsement, and the
          time to appear runs from it.
        </p>
        <div>
          <label htmlFor={id("deemed")} className="text-sm font-medium text-gray-900">Deemed served on</label>
          <input
            id={id("deemed")} type="date" value={deemedServedOn}
            onChange={(e) => setDeemedServedOn(e.target.value)} className={field}
          />
          <p className="mt-1 text-xs text-gray-500">
            When the rules deem service effected — post, publication or an order — if that is not the day above.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor={id("note")} className="text-sm font-medium text-gray-900">Note</label>
        <p className="text-xs text-gray-500">
          Kept with the service record for your firm. The other side receives the process itself; it never sees this note.
        </p>
        <textarea
          id={id("note")} rows={2} maxLength={4000} value={note}
          onChange={(e) => setNote(e.target.value)} className={field}
        />
      </div>

      <div className="space-y-2">
        <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
          {pending ? "Serving…" : "Record service"}
        </Button>
        <p className="text-center text-xs text-gray-500">
          Your client sees that the process was served, and on whom. Your note to the file stays with your firm.
        </p>
      </div>
    </form>
  );
}
