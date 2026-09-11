"use client";

// Message thread on a matter or appointment: Realtime inserts, read receipts,
// document attachments (uploaded through the same documents flow).
//
// The artboard does not draw the thread, so the bubbles are built from the
// client shell's own type and tokens: the person holding the phone speaks in
// the shell's primary, everybody else on the shell's own quiet grey. It
// renders in the console too, where those same tokens are the console's
// neutrals — which is why there is not a fixed colour anywhere below.

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { createDocument, finalizeDocumentVersion, markThreadRead, sendMessage } from "@/lib/actions/portal";
import { AppButton } from "@/components/app/button";
import { Alert } from "@/components/ui/alert";
import { CloseIcon, PaperclipIcon } from "@/components/ui/icons";
import type { MessageAttachment, MessageRow } from "@/lib/db/types";
import { sha256Hex } from "@/lib/checksum";

export function MessagesThread({
  firmId, matterId, appointmentId, userId, initial, timezone, senderNames, firmName,
}: {
  firmId: string; matterId: string | null; appointmentId: string | null; userId: string;
  initial: MessageRow[]; timezone: string; senderNames: Record<string, string>; firmName: string;
}) {
  const [messages, setMessages] = useState<MessageRow[]>(initial);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    markThreadRead({ matterId, appointmentId }).catch(() => undefined);
  }, [matterId, appointmentId]);

  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    const filter = matterId ? `matter_id=eq.${matterId}` : `appointment_id=eq.${appointmentId}`;
    const channel = supabase
      .channel(`messages-${matterId ?? appointmentId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter }, (payload) => {
        const row = payload.new as MessageRow;
        setMessages((cur) => (cur.some((m) => m.id === row.id) ? cur : [...cur, row]));
        if (row.sender_id !== userId) markThreadRead({ matterId, appointmentId }).catch(() => undefined);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter }, (payload) => {
        const row = payload.new as MessageRow;
        setMessages((cur) => cur.map((m) => (m.id === row.id ? { ...m, read_at: row.read_at } : m)));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [appointmentId, matterId, userId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const attach = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { setError("Attachments must be 25 MB or smaller."); return; }
    const supabase = supabaseBrowser();
    if (!supabase) return;
    setError(null);
    setBusy(`Attaching ${file.name}…`);
    const created = await createDocument({ firmId, matterId, appointmentId, name: file.name, mime: file.type || "application/octet-stream", sizeBytes: file.size });
    if (!created.ok) { setBusy(null); setError(created.error); return; }
    const { error: upErr } = await supabase.storage.from("documents").upload(created.storagePath, file, { contentType: file.type || undefined });
    if (upErr) { setBusy(null); setError(`Upload failed: ${upErr.message}`); return; }
    const fin = await finalizeDocumentVersion({ documentId: created.documentId, versionId: created.versionId, storagePath: created.storagePath, mime: file.type || "application/octet-stream", sizeBytes: file.size, checksum: await sha256Hex(file) });
    setBusy(null);
    if (fin?.error) { setError(fin.error); return; }
    setAttachments((a) => [...a, { document_id: created.documentId, name: file.name, mime: file.type || null }]);
  }, [appointmentId, firmId, matterId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("Sending…");
    const r = await sendMessage({ firmId, matterId, appointmentId, body, attachments });
    setBusy(null);
    if (r?.error) { setError(r.error); return; }
    setBody("");
    setAttachments([]);
  }

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const docsHref = matterId ? `/app/matters/${matterId}?tab=documents` : `/app/appointments/${appointmentId}`;

  return (
    <div className="flex flex-col">
      <div className="max-h-[55vh] space-y-3 overflow-y-auto px-4 py-3.5">
        {messages.length === 0 && (
          <p className="py-6 text-center text-[13px] leading-relaxed text-dk-muted">
            No messages yet. Say hello — your lawyer is notified.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === userId;
          const name = mine ? "You" : (m.sender_id && senderNames[m.sender_id]) || firmName;
          return (
            <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  mine
                    ? "max-w-[85%] rounded-[14px] bg-dk-pri px-3.5 py-2.5 text-[13.5px] leading-relaxed text-dk-on-pri"
                    : "max-w-[85%] rounded-[14px] bg-dk-rule px-3.5 py-2.5 text-[13.5px] leading-relaxed text-dk-strong"
                }
              >
                {!mine && <p className="mb-0.5 text-[11.5px] font-semibold text-dk-muted">{name}</p>}
                {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                {m.attachments?.length > 0 && (
                  <ul className="mt-0.5">
                    {m.attachments.map((a) => (
                      <li key={a.document_id}>
                        <a
                          href={docsHref}
                          className="inline-flex min-h-[44px] items-center gap-1.5 text-[12.5px] underline underline-offset-2"
                        >
                          <PaperclipIcon size={13} className="flex-none" />
                          {a.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <p className={`mt-1 text-[11px] ${mine ? "text-dk-on-pri opacity-75" : "text-dk-muted"}`}>
                  {fmt.format(new Date(m.created_at))}{mine && m.read_at ? " · Read" : ""}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="space-y-2.5 border-t border-dk-rule px-4 py-3.5">
        {error && <Alert kind="error">{error}</Alert>}
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {attachments.map((a) => (
              <li key={a.document_id}>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((c) => c.filter((x) => x.document_id !== a.document_id))}
                  className="inline-flex min-h-[44px] max-w-full items-center gap-1.5 rounded-full border border-dk-line bg-dk-tint px-3 text-[12px] text-dk-body"
                >
                  <PaperclipIcon size={13} className="flex-none text-dk-muted" />
                  <span className="truncate">{a.name}</span>
                  <CloseIcon size={13} className="flex-none text-dk-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Write a message…"
          className="w-full rounded-[10px] border border-dk-field bg-white px-3 py-2.5 text-[13.5px] text-dk-strong placeholder:text-dk-muted focus:border-dk-pri focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 text-[12.5px] font-medium text-dk-pri underline underline-offset-2">
            <PaperclipIcon size={14} className="flex-none" />
            {busy?.startsWith("Attaching") ? busy : "Attach a document"}
            <input type="file" className="sr-only" onChange={attach} disabled={Boolean(busy)} />
          </label>
          <AppButton type="submit" variant="primary-sm" disabled={Boolean(busy) || (!body.trim() && attachments.length === 0)}>
            {busy === "Sending…" ? "Sending…" : "Send"}
          </AppButton>
        </div>
      </form>
    </div>
  );
}
