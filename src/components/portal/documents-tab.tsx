"use client";

// Documents on a matter (or appointment): client uploads to
// documents/{firm}/{document}/{version}.{ext} through the storage policy,
// previews PDFs and images through short signed URLs, lists versions.
// Low-data mode defers every preview until tapped.
//
// The client's wording follows docs/VOICE.md. The console renders this list too (audience
// "staff", on a consultation, with no uploads and no requests), and keeps its own wording, so
// every sentence that changed for the client still reads as it did there.

import { userErrorMessage } from "@/lib/user-error-message";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { recordDocumentOpen } from "@/lib/document-open";
import { isAlreadyStored, isNetworkFailure, readDraft, clearDraft, uploadKey, writeDraft, type UploadInProgress } from "@/lib/drafts";
import { calendarDayWords, dayWords, shortDayWords } from "@/lib/notifications-copy";
import { OfflineNote } from "@/components/ui/connection";
import { createDocument, finalizeDocumentVersion, fulfilDocumentRequest, retireEmptyDocument } from "@/lib/actions/portal";
import { isLowData } from "@/lib/low-data";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import type { DocumentRequestRow, DocumentRow, DocumentSignatureRow, DocumentVersionRow } from "@/lib/db/types";
import { sha256Hex } from "@/lib/checksum";
import { SignDialog } from "@/components/portal/sign-dialog";

export type DocumentWithVersion = DocumentRow & { version: DocumentVersionRow | null; version_count: number };

const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * The client's sentence for an upload the network cut short. drafts.ts's UPLOAD_STOPPED says the
 * same with a dash, and the console keeps that one. Only a client uploads from this list.
 */
const STOPPED = "The upload stopped because the connection dropped. Choose the same file again to finish it, or remove it from the list.";

/** The client's words for the categories Docket itself writes. A firm's own category is shown as it typed it. */
const CATEGORY_WORDS: Record<string, string> = {
  client_upload: "Sent by a client",
  firm_upload: "Shared by your firm",
  generated: "Prepared by your firm",
};

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

// A file input dressed as a button. The input itself is the control a keyboard reaches, and it is
// visually hidden, so the ring is drawn on the label with focus-within (DESIGN.md: every control
// shows focus).
const filePicker = "cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink-strong";

/** A status line beside a document: the word and its mark together, never the colour alone (DESIGN.md). */
function StateLine({ tone, icon, children, className }: { tone: "settled" | "waiting"; icon: "check" | "clock"; children: ReactNode; className?: string }) {
  return (
    <p className={cn("mt-1 flex items-start gap-1.5 text-13", tone === "settled" ? "text-settled-ink" : "text-waiting-ink", className)}>
      <Icon name={icon} size={14} strokeWidth={2.2} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function DocumentsTab({
  firmId, matterId, appointmentId, documents, timezone, canUpload = true, requests = [], userId = null, signatures = [], profileName = null, audience = "client", mainAction = true,
}: { firmId: string; matterId: string | null; appointmentId: string | null; documents: DocumentWithVersion[]; timezone: string; canUpload?: boolean; requests?: DocumentRequestRow[]; userId?: string | null;
  /**
   * Whether this list may draw the screen's one filled button (docs/VOICE.md, rule 15). A screen
   * whose own main action is elsewhere, such as a consultation waiting on payment, passes false,
   * and every button here is then a ghost. The console's "Read and sign" is not affected.
   */
  mainAction?: boolean;
  /**
   * Who is reading. The console reuses this list on a consultation, and the wording here is
   * written to the client — "wait for your lawyer to share", "Not yet seen by your firm" — which
   * read as nonsense, or worse as a mistake, when the firm itself is the one looking.
   */
  audience?: "client" | "staff";
  /** Signatures on these documents, and the viewer's name as their profile has it (migration 40). */
  signatures?: DocumentSignatureRow[]; profileName?: string | null }) {
  const router = useRouter();
  const staff = audience === "staff";
  // A document the firm asked this person to sign, and which they have not signed on its current version.
  const [signing, setSigning] = useState<DocumentWithVersion | null>(null);
  // A matter can have more than one client, and request_signature() asks them all. The first to
  // sign locks the document — on that version — and the database still admits the others on the
  // same version. So the gate is "this version is not superseded", not "nothing is locked":
  // testing the lock alone hid the button from everyone else the firm had just asked.
  // An instrument executed on paper is not also signed here: record_signature() refuses a version
  // whose kind is 'executed_paper', and record_paper_execution() now withdraws the request when it
  // locks the document. The kind is tested here too, so a document executed before that migration
  // stops asking for a signature the database will never take.
  // The client's matter page makes the same test to choose its main action; keep the two alike.
  const toSign = (d: DocumentWithVersion) => Boolean(
    d.signature_requested_at && d.version && userId
    && d.version.kind !== "executed_paper"
    && (!d.locked_version_id || d.locked_version_id === d.version.id)
    && !signatures.some((sg) => sg.version_id === d.version?.id && sg.signer_id === userId),
  );
  const signaturesOf = (d: DocumentWithVersion) => signatures.filter((sg) => sg.document_id === d.id);
  // Which request the picker was opened for, if any. Set by "Upload this", cleared once used.
  //
  // "Upload this" has a file input of its own. It used to click the one inside the "Upload a
  // document" label, and that click bubbled to the label's own onClick, which cleared this in
  // the same batch: the file arrived, and the request it was chosen for stayed open. The two
  // inputs now say which upload they are, so nothing has to be cleared to tell them apart.
  const [forRequest, setForRequest] = useState<string | null>(null);
  const requestInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lowData, setLowData] = useState(false);
  const [preview, setPreview] = useState<{ doc: DocumentWithVersion; url: string | null; loading: boolean } | null>(null);
  const [versions, setVersions] = useState<Record<string, DocumentVersionRow[]>>({});

  useEffect(() => setLowData(isLowData()), []);

  const upload = useCallback(async (e: ChangeEvent<HTMLInputElement>, requestId: string | null) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    // An upload that answers no request clears one left over from a picker that was cancelled,
    // so its "Upload this" does not show this file's progress.
    if (!file || !requestId) setForRequest(null);
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) { setError("That file is larger than 25 MB, so it was not uploaded. Choose a smaller file."); return; }
    const supabase = supabaseBrowser();
    if (!supabase) { setError("Uploading is not available right now, so nothing was sent. Try again later."); return; }
    setBusy(`Uploading ${file.name}…`);
    // Three steps that are not one transaction: the row, the bytes, the version. An upload that
    // stops between them is finished, not restarted: the ids minted for this file are kept on
    // the device, the same file chosen again reuses them, bytes already in the store count as
    // uploaded, and a version already recorded counts as done.
    const key = uploadKey(userId, matterId ?? appointmentId ?? "");
    const prior = readDraft<UploadInProgress>(key);
    try {
      let created: UploadInProgress;
      if (prior && prior.name === file.name && prior.size === file.size) {
        created = prior;
      } else {
        const made = await createDocument({ firmId, matterId, appointmentId, name: file.name, mime: file.type || "application/octet-stream", sizeBytes: file.size });
        if (!made.ok) { setError(made.error); return; }
        created = { name: file.name, size: file.size, documentId: made.documentId, versionId: made.versionId, storagePath: made.storagePath };
        writeDraft(key, created);
      }
      const { error: upErr } = await supabase.storage.from("documents").upload(created.storagePath, file, { contentType: file.type || undefined, upsert: false });
      // A resume onto a row that has since been retired is refused by the storage policy, and
      // keeping the record would make every later attempt with this file fail identically —
      // with no row left on screen to remove. Forget it, and send the file as a new document.
      if (upErr && !isAlreadyStored(upErr.message)) {
        if (created === prior) { clearDraft(key); setError("That upload could not be finished, because the document it belonged to has been removed. Choose the file again to send it as a new one."); }
        else setError(userErrorMessage(upErr, "The upload"));
        return;
      }
      const fin = await finalizeDocumentVersion({ documentId: created.documentId, versionId: created.versionId, storagePath: created.storagePath, mime: file.type || "application/octet-stream", sizeBytes: file.size, checksum: await sha256Hex(file) });
      if (fin?.error && !/duplicate key|already exists/i.test(fin.error)) { setError(fin.error); return; }
      clearDraft(key);
      // An upload made for a request answers it; the database refuses a second answer or a
      // document from another matter, and tells whoever asked.
      if (requestId) {
        const answered = await fulfilDocumentRequest(requestId, created.documentId);
        setForRequest(null);
        // The file is safely in; only the link to the request failed. Say both, and who can fix it.
        if (answered?.error) { setError("Your file is uploaded, but it could not be marked as the document your lawyer asked for. Message your lawyer so they know it is there."); router.refresh(); return; }
      }
      router.refresh();
    } catch (e) {
      setError(isNetworkFailure(e) ? STOPPED : userErrorMessage(e, "The upload"));
    } finally {
      setBusy(null);
    }
  }, [appointmentId, firmId, matterId, router, userId]);

  const remove = useCallback(async (doc: DocumentWithVersion) => {
    setError(null);
    setBusy(`Removing ${doc.name}…`);
    try {
      const r = await retireEmptyDocument(doc.id);
      if (r?.error) { setError(r.error); return; }
      const k = uploadKey(userId, matterId ?? appointmentId ?? "");
      if (readDraft<UploadInProgress>(k)?.documentId === doc.id) clearDraft(k);
      router.refresh();
    } catch (e) {
      setError(staff
        ? (isNetworkFailure(e) ? "Not removed — the connection dropped." : (e instanceof Error ? e.message : "Not removed."))
        : (isNetworkFailure(e) ? "The entry was not removed because the connection dropped. Try again." : "The entry was not removed. Try again."));
    } finally {
      setBusy(null);
    }
  }, [appointmentId, matterId, router, staff, userId]);

  /**
   * Finish the upload of a row that has no file — bound to THIS document, so it works on any
   * device and for any stopped upload, not only the most recent one whose ids this browser
   * happens to hold. A version onto an existing row, which is exactly what the row is missing.
   */
  const finishUpload = useCallback(async (doc: DocumentWithVersion, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) { setError("That file is larger than 25 MB, so it was not uploaded. Choose a smaller file."); return; }
    const supabase = supabaseBrowser();
    if (!supabase) { setError("Uploading is not available right now, so nothing was sent. Try again later."); return; }
    const versionId = crypto.randomUUID();
    const path = storagePathFor(doc.firm_id, doc.id, versionId, file.name);
    setBusy(`Finishing ${doc.name}…`);
    try {
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (upErr && !isAlreadyStored(upErr.message)) { setError(userErrorMessage(upErr, "The upload")); return; }
      const fin = await finalizeDocumentVersion({ documentId: doc.id, versionId, storagePath: path, mime: file.type || "application/octet-stream", sizeBytes: file.size, checksum: await sha256Hex(file) });
      if (fin?.error && !/duplicate key|already exists/i.test(fin.error)) { setError(fin.error); return; }
      const k = uploadKey(userId, matterId ?? appointmentId ?? "");
      if (readDraft<UploadInProgress>(k)?.documentId === doc.id) clearDraft(k);
      router.refresh();
    } catch (err) {
      setError(isNetworkFailure(err) ? STOPPED : userErrorMessage(err, "The upload"));
    } finally {
      setBusy(null);
    }
  }, [appointmentId, matterId, router, userId]);

  const openPreview = useCallback(async (doc: DocumentWithVersion, force = false) => {
    if (!doc.version) return;
    if (lowData && !force) { setPreview({ doc, url: null, loading: false }); return; }
    setPreview({ doc, url: null, loading: true });
    const supabase = supabaseBrowser();
    if (!supabase) return;
    // The read is recorded first, and the record is what the storage policy checks (migration
    // 30): without it the signed URL is refused. Not a courtesy log — the door.
    const refused = await recordDocumentOpen(supabase, doc.version.id);
    // The refusal is the database's own words, which the console reads as they are and a client
    // is never shown.
    if (refused) { setError(staff ? refused : "The document did not load. Refresh the page and try again. If it keeps happening, message your lawyer."); setPreview(null); return; }
    const { data, error: sErr } = await supabase.storage.from("documents").createSignedUrl(doc.version.storage_path, 120);
    if (sErr || !data?.signedUrl) {
      setError(staff
        ? (sErr ? "The document could not be opened. Refresh the page and try again." : "Could not open the document.")
        : "The document did not load. Refresh the page and try again.");
      setPreview(null);
      return;
    }
    setPreview({ doc, url: data.signedUrl, loading: false });
  }, [lowData, staff]);

  const loadVersions = useCallback(async (doc: DocumentWithVersion) => {
    if (versions[doc.id]) { setVersions((v) => { const c = { ...v }; delete c[doc.id]; return c; }); return; }
    const supabase = supabaseBrowser();
    if (!supabase) return;
    const { data } = await supabase.from("document_versions").select("id, document_id, storage_path, mime, size_bytes, uploaded_by, created_at").eq("document_id", doc.id).order("created_at", { ascending: false });
    setVersions((v) => ({ ...v, [doc.id]: (data ?? []) as DocumentVersionRow[] }));
  }, [versions]);

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: timezone });
  const isImage = (m?: string | null) => Boolean(m && m.startsWith("image/"));
  const isPdf = (m?: string | null) => m === "application/pdf";

  // What the firm has asked for and not received, the nearest due date first and then the longest
  // waiting: the client's matter page points its main action at the first of these.
  const openRequests = requests
    .filter((r) => !r.fulfilled_at && !r.cancelled_at)
    .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999") || a.requested_at.localeCompare(b.requested_at));
  // ONE FILLED BUTTON, for a client: the first request, else the first document to sign, else
  // "Upload a document". Everything else is a ghost (docs/VOICE.md, rule 15), and with
  // mainAction={false} everything is. The console's look is unchanged: it has no uploads or
  // requests here, and its "Read and sign" stays filled.
  const firstToSign = documents.find(toSign)?.id ?? null;
  const lead: "request" | "sign" | "upload" | null = !mainAction ? null : canUpload && openRequests.length > 0 ? "request" : firstToSign ? "sign" : "upload";
  const category = (d: DocumentWithVersion) => {
    if (!d.category) return "";
    if (staff) return d.category.replace(/_/g, " ");
    if (d.category === "client_upload" && userId && d.uploaded_by === userId) return "Sent by you";
    return CATEGORY_WORDS[d.category] ?? d.category.replace(/_/g, " ");
  };

  return (
    <div>
      {error && <div className="px-5 pt-4"><Alert kind="error">{error}</Alert></div>}
      {canUpload && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
          <p className="text-13 text-ink-muted">PDF, Word or photos, up to 25 MB. Your firm sees what you upload here.</p>
          <label className={cn(buttonClasses(lead === "upload" ? "primary" : "ghost", "md"), filePicker, busy && "cursor-default opacity-50")}>
            {busy ?? "Upload a document"}
            <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => upload(e, null)} disabled={Boolean(busy)} />
          </label>
          <div className="basis-full"><OfflineNote /></div>
        </div>
      )}
      {/* What the firm has asked for and has not received. An upload made from here answers it.
          The id is where the matter page's "Upload the document" lands. */}
      {openRequests.length > 0 && (
        <section id="requests" className="scroll-mt-20 border-b border-waiting-line bg-waiting-bg px-5 py-4">
          {/* Opened only by "Upload this", so it is out of the tab order: those buttons are the controls. */}
          {canUpload && <input ref={requestInput} type="file" accept={ACCEPT} hidden tabIndex={-1} onChange={(e) => upload(e, forRequest)} />}
          <h3 className="flex items-center gap-2 text-15 font-semibold text-waiting-ink">
            <Icon name="alert" size={17} className="shrink-0" />
            Documents your lawyer has asked for
          </h3>
          <ul className="mt-2 space-y-3">
            {openRequests.map((r, i) => {
              const due = calendarDayWords(r.due_on);
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-15 font-medium text-ink">{r.title}</p>
                    {r.why && <p className="text-13 text-ink">{r.why}</p>}
                    {due && <StateLine tone="waiting" icon="clock" className="mt-0.5">Needed by {due}</StateLine>}
                  </div>
                  {canUpload && (
                    <Button size="sm" variant={lead === "request" && i === 0 ? "primary" : "ghost"} disabled={Boolean(busy)} onClick={() => { setForRequest(r.id); requestInput.current?.click(); }}>
                      {forRequest === r.id && busy ? busy : "Upload this"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {requests.some((r) => r.fulfilled_at) && (
        <p className="border-b border-hairline px-5 py-2 text-13 text-ink-muted">
          Already sent: {requests.filter((r) => r.fulfilled_at).map((r) => r.title).join(", ")}.
        </p>
      )}
      {documents.length === 0 ? (
        staff
          ? <EmptyState title="Nothing has been sent in on this consultation yet." />
          : <EmptyState title="No documents yet" hint="Documents you upload, and the ones your lawyer shares with you, show here." />
      ) : (
        <ul className="divide-y divide-hairline">
          {documents.map((d) => {
            const signThis = toSign(d);
            const cat = category(d);
            return (
              <li key={d.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-15 font-medium text-ink">{d.name}</p>
                    <p className="text-13 text-ink-muted">
                      {/* Small print, so the short date (docs/VOICE.md, rule 11). The console keeps its own. */}
                      {staff ? fmt.format(new Date(d.created_at)) : shortDayWords(d.created_at, timezone)}{d.version?.size_bytes ? ` · ${fmtSize(d.version.size_bytes)}` : ""}{cat ? ` · ${cat}` : ""}
                    </p>
                    {d.version_count > 1 && (
                      // A full target, not an underlined word in the small print: a thumb has to find it.
                      <button type="button" className="-ml-1 inline-flex min-h-11 items-center rounded-control px-1 text-13 text-ink underline underline-offset-2 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-strong" aria-expanded={Boolean(versions[d.id])} onClick={() => loadVersions(d)}>
                        {staff ? `${d.version_count} versions` : versions[d.id] ? "Hide earlier versions" : `See all ${d.version_count} versions`}
                      </button>
                    )}
                    {/* Only for what the client sent: the firm marks an upload as looked at, and until
                        now that mark reached a staff counter and never the person waiting on it. */}
                    {d.category === "client_upload" && (
                      d.reviewed_at
                        ? <StateLine tone="settled" icon="check">{staff ? `Marked as looked at ${fmt.format(new Date(d.reviewed_at))}` : `Seen by your firm on ${dayWords(d.reviewed_at, timezone)}`}</StateLine>
                        : <StateLine tone="waiting" icon="clock">{staff ? "Not yet marked as looked at" : "Not yet seen by your firm"}</StateLine>
                    )}
                    {signThis && <StateLine tone="waiting" icon="clock" className="font-medium">{staff ? "Your firm has asked you to sign this." : "Your lawyer has asked you to sign this."}</StateLine>}
                    {d.locked_version_id && (
                      <StateLine tone="settled" icon="check">
                        {staff
                          ? <>{d.version?.kind === "executed_paper" && d.version.executed_on ? `Executed on paper on ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${d.version.executed_on}T00:00:00Z`))}` : "Signed"} · this version is final</>
                          : <>{d.version?.kind === "executed_paper" && d.version.executed_on ? `Signed on paper on ${calendarDayWords(d.version.executed_on)}.` : "Signed."} This version is final.</>}
                      </StateLine>
                    )}
                    {signaturesOf(d).map((sg) => (
                      <p key={sg.id} className="text-13 text-ink-muted">
                        {staff
                          ? `Signed by ${sg.signer_id === userId ? "you" : sg.signer_name}${sg.signer_role === "staff" ? " for the firm" : ""} · ${fmt.format(new Date(sg.signed_at))}`
                          : `Signed by ${sg.signer_id === userId ? "you" : sg.signer_name}${sg.signer_role === "staff" ? " for the firm" : ""} on ${dayWords(sg.signed_at, timezone)}.`}
                      </p>
                    ))}
                  </div>
                  {d.version ? (
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {signThis && <Button size="sm" variant={staff || (lead === "sign" && d.id === firstToSign) ? "primary" : "ghost"} onClick={() => setSigning(d)}>Read and sign</Button>}
                      <Button size="sm" variant="ghost" onClick={() => openPreview(d)}>
                        {isImage(d.version.mime) || isPdf(d.version.mime) ? "Preview" : "Download"}
                      </Button>
                    </span>
                  ) : (
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      <StateLine tone="waiting" icon="clock" className="mt-0">{staff ? "No file yet — the upload stopped." : "No file yet. The upload stopped."}</StateLine>
                      {canUpload && userId && d.uploaded_by === userId && (
                        <label className={cn(buttonClasses("ghost", "sm"), filePicker)}>
                          Finish upload
                          <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => finishUpload(d, e)} disabled={Boolean(busy)} />
                        </label>
                      )}
                      {/* retire_empty_document() lets the person who started it, or any staff member
                          who may write the row, retire it — so the firm can clear a client's
                          stopped upload off its own consultation rather than looking at it forever. */}
                      {userId && (d.uploaded_by === userId || staff) && <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => remove(d)}>Remove</Button>}
                    </span>
                  )}
                </div>
                {versions[d.id] && (
                  <ul className="mt-2 space-y-1 rounded-card bg-sunken p-3 text-13 text-ink-muted">
                    {versions[d.id].map((v, i) => {
                      const n = versions[d.id].length - i;
                      return (
                        <li key={v.id} className="flex items-center justify-between gap-2">
                          <span>{staff ? `Version ${n} · ${fmt.format(new Date(v.created_at))} · ${fmtSize(v.size_bytes)}` : [`Version ${n}`, shortDayWords(v.created_at, timezone), fmtSize(v.size_bytes)].filter(Boolean).join(", ")}</span>
                          <button type="button" className="inline-flex min-h-11 shrink-0 items-center rounded-control px-2 text-ink underline underline-offset-2 hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-strong" onClick={() => openPreview({ ...d, version: v }, true)}>
                            {staff ? "Open" : `Open version ${n}`}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {signing?.version && (
        <SignDialog open name={signing.name} versionId={signing.version.id} storagePath={signing.version.storage_path} matterId={matterId} profileName={profileName} audience={audience}
          onClose={() => setSigning(null)} onSigned={() => { setSigning(null); router.refresh(); }} />
      )}

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.doc.name ?? "Document"}>
        {preview && (preview.loading ? (
          <p className="text-15 text-ink-muted">{staff ? "Preparing a secure link…" : "Loading the document…"}</p>
        ) : !preview.url ? (
          <div className="space-y-3">
            <p className="text-15 text-ink">Low-data mode is on. Load this {fmtSize(preview.doc.version?.size_bytes) || "file"} preview?</p>
            <Button onClick={() => openPreview(preview.doc, true)}>Load preview</Button>
          </div>
        ) : isImage(preview.doc.version?.mime) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={preview.doc.name} className="max-h-[70vh] w-full rounded-card object-contain" />
        ) : isPdf(preview.doc.version?.mime) ? (
          <div className="space-y-3">
            <iframe src={preview.url} title={preview.doc.name} className="h-[70vh] w-full rounded-card border border-hairline" />
            {/* The document's own link, opened from the preview. tests/integration/journeys.spec.ts
                stays on the matter's default tab and never opens this preview, so its name is free. */}
            <a href={preview.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-15 text-brand underline">Open in a new tab</a>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-15 text-ink">This file type has no in-app preview.</p>
            <a href={preview.url} className={buttonClasses("primary", "md")} download={preview.doc.name}>Download</a>
          </div>
        ))}
        <p className="mt-3 text-13 text-ink-muted">{staff ? "Links expire after two minutes." : "This link stops working after 2 minutes. To get a new one, open the document again from the list."}</p>
      </Modal>
    </div>
  );
}
