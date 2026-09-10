"use client";

// Documents on a matter (or appointment): client uploads to
// documents/{firm}/{document}/{version}.{ext} through the storage policy,
// previews PDFs and images through short signed URLs, lists versions.
// Low-data mode defers every preview until tapped.

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { createDocument, finalizeDocumentVersion } from "@/lib/actions/portal";
import { isLowData } from "@/lib/low-data";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import type { DocumentRow, DocumentVersionRow } from "@/lib/db/types";

export type DocumentWithVersion = DocumentRow & { version: DocumentVersionRow | null; version_count: number };

const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 25 * 1024 * 1024;

function fmtSize(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsTab({
  firmId, matterId, appointmentId, documents, timezone, canUpload = true,
}: { firmId: string; matterId: string | null; appointmentId: string | null; documents: DocumentWithVersion[]; timezone: string; canUpload?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lowData, setLowData] = useState(false);
  const [preview, setPreview] = useState<{ doc: DocumentWithVersion; url: string | null; loading: boolean } | null>(null);
  const [versions, setVersions] = useState<Record<string, DocumentVersionRow[]>>({});

  useEffect(() => setLowData(isLowData()), []);

  const upload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) { setError("Files must be 25 MB or smaller."); return; }
    const supabase = supabaseBrowser();
    if (!supabase) { setError("Not configured."); return; }
    setBusy(`Uploading ${file.name}…`);
    const created = await createDocument({ firmId, matterId, appointmentId, name: file.name, mime: file.type || "application/octet-stream", sizeBytes: file.size });
    if (!created.ok) { setBusy(null); setError(created.error); return; }
    const { error: upErr } = await supabase.storage.from("documents").upload(created.storagePath, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) { setBusy(null); setError(`Upload failed: ${upErr.message}`); return; }
    const fin = await finalizeDocumentVersion({ documentId: created.documentId, versionId: created.versionId, storagePath: created.storagePath, mime: file.type || "application/octet-stream", sizeBytes: file.size });
    setBusy(null);
    if (fin?.error) { setError(fin.error); return; }
    router.refresh();
  }, [appointmentId, firmId, matterId, router]);

  const openPreview = useCallback(async (doc: DocumentWithVersion, force = false) => {
    if (!doc.version) return;
    if (lowData && !force) { setPreview({ doc, url: null, loading: false }); return; }
    setPreview({ doc, url: null, loading: true });
    const supabase = supabaseBrowser();
    if (!supabase) return;
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
          <label className="inline-flex cursor-pointer items-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">
            {busy ?? "Upload a document"}
            <input type="file" accept={ACCEPT} className="sr-only" onChange={upload} disabled={Boolean(busy)} />
          </label>
        </div>
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
                </div>
                <Button size="sm" variant="ghost" onClick={() => openPreview(d)} disabled={!d.version}>
                  {isImage(d.version?.mime) || isPdf(d.version?.mime) ? "Preview" : "Download"}
                </Button>
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
            <a href={preview.url} className="inline-flex rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white" download={preview.doc.name}>Download</a>
          </div>
        ))}
        <p className="mt-3 text-xs text-gray-500">Links expire after two minutes.</p>
      </Modal>
    </div>
  );
}
