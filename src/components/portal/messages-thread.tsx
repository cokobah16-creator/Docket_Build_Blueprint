"use client";

// Message thread on a matter or appointment: Realtime inserts, read receipts,
// document attachments (uploaded through the same documents flow).

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { createDocument, finalizeDocumentVersion, markThreadRead, sendMessage } from "@/lib/actions/portal";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { MessageAttachment, MessageRow } from "@/lib/db/types";
import { sha256Hex } from "@/lib/checksum";
import { NOT_SENT, draftKey, isNetworkFailure, useDeviceDraft } from "@/lib/drafts";
import { OfflineNote, useConnectionState } from "@/components/ui/connection";

export function MessagesThread({
  firmId, matterId, appointmentId, userId, initial, timezone, senderNames, firmName,
}: {
  firmId: string; matterId: string | null; appointmentId: string | null; userId: string;
  initial: MessageRow[]; timezone: string; senderNames: Record<string, string>; firmName: string;
}) {
  const [messages, setMessages] = useState<MessageRow[]>(initial);
  // The draft — the words, the attachments already uploaded, and the id this message will carry
  // — kept on this device until the send returns. A retry after a lost reply lands once.
  const draft = useDeviceDraft<{ body: string; attachments: MessageAttachment[]; id: string }>(
    draftKey(userId, `message:${matterId ?? appointmentId}`),
    { body: "", attachments: [], id: crypto.randomUUID() },
    (v) => !v.body.trim() && v.attachments.length === 0,
  );
  const body = draft.value.body;
  const attachments = draft.value.attachments;
  const setBody = (b: string) => draft.set((v) => ({ ...v, body: b }));
  const setAttachments = (f: (a: MessageAttachment[]) => MessageAttachment[]) => draft.set((v) => ({ ...v, attachments: f(v.attachments) }));
  const { online } = useConnectionState();
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
    try {
      const created = await createDocument({ firmId, matterId, appointmentId, name: file.name, mime: file.type || "application/octet-stream", sizeBytes: file.size });
      if (!created.ok) { setError(created.error); return; }
      const { error: upErr } = await supabase.storage.from("documents").upload(created.storagePath, file, { contentType: file.type || undefined });
      if (upErr) { setError(`Upload failed: ${upErr.message}`); return; }
      const fin = await finalizeDocumentVersion({ documentId: created.documentId, versionId: created.versionId, storagePath: created.storagePath, mime: file.type || "application/octet-stream", sizeBytes: file.size, checksum: await sha256Hex(file) });
      if (fin?.error) { setError(fin.error); return; }
      setAttachments((a) => [...a, { document_id: created.documentId, name: file.name, mime: file.type || null }]);
    } catch (e) {
      setError(isNetworkFailure(e) ? "The attachment did not go through — the connection dropped. Try again when you are back." : (e instanceof Error ? e.message : NOT_SENT));
    } finally {
      setBusy(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, firmId, matterId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("Sending…");
    try {
      const r = await sendMessage({ firmId, matterId, appointmentId, body, attachments, id: draft.value.id });
      if (r?.error) { setError(r.error); return; }
      draft.clear();
      draft.set({ body: "", attachments: [], id: crypto.randomUUID() });
    } catch (e) {
      setError(isNetworkFailure(e) ? NOT_SENT : (e instanceof Error ? e.message : NOT_SENT));
    } finally {
      setBusy(null);
    }
  }

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const docsHref = matterId ? `/app/matters/${matterId}?tab=documents` : `/app/appointments/${appointmentId}`;

  return (
    <div className="flex flex-col">
      <div className="max-h-[55vh] space-y-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No messages yet. Say hello — your lawyer is notified.</p>}
        {messages.map((m) => {
          const mine = m.sender_id === userId;
          const name = mine ? "You" : (m.sender_id && senderNames[m.sender_id]) || firmName;
          return (
            <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${mine ? "bg-brand text-brand-on" : "bg-gray-100 text-gray-900"}`}>
                {!mine && <p className="mb-0.5 text-xs font-semibold opacity-80">{name}</p>}
                {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                {m.attachments?.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {m.attachments.map((a) => (
                      <li key={a.document_id}><a href={docsHref} className="underline">📎 {a.name}</a></li>
                    ))}
                  </ul>
                )}
                <p className={`mt-1 text-[11px] ${mine ? "text-brand-on opacity-80" : "text-gray-500"}`}>
                  {fmt.format(new Date(m.created_at))}{mine && m.read_at ? " · Read" : ""}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit} className="space-y-2 border-t border-gray-100 px-5 py-3">
        {error && <Alert kind="error">{error}</Alert>}
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-xs">
            {attachments.map((a) => (
              <li key={a.document_id} className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">
                📎 {a.name}{" "}
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setAttachments((c) => c.filter((x) => x.document_id !== a.document_id))}>✕</button>
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
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <label className="cursor-pointer text-sm text-brand underline">
            {busy?.startsWith("Attaching") ? busy : "Attach a document"}
            <input type="file" className="sr-only" onChange={attach} disabled={Boolean(busy)} />
          </label>
          <Button type="submit" disabled={Boolean(busy) || !online || (!body.trim() && attachments.length === 0)}>{busy === "Sending…" ? "Sending…" : "Send"}</Button>
        </div>
        {draft.restored && <p className="text-xs text-gray-600">Draft restored — not sent yet.</p>}
        <OfflineNote />
      </form>
    </div>
  );
}
