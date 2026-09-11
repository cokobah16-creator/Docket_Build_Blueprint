"use client";

// Documents on a matter (or appointment): client uploads to
// documents/{firm}/{document}/{version}.{ext} through the storage policy,
// previews PDFs and images through short signed URLs, lists versions.
// Low-data mode defers every preview until tapped.

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { recordDocumentOpen } from "@/lib/document-open";
import { UPLOAD_STOPPED, isAlreadyStored, isNetworkFailure, readDraft, clearDraft, uploadKey, writeDraft, type UploadInProgress } from "@/lib/drafts";
import { OfflineNote } from "@/components/ui/connection";
import { createDocument, finalizeDocumentVersion, fulfilDocumentRequest, retireEmptyDocument } from "@/lib/actions/portal";
import { isLowData } from "@/lib/low-data";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import type { DocumentRequestRow, DocumentRow, DocumentVersionRow } from "@/lib/db/types";
import { sha256Hex } from "@/lib/checksum";

export type DocumentWithVersion = DocumentRow & { version: DocumentVersionRow | null; version_count: number };

const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 25 * 1024 * 1024;

function fmtSize(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsTab({
  firmId, matterId, appointmentId, documents, timezone, canUpload = true, requests = [], userId = null,
}: { firmId: string; matterId: string | null; appointmentId: string | null; documents: DocumentWithVersion[]; timezone: string; canUpload?: boolean; requests?: DocumentRequestRow[]; userId?: string | null }) {
  const router = useRouter();
  // Which request the next upload answers, if any. Set by "Upload this", cleared once used.
  const [forRequest, setForRequest] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lowData, setLowData] = useState(false);
  const [preview, setPreview] = useState<{ doc: DocumentWithVersion; url: string | null; loading: boolean } | null>(null);
  const [versions, setVersions] = useState<Record<string, DocumentVersionRow[]>>({});

  useEffect(() => setLowData(isLowData()), []);

  const upload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    // A cancelled picker leaves no request pending: the next generic upload must not answer it.
    if (!file) { setForRequest(null); return; }
    setError(null);
    if (file.size > MAX_BYTES) { setError("Files must be 25 MB or smaller."); return; }
    const supabase = supabaseBrowser();
    if (!supabase) { setError("Not configured."); return; }
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
      if (upErr && !isAlreadyStored(upErr.message)) { setError(`Upload failed: ${upErr.message}`); return; }
      const fin = await finalizeDocumentVersion({ documentId: created.documentId, versionId: created.versionId, storagePath: created.storagePath, mime: file.type || "application/octet-stream", sizeBytes: file.size, checksum: await sha256Hex(file) });
      if (fin?.error && !/duplicate key|already exists/i.test(fin.error)) { setError(fin.error); return; }
      clearDraft(key);
      // An upload made for a request answers it; the database refuses a second answer or a
      // document from another matter, and tells whoever asked.
      if (forRequest) {
        const answered = await fulfilDocumentRequest(forRequest, created.documentId);
        setForRequest(null);
        if (answered?.error) { setError(`Uploaded, but not linked to the request: ${answered.error}`); router.refresh(); return; }
      }
      router.refresh();
    } catch (e) {
      setError(isNetworkFailure(e) ? UPLOAD_STOPPED : (e instanceof Error ? e.message : UPLOAD_STOPPED));
    } finally {
      setBusy(null);
    }
  }, [appointmentId, firmId, forRequest, matterId, router, userId]);

  const remove = useCallback(async (doc: DocumentWithVersion) => {
    setError(null);
    setBusy(`Removing ${doc.name}…`);
    try {
      const r = await retireEmptyDocument(doc.id);
      if (r?.error) { setError(r.error); return; }
      clearDraft(uploadKey(userId, matterId ?? appointmentId ?? ""));
      router.refresh();
    } catch (e) {
      setError(isNetworkFailure(e) ? "Not removed — the connection dropped." : (e instanceof Error ? e.message : "Not removed."));
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
    if (refused) { setError(refused); setPreview(null); return; }
    const { data, error: sErr } = await supabase.storage.from("documents").createSignedUrl(doc.version.storage_path, 120);
    if (sErr || !data?.signedUrl) { setError(sErr?.message ?? "Could not open the document."); setPreview(null); return; }
    setPreview({ doc, url: data.signedUrl, loading: false });
  }, [lowData]);

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

  return (
    <div>
      {error && <div className="px-5 pt-4"><Alert kind="error">{error}</Alert></div>}
      {canUpload && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <p className="text-xs text-gray-500">PDF, Word, JPEG, PNG or HEIC · up to 25 MB · shared with your firm</p>
          <label
            onClick={() => setForRequest(null)}
            className="inline-flex cursor-pointer items-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on hover:opacity-90"
          >
            {busy ?? "Upload a document"}
            <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" onChange={upload} disabled={Boolean(busy)} />
          </label>
          <div className="basis-full"><OfflineNote /></div>
        </div>
      )}
      {/* What the firm has asked for and has not received. An upload made from here answers it. */}
      {requests.filter((r) => !r.fulfilled_at && !r.cancelled_at).length > 0 && (
        <section className="border-b border-gray-100 bg-[#FFFAEB] px-5 py-4">
          <h3 className="text-sm font-semibold text-[#92400E]">Your firm has asked you for</h3>
          <ul className="mt-2 space-y-2">
            {requests.filter((r) => !r.fulfilled_at && !r.cancelled_at).map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{r.title}</p>
                  {r.why && <p className="text-xs text-gray-700">{r.why}</p>}
                  {r.due_on && <p className="text-xs text-[#92400E]">By {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${r.due_on}T00:00:00Z`))}</p>}
                </div>
                {canUpload && (
                  <Button size="sm" disabled={Boolean(busy)} onClick={() => { setForRequest(r.id); fileInput.current?.click(); }}>
                    {forRequest === r.id && busy ? busy : "Upload this"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {requests.some((r) => r.fulfilled_at) && (
        <p className="border-b border-gray-100 px-5 py-2 text-xs text-gray-500">
          Answered: {requests.filter((r) => r.fulfilled_at).map((r) => r.title).join(", ")}.
        </p>
      )}
      {documents.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-gray-500">No documents yet. Upload one, or wait for your lawyer to share.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {documents.map((d) => (
            <li key={d.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{d.name}</p>
                  <p className="text-xs text-gray-500">
                    {fmt.format(new Date(d.created_at))}{d.version?.size_bytes ? ` · ${fmtSize(d.version.size_bytes)}` : ""}{d.category ? ` · ${d.category.replace(/_/g, " ")}` : ""}
                    {d.version_count > 1 && (
                      <> · <button type="button" className="underline" onClick={() => loadVersions(d)}>{d.version_count} versions</button></>
                    )}
                  </p>
                  {/* Only for what the client sent: the firm marks an upload as looked at, and until
                      now that mark reached a staff counter and never the person waiting on it. */}
                  {d.category === "client_upload" && (
                    <p className={d.reviewed_at ? "mt-1 text-xs text-[#15803D]" : "mt-1 text-xs text-[#92400E]"}>
                      {d.reviewed_at ? `Seen by your firm ${fmt.format(new Date(d.reviewed_at))}` : "Not yet seen by your firm"}
                    </p>
                  )}
                </div>
                {d.version ? (
                  <Button size="sm" variant="ghost" onClick={() => openPreview(d)}>
                    {isImage(d.version.mime) || isPdf(d.version.mime) ? "Preview" : "Download"}
                  </Button>
                ) : (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[#92400E]">No file yet — the upload stopped. Choose the same file again to finish it.</span>
                    {userId && d.uploaded_by === userId && <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => remove(d)}>Remove</Button>}
                  </span>
                )}
              </div>
              {versions[d.id] && (
                <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                  {versions[d.id].map((v, i) => (
                    <li key={v.id} className="flex justify-between gap-2">
                      <span>Version {versions[d.id].length - i} · {fmt.format(new Date(v.created_at))} · {fmtSize(v.size_bytes)}</span>
                      <button type="button" className="underline" onClick={() => openPreview({ ...d, version: v }, true)}>Open</button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.doc.name ?? "Document"}>
        {preview && (preview.loading ? (
          <p className="text-sm text-gray-600">Preparing a secure link…</p>
        ) : !preview.url ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">Low-data mode is on. Load this {fmtSize(preview.doc.version?.size_bytes) || "file"} preview?</p>
            <Button onClick={() => openPreview(preview.doc, true)}>Load preview</Button>
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
