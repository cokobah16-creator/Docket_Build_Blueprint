"use client";

// Message thread on a matter or appointment: Realtime inserts, read receipts,
// document attachments (uploaded through the same documents flow).

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { createDocument, finalizeDocumentVersion, markThreadRead, sendMessage } from "@/lib/actions/portal";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
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
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  // One id per message, minted once. Minting it inside the render would hand `clear()` a
  // different id every render, and the id is what stops a retry landing twice.
  const freshId = useRef<string>(crypto.randomUUID());
  const blank = useRef({ body: "", attachments: [] as MessageAttachment[], id: freshId.current });

  // The draft — the words, the attachments already uploaded, and the id this message will carry
  // — kept on this device until the send returns. A retry after a lost reply lands once.
  //
  // This screen is server-rendered, so the composer is on the glass and takes keystrokes
  // roughly a second before React attaches to it. `reconcile` is where those keystrokes are
  // rescued: it reads what is already in the box and folds it into the draft being restored.
  // A draft saved earlier keeps its place at the front and the new words follow it, which is
  // the order they would have been in had the JavaScript arrived at once. Neither is dropped.
  const draft = useDeviceDraft<{ body: string; attachments: MessageAttachment[]; id: string }>(
    draftKey(userId, `message:${matterId ?? appointmentId}`),
    blank.current,
    (v) => !v.body.trim() && v.attachments.length === 0,
    (saved) => {
      const early = boxRef.current?.value ?? "";
      if (!early) return saved;
      const base = saved?.body ?? "";
      return {
        body: base && !early.startsWith(base) ? `${base}${early}` : early,
        attachments: saved?.attachments ?? [],
        // The saved id is kept so duplicate-send protection still recognises a retry.
        id: saved?.id ?? freshId.current,
      };
    },
  );
  const body = draft.value.body;
  const attachments = draft.value.attachments;
  // Changing the message after a send whose reply was lost makes it a different message: the
  // first may well have landed, and sendMessage() treats the same id arriving twice as already
  // sent — so without a fresh id the edit would be dropped and reported as sent. Messages are
  // immutable, so there would be no way back.
  const [attemptLost, setAttemptLost] = useState(false);
  const edited = <T,>(v: { body: string; attachments: MessageAttachment[]; id: string }, next: Partial<typeof v> & T) =>
    ({ ...v, ...next, id: attemptLost ? crypto.randomUUID() : v.id });
  const setBody = (b: string) => { draft.set((v) => edited(v, { body: b })); if (attemptLost) setAttemptLost(false); };
  const setAttachments = (f: (a: MessageAttachment[]) => MessageAttachment[]) => { draft.set((v) => edited(v, { attachments: f(v.attachments) })); if (attemptLost) setAttemptLost(false); };
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
    // One topic per mount. The browser client is a singleton and realtime-js hands back an
    // existing channel for a repeated topic, so a mount, unmount and mount again on the same
    // thread — which React's strict mode does on every mount in development — would reuse a
    // channel that is still leaving, and a channel can be subscribed once. The suffix makes each
    // mount its own subscription; the id check below makes a duplicate delivery harmless.
    const channel = supabase
      .channel(`messages-${matterId ?? appointmentId}-${crypto.randomUUID()}`)
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

  // The composer is uncontrolled, so that React's first render cannot write an empty string
  // over words that were typed before it attached. The price is that changes the person did
  // not make — a restored draft, the clearing after a send — have to be put into the box by
  // hand. Only on a genuine difference, so this never fights someone mid-word.
  useEffect(() => {
    const el = boxRef.current;
    if (el && el.value !== draft.value.body) el.value = draft.value.body;
  }, [draft.value.body]);

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
      if (r && "error" in r) { setError(r.error); return; }
      // The database's copy, shown at once. Realtime may deliver the same row a moment later;
      // the id check keeps it to one.
      if (r && "message" in r) {
        const row = r.message;
        setMessages((cur) => (cur.some((m) => m.id === row.id) ? cur : [...cur, row]));
      }
      draft.clear();
      setAttemptLost(false);
      // A new id for whatever is written next, so the sent message's id is never reused.
      freshId.current = crypto.randomUUID();
      draft.set({ body: "", attachments: [], id: freshId.current });
      if (boxRef.current) boxRef.current.value = "";
    } catch (e) {
      setAttemptLost(true);
      setError(isNetworkFailure(e) ? NOT_SENT : (e instanceof Error ? e.message : NOT_SENT));
    } finally {
      setBusy(null);
    }
  }

  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const docsHref = matterId ? `/app/matters/${matterId}?tab=documents` : `/app/appointments/${appointmentId}`;

  return (
    <div className="flex flex-col">
      {/* dvh, not vh: the on-screen keyboard shrinks the viewport, and vh does
          not notice — the transcript would keep a height the phone no longer
          has and push the composer under the keyboard. */}
      <div className="max-h-[50dvh] space-y-3 overflow-y-auto px-4 py-4 sm:px-5 lg:max-h-[55dvh]">
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
                      <li key={a.document_id}><a href={docsHref} className="inline-flex items-center gap-1 underline"><Icon name="paperclip" size={12} />{a.name}</a></li>
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
      {/* Sticky, so Send stays on screen when the keyboard opens over the page
          and the bottom bar sits above it. */}
      <form onSubmit={submit} className="sticky bottom-0 space-y-2 border-t border-gray-100 bg-white px-4 py-3 sm:px-5">
        {error && <Alert kind="error">{error}</Alert>}
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-xs">
            {attachments.map((a) => (
              <li key={a.document_id} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 py-1 pl-2.5 pr-1 text-gray-700">
                <Icon name="paperclip" size={12} />
                {a.name}
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((c) => c.filter((x) => x.document_id !== a.document_id))}
                  className="grid size-6 place-items-center rounded-full hover:bg-gray-200"
                >
                  <Icon name="close" size={12} strokeWidth={2.4} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={boxRef}
          // Uncontrolled on purpose: a `value` prop would have React render its own empty
          // state over anything typed into the server-rendered box before it hydrated, and
          // the words would be gone. The state is kept in step through onChange, and the
          // effect above writes back the changes the person did not make.
          defaultValue=""
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Write a message…"
          // 16px: below that iOS Safari zooms the page the moment this takes
          // focus, and the person is left pinching back out to read the reply.
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-brand focus:outline focus:outline-2 focus:outline-brand"
        />
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm text-brand underline focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand">
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
