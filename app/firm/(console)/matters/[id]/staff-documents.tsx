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

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { isLowData } from "@/lib/low-data";
import { Alert } from "@/components/ui/alert";
import { AppButton, appButtonClass } from "@/components/app/button";
import { LockIcon, UploadIcon, UsersIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import type { DocumentRow, DocumentVersionRow } from "@/lib/db/types";
import { sha256Hex } from "@/lib/checksum";

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
  firmId, matterId, userId, documents, timezone, names,
}: {
  firmId: string;
  matterId: string;
  userId: string;
  documents: StaffDocument[];
  timezone: string;
  /** user id → who uploaded it (staff or the client who sent it in). */
  names: Record<string, string>;
}) {
  const router = useRouter();
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

    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const path = storagePathFor(firmId, documentId, versionId, file.name);

    setBusy(`Uploading ${file.name}…`);
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
    if (docError) { setBusy(null); setError(docError.message); return; }

    // Hash before the upload, from the file the person actually chose.
    const checksum = await sha256Hex(file);

    const { error: upError } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upError) { setBusy(null); setError(`Upload failed: ${upError.message}`); return; }

    const { error: versionError } = await supabase.from("document_versions").insert({
      id: versionId,
      document_id: documentId,
      storage_path: path,
      mime: file.type || "application/octet-stream",
      size_bytes: file.size,
      checksum,
      uploaded_by: userId,
    });
    setBusy(null);
    if (versionError) { setError(versionError.message); return; }
    router.refresh();
  }, [firmId, matterId, router, userId]);

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

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const isImage = (m?: string | null) => Boolean(m && m.startsWith("image/"));
  const isPdf = (m?: string | null) => m === "application/pdf";

  return (
    <div>
      {error && <div className="px-[15px] pt-[15px]"><Alert kind="error" title="That was refused">{error}</Alert></div>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dk-rule px-[15px] py-3">
        <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-dk-muted">
          PDF, Word, JPEG, PNG or HEIC · up to 25 MB · uploaded here it stays with the firm until you share it.
        </p>
        <label className={cn(appButtonClass("primary-sm"), "cursor-pointer")}>
          <UploadIcon size={15} className="flex-none" />
          {busy?.startsWith("Uploading") ? busy : "Upload a document"}
          <input type="file" accept={ACCEPT} className="sr-only" onChange={upload} disabled={Boolean(busy)} />
        </label>
      </div>

      {documents.length === 0 ? (
        <p className="px-6 py-10 text-center text-[12.5px] leading-relaxed text-dk-muted">
          Nothing filed on this matter yet. Upload the processes, exhibits or correspondence — then share with the client the ones they should have.
        </p>
      ) : (
        <ul className="divide-y divide-dk-rule">
          {documents.map((d) => {
            const uploader = d.uploaded_by ? names[d.uploaded_by] ?? null : null;
            const rows = versions[d.id];
            return (
              <li key={d.id} className="px-[15px] py-[13px]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-dk-strong">{d.name}</p>
                    <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-muted">
                      {fmt.format(new Date(d.created_at))}
                      {uploader ? ` · ${uploader}` : ""}
                      {d.version?.size_bytes ? ` · ${fmtSize(d.version.size_bytes)}` : ""}
                      {d.category ? ` · ${d.category.replace(/_/g, " ")}` : ""}
                      {d.version_count > 1 && (
                        <>
                          {" · "}
                          {/* A control, not prose: 44px of thumb, pulled back so
                              the metadata line keeps its own height. */}
                          <button
                            type="button"
                            className="-my-[13px] inline-flex min-h-[44px] items-center align-middle font-medium text-dk-pri underline underline-offset-2"
                            onClick={() => loadVersions(d)}
                          >
                            {d.version_count} versions
                          </button>
                        </>
                      )}
                    </p>
                  </div>
                  <AppButton variant="ghost-sm" onClick={() => openPreview(d, null)} disabled={!d.version}>
                    {d.version ? (isImage(d.version.mime) || isPdf(d.version.mime) ? "Preview" : "Download") : "No file yet"}
                  </AppButton>
                </div>

                {/* Shared or staff-only is the distinction that decides what a
                    client ever reads. It is a checkbox, a mark and a sentence —
                    never one of the three on its own. */}
                <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-2">
                  <label
                    className={cn(
                      "inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[9px] border px-3 text-[12.5px] font-medium",
                      isShared(d) ? "border-dk-pri bg-dk-tint text-dk-strong" : "border-dk-field bg-white text-dk-soft",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5 flex-none"
                      checked={isShared(d)}
                      disabled={Boolean(busy)}
                      onChange={() => toggleShared(d)}
                    />
                    {isShared(d) ? (
                      <UsersIcon size={15} className="flex-none" />
                    ) : (
                      <LockIcon size={15} className="flex-none" />
                    )}
                    {isShared(d) ? "Your client can see this" : "Staff only — your client cannot see this"}
                  </label>
                  <label className="inline-flex min-h-[44px] cursor-pointer items-center text-[12.5px] font-medium text-dk-pri underline underline-offset-2">
                    Upload a new version
                    <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => uploadVersion(d, e)} disabled={Boolean(busy)} />
                  </label>
                  {isClientUpload(d) &&
                    (isReviewed(d) ? (
                      <span className="text-[12.5px] text-dk-muted">Reviewed</span>
                    ) : (
                      <AppButton variant="ghost-sm" onClick={() => markReviewed(d)} disabled={Boolean(busy)}>
                        Mark as reviewed
                      </AppButton>
                    ))}
                </div>

                {rows && (
                  <ul className="mt-3 flex flex-col gap-1 rounded-[9px] bg-dk-tint p-3 text-[11.5px] leading-[1.5] text-dk-soft">
                    {rows.length === 0 && <li>No versions recorded — the file was never uploaded.</li>}
                    {rows.map((v, i) => (
                      <li key={v.id} className="flex flex-wrap justify-between gap-2">
                        <span>
                          Version {rows.length - i} · {fmt.format(new Date(v.created_at))}
                          {v.size_bytes ? ` · ${fmtSize(v.size_bytes)}` : ""}
                          {v.uploaded_by && names[v.uploaded_by] ? ` · ${names[v.uploaded_by]}` : ""}
                          {v.id === d.current_version_id ? " · current" : ""}
                        </span>
                        <button
                          type="button"
                          className="min-h-[44px] flex-none px-1 font-medium text-dk-pri underline underline-offset-2"
                          onClick={() => openPreview(d, v, true)}
                        >
                          Open
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.doc.name ?? "Document"}>
        {preview && (preview.loading ? (
          <p className="text-[13px] text-dk-soft">Preparing a secure link…</p>
        ) : !preview.url ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed text-dk-body">
              Low-data mode is on. Load this {fmtSize(preview.doc.version?.size_bytes) || "file"} preview?
            </p>
            <AppButton variant="primary-sm" onClick={() => openPreview(preview.doc, preview.doc.version, true)}>
              Load preview
            </AppButton>
          </div>
        ) : isImage(preview.doc.version?.mime) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={preview.doc.name} className="max-h-[70vh] w-full rounded-[10px] object-contain" />
        ) : isPdf(preview.doc.version?.mime) ? (
          <div className="flex flex-col gap-3">
            <iframe src={preview.url} title={preview.doc.name} className="h-[70vh] w-full rounded-[10px] border border-dk-line" />
            <a
              href={preview.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] w-fit items-center text-[12.5px] font-medium text-dk-pri underline underline-offset-2"
            >
              Open in a new tab
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed text-dk-body">This file type has no in-app preview.</p>
            <a href={preview.url} className={appButtonClass("primary-sm")} download={preview.doc.name}>Download</a>
          </div>
        ))}
        <p className="mt-3 text-[11.5px] leading-snug text-dk-muted">Links expire after two minutes.</p>
      </Modal>
    </div>
  );
}
