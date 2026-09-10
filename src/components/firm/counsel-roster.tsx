"use client";

// Who acts for the other parties on this matter — the counsel roster.
//
// What this screen is: an address book for service, and nothing else. A
// matter_counsel row never gives anyone a login: counsel on the other side sees
// a process actually served on it and nothing else about the file. A colleague or
// a client's contact who should read the file is invited on the Parties tab
// instead — the two are different things, and the copy here says so.
//
// Rules enforced here:
//  · Counsel is either a firm on Docket (picked from the service directory, which
//    says whether that firm has undertaken to accept service here) or an address
//    for service off it. Nothing is invented: a firm not on Docket is typed.
//  · An undertaking to accept service is recorded on the row, because an
//    originating process may only be served on counsel who has given one, or
//    under an order for substituted service. serve_process() refuses otherwise.
//  · Every write runs as the signed-in staff member; the database decides, and
//    its refusals are shown exactly as it words them.
//  · Nothing firm-specific: the firm, the directory and the zone arrive as props.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCounsel, removeCounsel, updateCounsel } from "@/lib/actions/service";
import { ServeProcessForm, counselLabel } from "@/components/firm/serve-process-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import type { MatterCounselRow, ServiceDirectoryRow } from "@/lib/db/types";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

const SIDES: Array<{ value: string; label: string }> = [
  { value: "opposing", label: "Opposing counsel" },
  { value: "co_counsel", label: "Co-counsel" },
  { value: "other", label: "Other counsel" },
];

const PARTY_SIDES: Array<{ value: string; label: string }> = [
  { value: "claimant", label: "Claimant / plaintiff" },
  { value: "defendant", label: "Defendant" },
  { value: "appellant", label: "Appellant" },
  { value: "respondent", label: "Respondent" },
  { value: "applicant", label: "Applicant" },
  { value: "prosecution", label: "Prosecution" },
  { value: "accused", label: "Accused" },
  { value: "interested", label: "Interested party" },
  { value: "other", label: "Other" },
];

interface Draft {
  side: string;
  partyName: string;
  partySide: string;
  counselFirmId: string;
  counselName: string;
  counselFirmName: string;
  scn: string;
  email: string;
  phone: string;
  addressForService: string;
  onRecord: boolean;
  acceptsService: boolean;
  note: string;
}

function emptyDraft(): Draft {
  return {
    side: "opposing", partyName: "", partySide: "", counselFirmId: "", counselName: "", counselFirmName: "",
    scn: "", email: "", phone: "", addressForService: "", onRecord: false, acceptsService: false, note: "",
  };
}

function draftFrom(row: MatterCounselRow): Draft {
  return {
    side: row.side,
    partyName: row.party_name ?? "",
    partySide: row.party_side ?? "",
    counselFirmId: row.counsel_firm_id ?? "",
    counselName: row.counsel_name ?? "",
    counselFirmName: row.counsel_firm_name ?? "",
    scn: row.scn ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    addressForService: row.address_for_service ?? "",
    onRecord: row.on_record,
    acceptsService: row.accepts_service,
    note: row.note ?? "",
  };
}

/** The firm's address for service, as one line, from whatever the firm recorded. */
function addressLine(address: Record<string, unknown> | null | undefined): string {
  if (!address || typeof address !== "object") return "";
  return Object.values(address)
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(", ");
}

function chipClass(active: boolean): string {
  return cn(
    "min-h-[44px] rounded-xl border px-3 py-2 text-sm font-medium transition",
    active ? "border-brand bg-brand text-white" : "border-gray-300 bg-white text-gray-800 hover:border-brand",
  );
}

export function CounselRoster({
  matterId, firmId, counsel, directory, documents, timezone,
}: {
  matterId: string;
  firmId: string;
  counsel: MatterCounselRow[];
  directory: ServiceDirectoryRow[];
  documents: Array<{ id: string; name: string; current_version_id: string | null }>;
  timezone: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [mode, setMode] = useState<"docket" | "address">("docket");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [servingId, setServingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const directoryById = useMemo(
    () => new Map(directory.map((f) => [f.id, f])),
    [directory],
  );
  const alreadyOnRoster = useMemo(
    () => new Set(counsel.map((c) => c.counsel_firm_id).filter((id): id is string => Boolean(id))),
    [counsel],
  );
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone }),
    [timezone],
  );

  const serving = counsel.find((c) => c.id === servingId) ?? null;
  const servingName = serving
    ? (serving.counsel_firm_id ? directoryById.get(serving.counsel_firm_id)?.name : null) ?? counselLabel(serving)
    : null;

  function submitAdd() {
    setError(null);
    startTransition(async () => {
      const result = await addCounsel(matterId, {
        side: draft.side,
        partyName: draft.partyName.trim() || null,
        partySide: draft.partySide || null,
        counselFirmId: mode === "docket" ? draft.counselFirmId || null : null,
        counselName: draft.counselName.trim() || null,
        counselFirmName: mode === "address" ? draft.counselFirmName.trim() || null : null,
        scn: draft.scn.trim() || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        addressForService: draft.addressForService.trim() || null,
        onRecord: draft.onRecord,
        acceptsService: draft.acceptsService,
        note: draft.note.trim() || null,
      });
      if ("error" in result) { setError(result.error); return; }
      setDraft(emptyDraft());
      setAdding(false);
      router.refresh();
    });
  }

  function submitEdit(counselId: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateCounsel(counselId, {
        side: editDraft.side,
        partyName: editDraft.partyName.trim() || null,
        partySide: editDraft.partySide || null,
        counselName: editDraft.counselName.trim() || null,
        counselFirmName: editDraft.counselFirmName.trim() || null,
        scn: editDraft.scn.trim() || null,
        email: editDraft.email.trim() || null,
        phone: editDraft.phone.trim() || null,
        addressForService: editDraft.addressForService.trim() || null,
        onRecord: editDraft.onRecord,
        acceptsService: editDraft.acceptsService,
        note: editDraft.note.trim() || null,
      });
      if (result?.error) { setError(result.error); return; }
      setEditingId(null);
      router.refresh();
    });
  }

  function submitRemove(counselId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeCounsel(counselId);
      if (result?.error) { setError(result.error); return; }
      setConfirmRemove(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && <Alert kind="error" title="The database refused this">{error}</Alert>}

      <p className="text-sm text-gray-600">
        Counsel on the other side is an <span className="font-medium text-gray-900">address for service</span>, never
        access to this file. A firm on Docket sees only the processes you serve on it; everyone else is simply where a
        process is to be delivered. Someone who should read the matter is invited as a client or a contact instead.
      </p>

      {counsel.length === 0 ? (
        <EmptyState
          title="No counsel on record yet"
          hint="Record who acts for the other parties so you can serve processes on them and prove it."
          action={<Button onClick={() => { setAdding(true); setError(null); }}>Add counsel</Button>}
        />
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {counsel.map((row) => {
            const firm = row.counsel_firm_id ? directoryById.get(row.counsel_firm_id) ?? null : null;
            const sideLabel = SIDES.find((s) => s.value === row.side)?.label ?? row.side;
            const partySideLabel = PARTY_SIDES.find((p) => p.value === row.party_side)?.label ?? row.party_side;
            const editing = editingId === row.id;
            return (
              <li key={row.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {firm ? firm.name : counselLabel(row)}
                    </p>
                    <p className="text-sm text-gray-600">
                      {sideLabel}
                      {row.party_name ? ` · for ${row.party_name}` : ""}
                      {partySideLabel ? ` (${partySideLabel})` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge className={row.on_record ? "bg-emerald-50 text-emerald-900" : ""}>
                      {row.on_record ? "on record" : "not on record"}
                    </Badge>
                    <Badge className={row.accepts_service ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}>
                      {row.accepts_service ? "undertaken to accept service" : "no undertaking to accept service"}
                    </Badge>
                  </div>
                </div>

                <p className="text-sm text-gray-600">
                  {row.counsel_firm_id ? (
                    firm ? (
                      <>
                        On Docket ·{" "}
                        {firm.accepts_platform_service
                          ? "accepts service through Docket"
                          : "has not undertaken to accept service through Docket — serve at its address for service"}
                        {addressLine(firm.address_for_service) ? ` · ${addressLine(firm.address_for_service)}` : ""}
                      </>
                    ) : (
                      "On Docket · that firm is not currently active on the platform, so service through Docket will be refused"
                    )
                  ) : (
                    "Not on Docket · serve at the address below"
                  )}
                </p>

                <dl className="grid gap-x-4 gap-y-1 text-sm text-gray-700 sm:grid-cols-2">
                  {row.counsel_firm_id && row.counsel_name && (
                    <div className="flex gap-2"><dt className="text-gray-500">Counsel</dt><dd>{row.counsel_name}</dd></div>
                  )}
                  {row.scn && <div className="flex gap-2"><dt className="text-gray-500">SCN</dt><dd>{row.scn}</dd></div>}
                  {row.email && <div className="flex gap-2"><dt className="text-gray-500">Email</dt><dd className="truncate">{row.email}</dd></div>}
                  {row.phone && <div className="flex gap-2"><dt className="text-gray-500">Phone</dt><dd>{row.phone}</dd></div>}
                  {row.address_for_service && (
                    <div className="flex gap-2 sm:col-span-2">
                      <dt className="shrink-0 text-gray-500">Address for service</dt>
                      <dd className="whitespace-pre-wrap">{row.address_for_service}</dd>
                    </div>
                  )}
                  {row.note && (
                    <div className="flex gap-2 sm:col-span-2">
                      <dt className="shrink-0 text-gray-500">Note</dt>
                      <dd className="whitespace-pre-wrap">{row.note}</dd>
                    </div>
                  )}
                </dl>
                <p className="text-xs text-gray-500">Recorded {dateFmt.format(new Date(row.created_at))}</p>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => { setServingId(row.id); setError(null); }}>Serve a process</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setError(null);
                      setConfirmRemove(null);
                      if (editing) { setEditingId(null); return; }
                      setEditDraft(draftFrom(row));
                      setEditingId(row.id);
                    }}
                  >
                    {editing ? "Cancel" : "Edit"}
                  </Button>
                  {confirmRemove === row.id ? (
                    <>
                      <Button size="sm" variant="danger" disabled={pending} onClick={() => submitRemove(row.id)}>
                        {pending ? "Removing…" : "Yes, remove"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>Keep</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => { setError(null); setConfirmRemove(row.id); }}>Remove</Button>
                  )}
                </div>
                {confirmRemove === row.id && (
                  <p className="text-xs text-gray-500">
                    Counsel already served through Docket cannot be removed — the service record is your proof of service
                    and points at this row.
                  </p>
                )}

                {editing && (
                  <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <CounselFields
                      idPrefix={`edit_${row.id}`}
                      draft={editDraft}
                      setDraft={setEditDraft}
                      mode={row.counsel_firm_id ? "docket" : "address"}
                      lockedFirmName={firm?.name ?? null}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="md" disabled={pending} onClick={() => submitEdit(row.id)}>
                        {pending ? "Saving…" : "Save counsel"}
                      </Button>
                      <Button size="md" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!adding && counsel.length > 0 && (
        <Button variant="ghost" onClick={() => { setAdding(true); setError(null); }}>Add counsel</Button>
      )}

      {adding && (
        <div className="space-y-4 rounded-lg border border-gray-200 p-4">
          <div>
            <p className="text-sm font-medium text-gray-900">How will this counsel be served?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" aria-pressed={mode === "docket"} onClick={() => setMode("docket")} className={chipClass(mode === "docket")}>
                A firm on Docket
              </button>
              <button
                type="button"
                aria-pressed={mode === "address"}
                onClick={() => { setMode("address"); setDraft((d) => ({ ...d, counselFirmId: "" })); }}
                className={chipClass(mode === "address")}
              >
                An address for service
              </button>
            </div>
          </div>

          {mode === "docket" && (
            <DirectoryPicker
              directory={directory}
              excludeFirmId={firmId}
              alreadyOnRoster={alreadyOnRoster}
              value={draft.counselFirmId}
              onChange={(id) => setDraft((d) => ({ ...d, counselFirmId: id }))}
            />
          )}

          <CounselFields
            idPrefix="add"
            draft={draft}
            setDraft={setDraft}
            mode={mode}
            lockedFirmName={mode === "docket" ? directoryById.get(draft.counselFirmId)?.name ?? null : null}
          />

          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={pending} onClick={submitAdd}>
              {pending ? "Saving…" : "Add counsel"}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => { setAdding(false); setDraft(emptyDraft()); setError(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(serving)}
        onClose={() => setServingId(null)}
        title={servingName ? `Serve a process on ${servingName}` : "Serve a process"}
      >
        {serving && (
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <ServeProcessForm
              matterId={matterId}
              counsel={serving}
              documents={documents}
              timezone={timezone}
              onDone={() => setServingId(null)}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Pick the other side's firm from the platform's service directory. */
function DirectoryPicker({
  directory, excludeFirmId, alreadyOnRoster, value, onChange,
}: {
  directory: ServiceDirectoryRow[];
  excludeFirmId: string;
  alreadyOnRoster: Set<string>;
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return directory
      .filter((f) => f.id !== excludeFirmId && !alreadyOnRoster.has(f.id))
      .filter((f) => !q || `${f.name} ${f.legal_name ?? ""} ${f.state_code ?? ""}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [directory, excludeFirmId, alreadyOnRoster, query]);

  const picked = directory.find((f) => f.id === value) ?? null;

  if (directory.filter((f) => f.id !== excludeFirmId).length === 0) {
    return (
      <Alert kind="info" title="No other firm on Docket yet">
        Nobody else is on the platform to be served through it. Record counsel&apos;s address for service instead — choose
        &ldquo;An address for service&rdquo; above.
      </Alert>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor="counsel_directory_search" className="text-sm font-medium text-gray-900">Their firm on Docket</label>
      <input
        id="counsel_directory_search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search firms by name or state"
        className={field}
      />
      <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
        {options.length === 0 ? (
          <li className="px-3 py-4 text-sm text-gray-500">
            No firm matches that. If they are not on Docket, record their address for service instead.
          </li>
        ) : (
          options.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                aria-pressed={value === f.id}
                onClick={() => onChange(value === f.id ? "" : f.id)}
                className={cn(
                  "flex min-h-[44px] w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm",
                  value === f.id ? "bg-brand-surface" : "hover:bg-gray-50",
                )}
              >
                <span className="font-medium text-gray-900">{f.name}</span>
                <span className="text-xs text-gray-500">
                  {f.state_code ? `${f.state_code} · ` : ""}
                  {f.accepts_platform_service
                    ? "accepts service through Docket"
                    : "has not undertaken to accept service through Docket"}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
      {picked && !picked.accepts_platform_service && (
        <p className="text-xs text-amber-900">
          {picked.name} has not undertaken to accept service through Docket. You can still record them as counsel and
          serve at their address for service{addressLine(picked.address_for_service) ? `: ${addressLine(picked.address_for_service)}` : "."}
        </p>
      )}
    </div>
  );
}

/** The fields shared by adding counsel and editing them. */
function CounselFields({
  idPrefix, draft, setDraft, mode, lockedFirmName,
}: {
  idPrefix: string;
  draft: Draft;
  setDraft: (update: (d: Draft) => Draft) => void;
  mode: "docket" | "address";
  lockedFirmName: string | null;
}) {
  const id = (name: string) => `counsel_${idPrefix}_${name}`;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="text-sm font-medium text-gray-900">Which side?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {SIDES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={draft.side === s.value}
              onClick={() => set({ side: s.value })}
              className={chipClass(draft.side === s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={id("party")} className="text-sm font-medium text-gray-900">The party they act for</label>
          <input
            id={id("party")} type="text" maxLength={200} value={draft.partyName}
            onChange={(e) => set({ partyName: e.target.value })} placeholder="Adebayo Holdings Ltd" className={field}
          />
        </div>
        <div>
          <label htmlFor={id("partyside")} className="text-sm font-medium text-gray-900">That party is the…</label>
          <select id={id("partyside")} value={draft.partySide} onChange={(e) => set({ partySide: e.target.value })} className={field}>
            <option value="">Not recorded</option>
            {PARTY_SIDES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {mode === "docket" ? (
        <>
          {lockedFirmName && <p className="text-sm text-gray-600">Firm: <span className="font-medium text-gray-900">{lockedFirmName}</span></p>}
          <div>
            <label htmlFor={id("name")} className="text-sm font-medium text-gray-900">Counsel handling it (optional)</label>
            <input
              id={id("name")} type="text" maxLength={200} value={draft.counselName}
              onChange={(e) => set({ counselName: e.target.value })} placeholder="Chinwe Okafor, Esq." className={field}
            />
          </div>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={id("name")} className="text-sm font-medium text-gray-900">Counsel&apos;s name</label>
            <input
              id={id("name")} type="text" maxLength={200} value={draft.counselName}
              onChange={(e) => set({ counselName: e.target.value })} placeholder="Chinwe Okafor, Esq." className={field}
            />
          </div>
          <div>
            <label htmlFor={id("chambers")} className="text-sm font-medium text-gray-900">Their firm or chambers</label>
            <input
              id={id("chambers")} type="text" maxLength={200} value={draft.counselFirmName}
              onChange={(e) => set({ counselFirmName: e.target.value })} placeholder="Okafor & Co." className={field}
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={id("scn")} className="text-sm font-medium text-gray-900">SCN</label>
          <input
            id={id("scn")} type="text" maxLength={40} value={draft.scn}
            onChange={(e) => set({ scn: e.target.value })} placeholder="SCN012345" className={field}
          />
        </div>
        <div>
          <label htmlFor={id("email")} className="text-sm font-medium text-gray-900">Email</label>
          <input
            id={id("email")} type="email" maxLength={200} value={draft.email}
            onChange={(e) => set({ email: e.target.value })} placeholder="counsel@chambers.ng" className={field}
          />
        </div>
        <div>
          <label htmlFor={id("phone")} className="text-sm font-medium text-gray-900">Phone</label>
          <input
            id={id("phone")} type="tel" maxLength={40} value={draft.phone}
            onChange={(e) => set({ phone: e.target.value })} placeholder="0803…" className={field}
          />
        </div>
      </div>

      <div>
        <label htmlFor={id("address")} className="text-sm font-medium text-gray-900">Address for service</label>
        <textarea
          id={id("address")} rows={2} maxLength={600} value={draft.addressForService}
          onChange={(e) => set({ addressForService: e.target.value })}
          placeholder="12 Awolowo Road, Ikoyi, Lagos" className={field}
        />
        <p className="mt-1 text-xs text-gray-500">Where a process is to be delivered. This is not a login: counsel never sees the file.</p>
      </div>

      <label className="flex min-h-[44px] items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" checked={draft.onRecord} onChange={(e) => set({ onRecord: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0" />
        Counsel is on record for that party
      </label>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <label className="flex min-h-[44px] items-start gap-2 text-sm font-medium text-amber-900">
          <input
            type="checkbox" checked={draft.acceptsService} onChange={(e) => set({ acceptsService: e.target.checked })}
            className="mt-0.5 h-5 w-5 shrink-0"
          />
          Counsel has undertaken to accept service for that party
        </label>
        <p className="text-xs text-amber-900">
          Tick this only where the undertaking was given in writing or on the record. Without it, an originating process
          may not be served on counsel — it goes to the party, or under an order for substituted service.
        </p>
      </div>

      <div>
        <label htmlFor={id("note")} className="text-sm font-medium text-gray-900">Note</label>
        <textarea
          id={id("note")} rows={2} maxLength={2000} value={draft.note}
          onChange={(e) => set({ note: e.target.value })}
          placeholder="Undertaking given at the mention of 3 March; junior counsel copies by email." className={field}
        />
      </div>
    </div>
  );
}
