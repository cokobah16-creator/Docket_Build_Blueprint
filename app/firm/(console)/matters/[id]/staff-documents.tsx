"use client";

// The firm's documents on a matter. Staff see every one — the client sees only
// those marked client-visible, which is a deliberate act on this screen and
// never a side effect of uploading.
//
// Rules enforced here:
//  · A staff upload is staff-only until somebody shares it: the documents row
//    is written with client_visible = false and the toggle below is the only
//    way it changes.
//  · Every write runs as the signed-in staff member. The documents policy
//    (staff_w + uploaded_by = auth.uid()) and the storage policy
//    (can_upload_document) are the authorization; no service key is used. Ids
//    are generated here and the inserts return nothing, because the select
//    policy cannot read a row inserted by the same statement.
//  · A file is read through a signed URL that expires in two minutes — there
//    are no public document URLs anywhere in Docket.
//  · Low-data mode defers every preview until it is asked for.
//  · Execution (migration 40): a document generated from a template is filled by the database
//    from the matter's facts and refuses to guess; a signature is asked for, and recorded, over
//    a named version and its checksum; an instrument executed on paper is recorded, not signed
//    here. Once executed, the document is locked on that version — the share toggle and "new
//    version" disappear because the database refuses them, not the other way round.

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestDocument, cancelDocumentRequest } from "@/lib/actions/matters";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { recordDocumentOpen } from "@/lib/document-open";
import { isLowData } from "@/lib/low-data";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import type { DocumentRequestRow, DocumentRow, DocumentVersionRow } from "@/lib/db/types";
import { sha256Hex } from "@/lib/checksum";
import { NOT_SENT, UPLOAD_STOPPED, clearDraft, draftKey, isAlreadyStored, isNetworkFailure, readDraft, uploadKey, useDeviceDraft, writeDraft, type UploadInProgress } from "@/lib/drafts";
import { OfflineNote, useConnectionState } from "@/components/ui/connection";
import { retireEmptyDocument } from "@/lib/actions/portal";
import { generateDocument, recordPaperExecution, requestSignature } from "@/lib/actions/templates";
import { SignDialog } from "@/components/portal/sign-dialog";
import type { DocumentSignatureRow, DocumentTemplateRow, MatterType } from "@/lib/db/types";

export type StaffDocument = DocumentRow & { version: DocumentVersionRow | null; version_count: number };

const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 25 * 1024 * 1024;

function fmtSize(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** documents/{firm}/{document}/{version}.{ext} — the shape the storage policy reads. */
function storagePathFor(firmId: string, documentId: string, versionId: string, fileName: string) {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  return `${firmId}/${documentId}/${versionId}.${ext}`;
}

export function StaffDocuments({
  firmId, matterId, userId, documents, timezone, names, requests = [], templates = [], matterType = null, clients = [], signatures = [], profileName = null,
}: {
  firmId: string;
  matterId: string;
  userId: string;
  documents: StaffDocument[];
  timezone: string;
  /** user id → who uploaded it (staff or the client who sent it in). */
  names: Record<string, string>;
  /** What the client has been asked for (migration 31). */
  requests?: DocumentRequestRow[];
  /** The firm's templates, retired ones included so a version's origin can still be named (migration 40). */
  templates?: DocumentTemplateRow[];
  /** The matter's type, to offer only templates that fit. */
  matterType?: string | null;
  /** The matter's clients, for a template addressed to one of them. */
  clients?: Array<{ id: string; name: string }>;
  /** Signatures recorded on these documents. */
  signatures?: DocumentSignatureRow[];
  /** The signed-in member's name as their profile has it, for the sign step. */
  profileName?: string | null;
}) {
  const router = useRouter();
  const [askOpen, setAskOpen] = useState(false);
  // The request as typed, kept on this device until it is asked (src/lib/drafts.ts).
  // The reference is part of the draft, so a request whose reply was lost is the same request on
  // the next attempt and the client is not asked twice (migration 36).
  const askDraft = useDeviceDraft<{ title: string; why: string; due: string; ref: string }>(draftKey(userId, `document-request:${matterId}`), { title: "", why: "", due: "", ref: crypto.randomUUID() }, (v) => !v.title.trim() && !v.why.trim() && !v.due);
  const askTitle = askDraft.value.title, askWhy = askDraft.value.why, askDue = askDraft.value.due;
  const setAskTitle = (t: string) => askDraft.set((v) => ({ ...v, title: t }));
  const setAskWhy = (t: string) => askDraft.set((v) => ({ ...v, why: t }));
  const setAskDue = (t: string) => askDraft.set((v) => ({ ...v, due: t }));
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const { online } = useConnectionState();

  async function ask(e: FormEvent) {
    e.preventDefault();
    setAskError(null); setAskBusy(true);
    try {
      const r = await requestDocument(matterId, firmId, { title: askTitle, why: askWhy || undefined, dueOn: askDue || null }, askDraft.value.ref);
      if (r?.error) { setAskError(r.error); return; }
      askDraft.clear();
      askDraft.set((v) => ({ ...v, ref: crypto.randomUUID() }));
      setAskOpen(false);
      router.refresh();
    } catch (err) {
      setAskError(isNetworkFailure(err) ? NOT_SENT : (err instanceof Error ? err.message : NOT_SENT));
    } finally {
      setAskBusy(false);
    }
  }
  async function withdraw(id: string) {
    setAskError(null);
    const r = await cancelDocumentRequest(id, matterId);
    if (r?.error) { setAskError(r.error); return; }
    router.refresh();
  }
  const openRequests = requests.filter((r) => !r.fulfilled_at && !r.cancelled_at);
  const dayFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lowData, setLowData] = useState(false);
  const [shared, setShared] = useState<Record<string, boolean>>({});
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ doc: StaffDocument; url: string | null; loading: boolean } | null>(null);
  const [versions, setVersions] = useState<Record<string, DocumentVersionRow[]>>({});

  useEffect(() => setLowData(isLowData()), []);

  const isShared = useCallback((d: StaffDocument) => shared[d.id] ?? d.client_visible, [shared]);

  /** A file the client sent in, which nobody here has marked as looked at yet. */
  const isClientUpload = useCallback((d: StaffDocument) => d.category === "client_upload" && d.uploaded_by !== userId, [userId]);
  const isReviewed = useCallback((d: StaffDocument) => reviewed[d.id] ?? Boolean(d.reviewed_at), [reviewed]);

  /** New document: row first (the storage policy reads it), then the file, then the version. */
  const upload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) { setError("Files must be 25 MB or smaller."); return; }
    const supabase = supabaseBrowser();
    if (!supabase) { setError("Not configured."); return; }

    // The ids for this file are kept on the device while the upload is in flight: the same file
    // chosen again after a drop finishes this document rather than starting a second one.
    const key = uploadKey(userId, `matter:${matterId}`);
    const prior = readDraft<UploadInProgress>(key);
    const reuse = prior && prior.name === file.name && prior.size === file.size ? prior : null;
    const documentId = reuse?.documentId ?? crypto.randomUUID();
    const versionId = reuse?.versionId ?? crypto.randomUUID();
    const path = reuse?.storagePath ?? storagePathFor(firmId, documentId, versionId, file.name);

    setBusy(`Uploading ${file.name}…`);
    try {
      if (!reuse) {
        // Kept before the insert, not after its reply: the ids are minted here, so a reply that
        // never arrives must not be the reason the device forgets which row it just made.
        writeDraft(key, { name: file.name, size: file.size, documentId, versionId, storagePath: path });
        const { error: docError } = await supabase.from("documents").insert({
          id: documentId,
          firm_id: firmId,
          matter_id: matterId,
          appointment_id: null,
          name: file.name.slice(0, 200),
          category: "firm_upload",
          client_visible: false,
          uploaded_by: userId,
        });
        // The same id twice is this row already made — the first reply was lost, not the insert.
        if (docError && docError.code !== "23505") { clearDraft(key); setError(docError.message); return; }
      }

      // Hash before the upload, from the file the person actually chose.
      const checksum = await sha256Hex(file);

      const { error: upError } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
      // A resume that fails for anything but the network is a resume onto a row that is no
      // longer there to write to — retired by a colleague, most often. Keeping the record would
      // make every later attempt with the same file fail the same way, with no row on screen to
      // remove and no way out but renaming the file. Forget it and start a fresh document.
      if (upError && !isAlreadyStored(upError.message)) {
        if (reuse) { clearDraft(key); setError(`That upload could not be finished — the document it belonged to is gone. Choose the file again to send it as a new one.`); }
        else setError(`Upload failed: ${upError.message}`);
        return;
      }

      const { error: versionError } = await supabase.from("document_versions").insert({
        id: versionId,
        document_id: documentId,
        storage_path: path,
        mime: file.type || "application/octet-stream",
        size_bytes: file.size,
        checksum,
        uploaded_by: userId,
      });
      if (versionError && versionError.code !== "23505") { if (reuse) clearDraft(key); setError(versionError.message); return; }
      clearDraft(key);
      router.refresh();
    } catch (err) {
      setError(isNetworkFailure(err) ? UPLOAD_STOPPED : (err instanceof Error ? err.message : UPLOAD_STOPPED));
    } finally {
      setBusy(null);
    }
  }, [firmId, matterId, router, userId]);

  const remove = useCallback(async (doc: StaffDocument) => {
    setError(null);
    setBusy(`Removing ${doc.name}…`);
    try {
      const r = await retireEmptyDocument(doc.id);
      if (r?.error) { setError(r.error); return; }
      // Only when it is this row's record: another row's stopped upload is still finishable.
      const k = uploadKey(userId, `matter:${matterId}`);
      if (readDraft<UploadInProgress>(k)?.documentId === doc.id) clearDraft(k);
      router.refresh();
    } catch (err) {
      setError(isNetworkFailure(err) ? "Not removed — the connection dropped." : (err instanceof Error ? err.message : "Not removed."));
    } finally {
      setBusy(null);
    }
  }, [matterId, router, userId]);

  /** A further version of a document already on the file; the trigger moves current_version_id. */
  const uploadVersion = useCallback(async (doc: StaffDocument, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) { setError("Files must be 25 MB or smaller."); return; }
    const supabase = supabaseBrowser();
    if (!supabase) { setError("Not configured."); return; }

    const versionId = crypto.randomUUID();
    const path = storagePathFor(firmId, doc.id, versionId, file.name);
    setBusy(`Adding a version of ${doc.name}…`);
    const checksum = await sha256Hex(file);
    const { error: upError } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upError) { setBusy(null); setError(`Upload failed: ${upError.message}`); return; }
    const { error: versionError } = await supabase.from("document_versions").insert({
      id: versionId,
      document_id: doc.id,
      storage_path: path,
      mime: file.type || "application/octet-stream",
      size_bytes: file.size,
      checksum,
      uploaded_by: userId,
    });
    setBusy(null);
    if (versionError) { setError(versionError.message); return; }
    setVersions((v) => { const c = { ...v }; delete c[doc.id]; return c; });
    router.refresh();
  }, [firmId, router, userId]);

  const toggleShared = useCallback(async (doc: StaffDocument) => {
    const next = !isShared(doc);
    const supabase = supabaseBrowser();
    if (!supabase) { setError("Not configured."); return; }
    setError(null);
    setBusy(`Updating ${doc.name}…`);
    const { error: updateError } = await supabase.from("documents").update({ client_visible: next }).eq("id", doc.id);
    setBusy(null);
    if (updateError) { setError(updateError.message); return; }
    setShared((s) => ({ ...s, [doc.id]: next }));
    router.refresh();
  }, [isShared, router]);

  /**
   * Mark a client's upload as looked at. firm_overview counts only unreviewed ones,
   * so this is what takes it off "Client uploads to review" — without it the counter
   * only ever climbs and means nothing.
   */
  const markReviewed = useCallback(async (doc: StaffDocument) => {
    const supabase = supabaseBrowser();
    if (!supabase) { setError("Not configured."); return; }
    setError(null);
    setBusy(`Marking ${doc.name} as reviewed…`);
    const { error: updateError } = await supabase
      .from("documents")
      .update({ reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq("id", doc.id);
    setBusy(null);
    if (updateError) { setError(updateError.message); return; }
    setReviewed((r) => ({ ...r, [doc.id]: true }));
    router.refresh();
  }, [router, userId]);

  const openPreview = useCallback(async (doc: StaffDocument, version: DocumentVersionRow | null, force = false) => {
    const target = version ?? doc.version;
    if (!target) return;
    const shown: StaffDocument = { ...doc, version: target };
    if (lowData && !force) { setPreview({ doc: shown, url: null, loading: false }); return; }
    setPreview({ doc: shown, url: null, loading: true });
    const supabase = supabaseBrowser();
    if (!supabase) { setPreview(null); setError("Not configured."); return; }
    // Record the read first: the storage policy requires it (migration 30), and it is what the
    // audit log shows as document.opened.
    const refused = await recordDocumentOpen(supabase, target.id);
    if (refused) { setError(refused); setPreview(null); return; }
    const { data, error: signError } = await supabase.storage.from("documents").createSignedUrl(target.storage_path, 120);
    if (signError || !data?.signedUrl) { setError(signError?.message ?? "Could not open the document."); setPreview(null); return; }
    setPreview({ doc: shown, url: data.signedUrl, loading: false });
  }, [lowData]);

  const loadVersions = useCallback(async (doc: StaffDocument) => {
    if (versions[doc.id]) { setVersions((v) => { const c = { ...v }; delete c[doc.id]; return c; }); return; }
    const supabase = supabaseBrowser();
    if (!supabase) return;
    const { data } = await supabase
      .from("document_versions")
      .select("id, document_id, storage_path, mime, size_bytes, uploaded_by, created_at")
      .eq("document_id", doc.id)
      .order("created_at", { ascending: false });
    setVersions((v) => ({ ...v, [doc.id]: (data ?? []) as DocumentVersionRow[] }));
  }, [versions]);

  // ---- execution (migration 40)
  const usable = templates.filter((t) => !t.retired_at && (!t.matter_types || !matterType || t.matter_types.includes(matterType as MatterType)));
  const [genOpen, setGenOpen] = useState(false);
  const [gen, setGen] = useState({ templateId: "", name: "", clientId: clients[0]?.id ?? "", extra: {} as Record<string, string> });
  const [genBusy, setGenBusy] = useState(false);
  const genTemplate = usable.find((t) => t.id === gen.templateId) ?? null;
  const extraKeys = genTemplate ? Array.from(new Set(Array.from(genTemplate.body.matchAll(/\{extra\.([a-z0-9_]{1,40})\}/g)).map((m) => m[1]))) : [];
  const [signing, setSigning] = useState<{ doc: StaffDocument; version: DocumentVersionRow } | null>(null);
  const [paperFor, setPaperFor] = useState<string | null>(null);
  const [paper, setPaper] = useState({ executedOn: "", witnessName: "", attestedBy: "", stampRef: "", registrationRef: "" });

  /** How a document is executed: from the template its version came from, else the lawyer decides. */
  const executionOf = useCallback((d: StaffDocument) => {
    const t = d.version?.source_template_id ? templates.find((x) => x.id === d.version?.source_template_id) : null;
    return t?.execution ?? "either";
  }, [templates]);
  const isLocked = (d: StaffDocument) => Boolean(d.locked_version_id);
  const signaturesOf = (d: StaffDocument) => signatures.filter((sg) => sg.document_id === d.id);

  async function generate(e: FormEvent) {
    e.preventDefault();
    if (!genTemplate) return;
    setGenBusy(true); setError(null);
    try {
      const extra: Record<string, string> = {};
      for (const k of extraKeys) extra[k] = gen.extra[k] ?? "";
      const r = await generateDocument({ matterId, templateId: genTemplate.id, name: gen.name || null, clientId: clients.length ? (gen.clientId || null) : null, extra });
      if ("error" in r) { setError(r.error); return; }
      setGenOpen(false); setGen({ templateId: "", name: "", clientId: clients[0]?.id ?? "", extra: {} });
      router.refresh();
    } catch (err) { setError(isNetworkFailure(err) ? "Not generated — the connection dropped. If the document appears without a file, remove it and try again." : (err instanceof Error ? err.message : "Not generated.")); }
    finally { setGenBusy(false); }
  }
  async function askSignature(d: StaffDocument) {
    setError(null); setBusy(`Asking for a signature on ${d.name}…`);
    try {
      const r = await requestSignature(d.id, matterId);
      if (r?.error) { setError(r.error); return; }
      router.refresh();
    } catch (err) { setError(isNetworkFailure(err) ? NOT_SENT : (err instanceof Error ? err.message : NOT_SENT)); }
    finally { setBusy(null); }
  }
  async function savePaper(e: FormEvent, d: StaffDocument) {
    e.preventDefault();
    if (!d.version) return;
    setError(null); setBusy(`Recording the execution of ${d.name}…`);
    try {
      const r = await recordPaperExecution({ documentId: d.id, versionId: d.version.id, matterId, ...paper });
      if (r?.error) { setError(r.error); return; }
      setPaperFor(null); setPaper({ executedOn: "", witnessName: "", attestedBy: "", stampRef: "", registrationRef: "" });
      router.refresh();
    } catch (err) { setError(isNetworkFailure(err) ? NOT_SENT : (err instanceof Error ? err.message : NOT_SENT)); }
    finally { setBusy(null); }
  }

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const isImage = (m?: string | null) => Boolean(m && m.startsWith("image/"));
  const isPdf = (m?: string | null) => m === "application/pdf";

  return (
    <div>

      {/* What the client has been asked for. A request is a row: it shows here, on the client's
          documents tab, and in their notifications, until it is answered or withdrawn. */}
      <section className="border-b border-gray-100 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Asked of the client</h3>
          <Button size="sm" variant="ghost" onClick={() => setAskOpen((o) => !o)}>{askOpen ? "Cancel" : "Ask for a document"}</Button>
        </div>
        {askError && <div className="mt-2"><Alert kind="error">{askError}</Alert></div>}
        {askOpen && (
          <form onSubmit={ask} className="mt-3 grid gap-2 sm:grid-cols-3">
            <input value={askTitle} onChange={(e) => setAskTitle(e.target.value)} required maxLength={200} placeholder="What document" className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-2" />
            <input type="date" value={askDue} onChange={(e) => setAskDue(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" aria-label="By when" />
            <input value={askWhy} onChange={(e) => setAskWhy(e.target.value)} maxLength={2000} placeholder="Why it is needed (the client sees this)" className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:col-span-3" />
            <div className="sm:col-span-3"><Button type="submit" size="sm" disabled={askBusy || !online || askTitle.trim().length < 2}>{askBusy ? "Asking…" : "Ask"}</Button>{askDraft.restored && <span className="ml-2 text-xs text-gray-600">Draft restored.</span>}<OfflineNote /></div>
          </form>
        )}
        {openRequests.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">Nothing outstanding.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {openRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-gray-900">{r.title}</span>
                  <span className="text-xs text-gray-600">
                    {r.due_on ? ` · by ${dayFmt.format(new Date(`${r.due_on}T00:00:00Z`))}` : ""}
                    {r.requested_by && names[r.requested_by] ? ` · asked by ${names[r.requested_by]}` : ""}
                  </span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => withdraw(r.id)}>Withdraw</Button>
              </li>
            ))}
          </ul>
        )}
        {requests.some((r) => r.fulfilled_at) && (
          <p className="mt-2 text-xs text-[#15803D]">Answered: {requests.filter((r) => r.fulfilled_at).map((r) => r.title).join(", ")}.</p>
        )}
      </section>
      {/* A document drawn from a template. The database fills it from the matter's facts and
          names any it has no value for; nothing is guessed and nothing is typed except what the
          template marks as typed. */}
      {templates.length > 0 && (
        <section className="border-b border-gray-100 px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">From a template</h3>
            <Button size="sm" variant="ghost" onClick={() => setGenOpen((o) => !o)} disabled={usable.length === 0}>{genOpen ? "Cancel" : "Generate a document"}</Button>
          </div>
          {usable.length === 0 && <p className="mt-1 text-xs text-gray-500">None of the firm&apos;s templates is for {matterType?.replace(/_/g, " ") ?? "this"} matters.</p>}
          {genOpen && (
            <form onSubmit={generate} className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-gray-700 sm:col-span-2">Template
                <select value={gen.templateId} onChange={(e) => setGen({ ...gen, templateId: e.target.value, extra: {} })} required className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Choose…</option>
                  {usable.map((t) => <option key={t.id} value={t.id}>{t.name} · v{t.version} · {t.execution === "paper" ? "executed on paper" : t.execution === "electronic" ? "signed in Docket" : "either"}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-700">Document name
                <input value={gen.name} onChange={(e) => setGen({ ...gen, name: e.target.value })} maxLength={200} placeholder={genTemplate?.name ?? "As the template"} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              {clients.length > 1 && (
                <label className="text-xs text-gray-700">Addressed to
                  <select value={gen.clientId} onChange={(e) => setGen({ ...gen, clientId: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              )}
              {extraKeys.map((k) => (
                <label key={k} className="text-xs text-gray-700 sm:col-span-2">{k.replace(/_/g, " ")} <span className="text-gray-500">(typed for this document)</span>
                  <input value={gen.extra[k] ?? ""} onChange={(e) => setGen({ ...gen, extra: { ...gen.extra, [k]: e.target.value } })} required maxLength={2000} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </label>
              ))}
              {genTemplate?.note && <p className="text-xs text-gray-500 sm:col-span-2">{genTemplate.note}</p>}
              <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={genBusy || !online || !genTemplate}>{genBusy ? "Generating…" : "Generate"}</Button><OfflineNote /></div>
            </form>
          )}
        </section>
      )}
      {error && <div className="px-4 pt-4 sm:px-5"><Alert kind="error" title="That was refused">{error}</Alert></div>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
        <p className="text-xs text-gray-500">
          PDF, Word, JPEG, PNG or HEIC · up to 25 MB · uploaded here it stays with the firm until you share it.
        </p>
        <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90">
          {busy?.startsWith("Uploading") ? busy : "Upload a document"}
          <input type="file" accept={ACCEPT} className="sr-only" onChange={upload} disabled={Boolean(busy)} />
        </label>
      </div>

      {documents.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-500">
          Nothing filed on this matter yet. Upload the processes, exhibits or correspondence — then share with the client the ones they should have.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {documents.map((d) => {
            const uploader = d.uploaded_by ? names[d.uploaded_by] ?? null : null;
            const rows = versions[d.id];
            return (
              <li key={d.id} id={`doc-${d.id}`} className="scroll-mt-20 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{d.name}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {fmt.format(new Date(d.created_at))}
                      {uploader ? ` · ${uploader}` : ""}
                      {d.version?.size_bytes ? ` · ${fmtSize(d.version.size_bytes)}` : ""}
                      {d.category ? ` · ${d.category.replace(/_/g, " ")}` : ""}
                      {d.version_count > 1 && (
                        <>
                          {" · "}
                          <button type="button" className="underline" onClick={() => loadVersions(d)}>
                            {d.version_count} versions
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                  {d.version ? (
                    <Button size="sm" variant="ghost" onClick={() => openPreview(d, null)}>
                      {isImage(d.version.mime) || isPdf(d.version.mime) ? "Preview" : "Download"}
                    </Button>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[#92400E]">No file yet — the upload stopped.</span>
                      {/* Bound to this row, so it finishes THIS document on any device, rather than
                          depending on ids this browser happens to still hold. */}
                      <label className="inline-flex min-h-[36px] cursor-pointer items-center rounded-lg border border-gray-300 px-3 text-sm text-gray-800 hover:bg-black/5">
                        Finish upload
                        <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => uploadVersion(d, e)} disabled={Boolean(busy)} />
                      </label>
                      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => remove(d)}>Remove</Button>
                    </span>
                  )}
                </div>

                {(isLocked(d) || signaturesOf(d).length > 0 || d.signature_requested_at) && (
                  <div className="mt-2 space-y-1 text-xs">
                    {isLocked(d) && (
                      <p className="font-medium text-[#15803D]">
                        {d.version?.kind === "executed_paper" && d.version.executed_on
                          ? `Executed on paper on ${dayFmt.format(new Date(`${d.version.executed_on}T00:00:00Z`))}${d.version.witness_name ? ` before ${d.version.witness_name}` : ""}${d.version.attested_by ? `, attested by ${d.version.attested_by}` : ""}${d.version.stamp_ref ? ` · stamp ${d.version.stamp_ref}` : ""}${d.version.registration_ref ? ` · registered ${d.version.registration_ref}` : ""}`
                          : "Executed"} · locked on this version{d.locked_at ? ` since ${fmt.format(new Date(d.locked_at))}` : ""}
                      </p>
                    )}
                    {signaturesOf(d).map((sg) => (
                      <p key={sg.id} className="text-gray-700">Signed by {sg.signer_name} ({sg.signer_role === "staff" ? `for the firm${sg.signer_scn ? `, ${sg.signer_scn}` : ""}` : "client"}) · {fmt.format(new Date(sg.signed_at))} · over checksum {sg.checksum.slice(0, 12)}…</p>
                    ))}
                    {!isLocked(d) && d.signature_requested_at && <p className="text-[#92400E]">Signature asked for {fmt.format(new Date(d.signature_requested_at))}{d.signature_requested_by && names[d.signature_requested_by] ? ` by ${names[d.signature_requested_by]}` : ""} · not yet signed</p>}
                  </div>
                )}
                {d.version?.checksum && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {!isLocked(d) && executionOf(d) !== "paper" && !d.signature_requested_at && (
                      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => askSignature(d)}>Ask the client to sign</Button>
                    )}
                    {executionOf(d) !== "paper" && d.version.kind !== "executed_paper" && !signaturesOf(d).some((sg) => sg.signer_id === userId && sg.version_id === d.version?.id) && (!isLocked(d) || d.locked_version_id === d.version.id) && (
                      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => d.version && setSigning({ doc: d, version: d.version })}>Sign for the firm</Button>
                    )}
                    {!isLocked(d) && executionOf(d) !== "electronic" && (
                      <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setPaperFor(paperFor === d.id ? null : d.id)}>{paperFor === d.id ? "Cancel" : "Record execution on paper"}</Button>
                    )}
                  </div>
                )}
                {paperFor === d.id && d.version && (
                  <form onSubmit={(e) => savePaper(e, d)} className="mt-2 grid gap-2 rounded-lg bg-gray-50 p-3 sm:grid-cols-2">
                    <p className="text-xs text-gray-600 sm:col-span-2">This version is the executed copy as uploaded. Recording it locks the document on it; the day is the day on the instrument.</p>
                    <label className="text-xs text-gray-700">Executed on<input type="date" required value={paper.executedOn} onChange={(e) => setPaper({ ...paper, executedOn: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
                    <label className="text-xs text-gray-700">Witness<input value={paper.witnessName} onChange={(e) => setPaper({ ...paper, witnessName: e.target.value })} maxLength={200} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
                    <label className="text-xs text-gray-700">Attested by<input value={paper.attestedBy} onChange={(e) => setPaper({ ...paper, attestedBy: e.target.value })} maxLength={200} placeholder="Commissioner for Oaths, notary…" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
                    <label className="text-xs text-gray-700">Stamp duty reference<input value={paper.stampRef} onChange={(e) => setPaper({ ...paper, stampRef: e.target.value })} maxLength={120} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
                    <label className="text-xs text-gray-700">Registration reference<input value={paper.registrationRef} onChange={(e) => setPaper({ ...paper, registrationRef: e.target.value })} maxLength={120} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>
                    <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={Boolean(busy) || !online}>Record</Button><OfflineNote /></div>
                  </form>
                )}

                {!isLocked(d) && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label
                    className={cn(
                      "inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm",
                      isShared(d) ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-gray-300 bg-white text-gray-700",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={isShared(d)}
                      disabled={Boolean(busy)}
                      onChange={() => toggleShared(d)}
                    />
                    {isShared(d) ? "Your client can see this" : "Staff only — your client cannot see this"}
                  </label>
                  <label className="cursor-pointer text-sm text-brand underline">
                    Upload a new version
                    <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => uploadVersion(d, e)} disabled={Boolean(busy)} />
                  </label>
                  {isClientUpload(d) &&
                    (isReviewed(d) ? (
                      <span className="text-sm text-gray-500">Reviewed</span>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => markReviewed(d)} disabled={Boolean(busy)}>
                        Mark as reviewed
                      </Button>
                    ))}
                </div>}
                {isLocked(d) && <p className="mt-2 text-xs text-gray-500">{isShared(d) ? "Your client can see this." : "Staff only."} Executed: no further version, and the visibility set when it was signed stays.</p>}

                {rows && (
                  <ul className="mt-3 space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                    {rows.length === 0 && <li>No versions recorded — the file was never uploaded.</li>}
                    {rows.map((v, i) => (
                      <li key={v.id} className="flex flex-wrap justify-between gap-2">
                        <span>
                          Version {rows.length - i} · {fmt.format(new Date(v.created_at))}
                          {v.size_bytes ? ` · ${fmtSize(v.size_bytes)}` : ""}
                          {v.uploaded_by && names[v.uploaded_by] ? ` · ${names[v.uploaded_by]}` : ""}
                          {v.id === d.current_version_id ? " · current" : ""}
                        </span>
                        <button type="button" className="underline" onClick={() => openPreview(d, v, true)}>Open</button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {signing && (
        <SignDialog open name={signing.doc.name} versionId={signing.version.id} storagePath={signing.version.storage_path} matterId={matterId} profileName={profileName}
          onClose={() => setSigning(null)} onSigned={() => { setSigning(null); router.refresh(); }} />
      )}

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.doc.name ?? "Document"}>
        {preview && (preview.loading ? (
          <p className="text-sm text-gray-600">Preparing a secure link…</p>
        ) : !preview.url ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">Low-data mode is on. Load this {fmtSize(preview.doc.version?.size_bytes) || "file"} preview?</p>
            <Button onClick={() => openPreview(preview.doc, preview.doc.version, true)}>Load preview</Button>
          </div>
        ) : isImage(preview.doc.version?.mime) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={preview.doc.name} className="max-h-[70vh] w-full rounded-lg object-contain" />
        ) : isPdf(preview.doc.version?.mime) ? (
          <div className="space-y-3">
            <iframe src={preview.url} title={preview.doc.name} className="h-[70vh] w-full rounded-lg border border-gray-200" />
            <a href={preview.url} target="_blank" rel="noreferrer" className="text-sm text-brand underline">Open in a new tab</a>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">This file type has no in-app preview.</p>
            <a href={preview.url} className="inline-flex rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on" download={preview.doc.name}>Download</a>
          </div>
        ))}
        <p className="mt-3 text-xs text-gray-500">Links expire after two minutes.</p>
      </Modal>
    </div>
  );
}
