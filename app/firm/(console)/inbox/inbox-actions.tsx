"use client";

// The interactive parts of the service inbox: filing a process served on us
// against one of our own matters with the date the response falls due, opening
// the served document, and withdrawing a process we served in error.
//
// Rules enforced here:
//  · The database decides. link_service_to_matter() refuses a matter that is not
//    ours; revoke_service() refuses anyone but an owner or admin of the serving
//    firm. Both refusals are shown exactly as they are worded.
//  · Filing writes an INTERNAL timeline entry on our matter — the firm that
//    served the process never sees where we filed it, or what we noted.
//  · The served document is read through a short-lived signed URL; the storage
//    policy, not this file, decides whether it opens at all.
//  · Dates are the court's own calendar days; the diary is rendered in the
//    viewer's zone by the page.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { linkServiceToMatter, revokeService } from "@/lib/actions/service";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

export interface FileableMatter {
  id: string;
  reference: string;
  title: string;
  closed: boolean;
}

/** File a process served on us against one of our matters, and diarise the response. */
export function FileServiceForm({
  serviceId, matters, filedMatterId, responseDueOn, note,
}: {
  serviceId: string;
  matters: FileableMatter[];
  filedMatterId: string | null;
  responseDueOn: string | null;
  note?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [matterId, setMatterId] = useState(filedMatterId ?? "");
  const [dueOn, setDueOn] = useState(responseDueOn ?? "");
  const [text, setText] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="space-y-1">
        <Button size="sm" variant={filedMatterId ? "ghost" : "primary"} onClick={() => { setOpen(true); setError(null); }}>
          {filedMatterId ? "Change the filing or the response date" : "File it into a matter"}
        </Button>
        {!filedMatterId && (
          <p className="text-xs text-gray-500">Filing puts it on your own matter&apos;s timeline, for your firm only.</p>
        )}
      </div>
    );
  }

  if (matters.length === 0) {
    return (
      <div className="space-y-2">
        <Alert kind="info" title="No matter to file it into yet">
          Open the matter this process belongs to, then come back and file it with the date your response falls due.
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/firm/matters/new"
            className="inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90"
          >
            Open a matter
          </Link>
          <Button size="md" variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
        </div>
      </div>
    );
  }

  function submit() {
    if (!matterId) { setError("Choose the matter this process belongs to."); return; }
    setError(null);
    startTransition(async () => {
      const result = await linkServiceToMatter(serviceId, matterId, dueOn || null, text.trim() || null);
      if (result?.error) { setError(result.error); return; }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
      {error && <Alert kind="error" title="The database refused this">{error}</Alert>}
      <div>
        <label htmlFor={`file_matter_${serviceId}`} className="text-sm font-medium text-gray-900">
          Our matter <span className="text-red-700">*</span>
        </label>
        <select
          id={`file_matter_${serviceId}`} value={matterId}
          onChange={(e) => setMatterId(e.target.value)} className={field}
        >
          <option value="">Choose a matter…</option>
          {matters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.reference} · {m.title}{m.closed ? " (closed)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`file_due_${serviceId}`} className="text-sm font-medium text-gray-900">Response falls due</label>
        <input
          id={`file_due_${serviceId}`} type="date" value={dueOn}
          onChange={(e) => setDueOn(e.target.value)} className={field}
        />
        <p className="mt-1 text-xs text-gray-500">
          The day your reply, counter-affidavit or defence is due. It goes into the diary below, and turns red when it passes.
        </p>
      </div>
      <div>
        <label htmlFor={`file_note_${serviceId}`} className="text-sm font-medium text-gray-900">Note for the file</label>
        <textarea
          id={`file_note_${serviceId}`} rows={2} maxLength={2000} value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Counter-affidavit and written address to be settled by the SAN." className={field}
        />
        <p className="mt-1 text-xs text-gray-500">Filed as an internal entry on your matter. The firm that served it never sees this.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="md" disabled={pending} onClick={submit}>{pending ? "Filing…" : "File it"}</Button>
        <Button size="md" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
      </div>
    </div>
  );
}

/** Open the served document through a short-lived signed URL. */
export function OpenProcessButton({
  versionId, documentName,
}: {
  versionId: string | null;
  documentName: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!versionId) {
    return <p className="text-xs text-gray-500">No file was attached to this service record.</p>;
  }

  async function open() {
    if (!versionId) return;
    setBusy(true);
    setError(null);
    setUrl(null);
    const supabase = supabaseBrowser();
    if (!supabase) { setBusy(false); setError("Not configured."); return; }
    const { data, error: versionError } = await supabase
      .from("document_versions")
      .select("id, storage_path")
      .eq("id", versionId)
      .maybeSingle();
    const version = (data ?? null) as { id: string; storage_path: string } | null;
    if (versionError || !version) {
      setBusy(false);
      setError(versionError?.message ?? "That document is no longer available to you.");
      return;
    }
    const { data: signed, error: signError } = await supabase.storage.from("documents").createSignedUrl(version.storage_path, 120);
    setBusy(false);
    if (signError || !signed?.signedUrl) { setError(signError?.message ?? "The document could not be opened."); return; }
    const opened = window.open(signed.signedUrl, "_blank", "noopener,noreferrer");
    if (!opened) setUrl(signed.signedUrl);
  }

  return (
    <div className="space-y-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={open}>
        {busy ? "Opening…" : "Open the process"}
      </Button>
      {url && (
        <p className="text-sm">
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand underline">
            Open {documentName} ↗
          </a>{" "}
          <span className="text-xs text-gray-500">— the link lasts two minutes.</span>
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** Withdraw a process served in error. Owner or admin of the serving firm only. */
export function RevokeServiceForm({ serviceId }: { serviceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => { setOpen(true); setError(null); }}>
        Withdraw this service
      </Button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await revokeService(serviceId, reason.trim());
      if (result?.error) { setError(result.error); return; }
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
      {error && <Alert kind="error" title="The database refused this">{error}</Alert>}
      <label htmlFor={`revoke_${serviceId}`} className="text-sm font-medium text-red-900">
        Why is it being withdrawn? <span className="text-red-700">*</span>
      </label>
      <textarea
        id={`revoke_${serviceId}`} rows={2} maxLength={500} value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Served on the wrong counsel — the correct process follows." className={field}
      />
      <p className="text-xs text-red-900">
        The other firm loses sight of the process at once and it leaves its inbox. The withdrawal is recorded on your
        matter as an internal entry, with your reason.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="md" variant="danger" disabled={pending || reason.trim().length < 3} onClick={submit}>
          {pending ? "Withdrawing…" : "Withdraw service"}
        </Button>
        <Button size="md" variant="ghost" onClick={() => { setOpen(false); setError(null); }}>Keep it</Button>
      </div>
    </div>
  );
}
