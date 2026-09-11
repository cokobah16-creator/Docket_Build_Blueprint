"use client";

// Documents on a matter (or appointment): client uploads to
// documents/{firm}/{document}/{version}.{ext} through the storage policy,
// previews PDFs and images through short signed URLs, lists versions.
// Low-data mode defers every preview until tapped.
//
// It renders in both shells, so every colour below is a dk-* token the shell
// redefines — the firm's brand reaches the client side and nothing reaches the
// console. The three things you tap that used to be underlined words inside a
// line of grey type — the uploader, "{n} versions" and a version's "Open" —
// are real controls now, each at least 44px tall, because a file list is one
// of the few screens a client uses one-handed and in a hurry.

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { createDocument, finalizeDocumentVersion } from "@/lib/actions/portal";
import { isLowData } from "@/lib/low-data";
import { AppButton, appButtonClass } from "@/components/app/button";
import { AppEmpty } from "@/components/app/card";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { ChevronDownIcon, DocumentIcon, UploadIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import type { DocumentRow, DocumentVersionRow } from "@/lib/db/types";
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
    const fin = await finalizeDocumentVersion({ documentId: created.documentId, versionId: created.versionId, storagePath: created.storagePath, mime: file.type || "application/octet-stream", sizeBytes: file.size, checksum: await sha256Hex(file) });
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
      {error && <div className="px-4 pt-3.5"><Alert kind="error">{error}</Alert></div>}
      {canUpload && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dk-rule px-4 py-3">
          <p className="text-[11.5px] leading-snug text-dk-muted">
            PDF, Word, JPEG, PNG or HEIC · up to 25 MB · shared with your firm
          </p>
          {/* The input is the control; the label is its face and its tap
              target, so the focus ring has to come from focus-within. The
              wrapper is here so the button variant's own `self-start` does not
              fight the row's centring when the hint above wraps. */}
          <div className="flex-none">
            <label
              className={appButtonClass(
                "primary-sm",
                "max-w-full cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-dk-pri",
              )}
            >
              <UploadIcon size={15} className="flex-none" />
              <span className="truncate">{busy ?? "Upload a document"}</span>
              <input type="file" accept={ACCEPT} className="sr-only" onChange={upload} disabled={Boolean(busy)} />
            </label>
          </div>
        </div>
      )}
      {documents.length === 0 ? (
        <AppEmpty
          title="No documents yet"
          hint={canUpload
            ? "Upload one above, or wait for your lawyer to share."
            : "Documents your lawyer shares on this matter appear here."}
        />
      ) : (
        <ul className="divide-y divide-dk-rule">
          {documents.map((d) => {
            const open = Boolean(versions[d.id]);
            return (
              <li key={d.id} className="px-4 py-[13px]">
                <div className="flex items-start gap-[11px]">
                  <span
                    aria-hidden="true"
                    className="mt-[1px] grid h-7 w-7 flex-none place-items-center rounded-full bg-dk-rule text-dk-soft"
                  >
                    <DocumentIcon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold leading-[1.35] text-dk-strong">{d.name}</p>
                    <p className="mt-[3px] text-[11.5px] leading-snug text-dk-muted">
                      {fmt.format(new Date(d.created_at))}
                      {d.version?.size_bytes ? ` · ${fmtSize(d.version.size_bytes)}` : ""}
                      {d.category ? ` · ${d.category.replace(/_/g, " ")}` : ""}
                    </p>
                  </div>
                  <AppButton
                    variant="ghost-sm"
                    className="h-11"
                    onClick={() => openPreview(d)}
                    disabled={!d.version}
                  >
                    {isImage(d.version?.mime) || isPdf(d.version?.mime) ? "Preview" : "Download"}
                  </AppButton>
                </div>

                {d.version_count > 1 && (
                  <div className="mt-1.5 pl-[39px]">
                    <AppButton
                      variant="ghost-sm"
                      className="h-11"
                      aria-expanded={open}
                      aria-controls={`versions-${d.id}`}
                      onClick={() => loadVersions(d)}
                    >
                      {d.version_count} versions
                      <ChevronDownIcon
                        size={14}
                        className={cn("flex-none transition-transform", open && "rotate-180")}
                      />
                    </AppButton>
                  </div>
                )}

                {versions[d.id] && (
                  <ul id={`versions-${d.id}`} className="mt-2 divide-y divide-dk-line rounded-[10px] border border-dk-line bg-dk-tint px-3">
                    {versions[d.id].map((v, i) => (
                      <li key={v.id} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="min-w-0 text-[12px] leading-snug text-dk-soft">
                          Version {versions[d.id].length - i} · {fmt.format(new Date(v.created_at))} · {fmtSize(v.size_bytes)}
                        </span>
                        <AppButton
                          variant="ghost-sm"
                          className="h-11"
                          aria-label={`Open version ${versions[d.id].length - i} of ${d.name}`}
                          onClick={() => openPreview({ ...d, version: v }, true)}
                        >
                          Open
                        </AppButton>
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
          <p className="text-[13.5px] leading-relaxed text-dk-body">Preparing a secure link…</p>
        ) : !preview.url ? (
          <div className="space-y-3">
            <p className="text-[13.5px] leading-relaxed text-dk-body">
              Low-data mode is on. Load this {fmtSize(preview.doc.version?.size_bytes) || "file"} preview?
            </p>
            <AppButton variant="primary-sm" onClick={() => openPreview(preview.doc, true)}>
              Load preview
            </AppButton>
          </div>
        ) : isImage(preview.doc.version?.mime) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={preview.doc.name} className="max-h-[70vh] w-full rounded-[10px] object-contain" />
        ) : isPdf(preview.doc.version?.mime) ? (
          <div className="space-y-3">
            <iframe src={preview.url} title={preview.doc.name} className="h-[70vh] w-full rounded-[10px] border border-dk-line" />
            <a
              href={preview.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[44px] items-center text-[12.5px] font-medium text-dk-pri underline underline-offset-2"
            >
              Open in a new tab
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13.5px] leading-relaxed text-dk-body">This file type has no in-app preview.</p>
            <a href={preview.url} className={appButtonClass("primary-sm")} download={preview.doc.name}>
              Download
            </a>
          </div>
        ))}
        <p className="mt-3 text-[11.5px] leading-relaxed text-dk-muted">Links expire after two minutes.</p>
      </Modal>
    </div>
  );
}
