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
import { useRouter } from "next/navigation";
import { linkServiceToMatter, revokeService } from "@/lib/actions/service";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Alert } from "@/components/ui/alert";
import { AppButton, AppButtonLink, Footnote } from "@/components/app";
import { DocumentIcon } from "@/components/ui/icons";

// The console's own field: neutral edge, 44px of thumb, and a focus ring in the
// shell's ink rather than any firm's colour.
const field =
  "mt-1.5 min-h-[44px] w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong placeholder:text-dk-muted focus:border-dk-pri focus:outline-none";
const labelClass = "text-[13px] font-semibold text-dk-strong";
const hintClass = "mt-1 text-[11.5px] leading-snug text-dk-muted";
/** Required is said in words, never in a colour: colour here means late or unpaid. */
const requiredMark = <span className="font-normal text-dk-muted">(required)</span>;

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
      <div className="flex flex-col gap-1.5">
        <AppButton
          variant={filedMatterId ? "ghost-sm" : "primary-sm"}
          onClick={() => { setOpen(true); setError(null); }}
        >
          {filedMatterId ? "Change the filing or the response date" : "File it into a matter"}
        </AppButton>
        {!filedMatterId && (
          <Footnote>Filing puts it on your own matter&apos;s timeline, for your firm only.</Footnote>
        )}
      </div>
    );
  }

  if (matters.length === 0) {
    return (
      <div className="flex flex-col gap-2.5">
        <Alert kind="info" title="No matter to file it into yet">
          Open the matter this process belongs to, then come back and file it with the date your response falls due.
        </Alert>
        <div className="flex flex-wrap gap-2">
          <AppButtonLink href="/firm/matters/new" variant="primary-sm">
            Open a matter
          </AppButtonLink>
          <AppButton variant="ghost-sm" onClick={() => setOpen(false)}>Not now</AppButton>
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
    <div className="flex flex-col gap-3 rounded-[10px] border border-dk-line bg-dk-tint p-3">
      {error && <Alert kind="error" title="The database refused this">{error}</Alert>}
      <div>
        <label htmlFor={`file_matter_${serviceId}`} className={labelClass}>
          Our matter {requiredMark}
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
        <label htmlFor={`file_due_${serviceId}`} className={labelClass}>Response falls due</label>
        <input
          id={`file_due_${serviceId}`} type="date" value={dueOn}
          onChange={(e) => setDueOn(e.target.value)} className={field}
        />
        <p className={hintClass}>
          The day your reply, counter-affidavit or defence is due. It goes into the response diary at the top of this
          screen, and is marked overdue once the day has passed.
        </p>
      </div>
      <div>
        <label htmlFor={`file_note_${serviceId}`} className={labelClass}>Note for the file</label>
        <textarea
          id={`file_note_${serviceId}`} rows={2} maxLength={2000} value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Counter-affidavit and written address to be settled by the SAN." className={field}
        />
        <p className={hintClass}>Filed as an internal entry on your matter. The firm that served it never sees this.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <AppButton variant="primary-sm" disabled={pending} onClick={submit}>{pending ? "Filing…" : "File it"}</AppButton>
        <AppButton variant="ghost-sm" onClick={() => { setOpen(false); setError(null); }}>Cancel</AppButton>
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
    return <Footnote>No file was attached to this service record.</Footnote>;
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
    <div className="flex flex-col gap-1.5">
      <AppButton variant="ghost-sm" disabled={busy} onClick={open}>
        <DocumentIcon size={15} />
        {busy ? "Opening…" : "Open the process"}
      </AppButton>
      {url && (
        <p className="text-[12.5px] leading-[1.45]">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-medium text-dk-pri underline underline-offset-2"
          >
            Open {documentName}
          </a>{" "}
          <span className="text-[11.5px] text-dk-muted">&mdash; the link lasts two minutes.</span>
        </p>
      )}
      {/* The document not opening is the one thing on this screen that stops an
          affidavit of service being sworn, so it keeps its ink and its words. */}
      {error && (
        <p role="alert" className="text-[12px] font-semibold leading-snug text-[#B42318]">
          Not opened: {error}
        </p>
      )}
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
      <AppButton variant="ghost-sm" onClick={() => { setOpen(true); setError(null); }}>
        Withdraw this service
      </AppButton>
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
    // Neutral, not red: in this console red says something is late or unpaid.
    // What makes this act grave is stated in the sentence below the field.
    <div className="flex flex-col gap-2 rounded-[10px] border border-dk-line bg-dk-tint p-3">
      {error && <Alert kind="error" title="The database refused this">{error}</Alert>}
      <label htmlFor={`revoke_${serviceId}`} className={labelClass}>
        Why is it being withdrawn? {requiredMark}
      </label>
      <textarea
        id={`revoke_${serviceId}`} rows={2} maxLength={500} value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Served on the wrong counsel — the correct process follows." className={field}
      />
      <p className="text-[11.5px] leading-snug text-dk-soft">
        The other firm loses sight of the process at once and it leaves its inbox. The withdrawal is recorded on your
        matter as an internal entry, with your reason.
      </p>
      <div className="flex flex-wrap gap-2">
        <AppButton variant="primary-sm" disabled={pending || reason.trim().length < 3} onClick={submit}>
          {pending ? "Withdrawing…" : "Withdraw service"}
        </AppButton>
        <AppButton variant="ghost-sm" onClick={() => { setOpen(false); setError(null); }}>Keep it</AppButton>
      </div>
    </div>
  );
}
