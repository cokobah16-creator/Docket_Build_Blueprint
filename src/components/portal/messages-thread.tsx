"use client";

// Message thread on a matter or appointment: Realtime inserts, read receipts,
// document attachments (uploaded through the same documents flow).
//
// Two readers. The client portal and the staff console both render this, and
// each gets its own words: the client's follow docs/VOICE.md (sentences, the
// firm by name, times with their zone), and the console's are as they were.
// `audience` says which; left out, the route does, since /app is the portal.

import { userErrorMessage } from "@/lib/user-error-message";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { createDocument, finalizeDocumentVersion, markThreadRead, sendMessage } from "@/lib/actions/portal";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/card";
import { shortWhenWords } from "@/lib/notifications-copy";
import type { MessageAttachment, MessageRow } from "@/lib/db/types";
import { sha256Hex } from "@/lib/checksum";
import { NOT_SENT, draftKey, isNetworkFailure, useDeviceDraft } from "@/lib/drafts";
import { OfflineNote, useConnectionState } from "@/components/ui/connection";

type Audience = "client" | "staff";

/** The sentences each reader is given. The staff set is the console's wording, unchanged. */
function threadWords(audience: Audience, firmName: string) {
  if (audience === "staff") {
    return {
      empty: "No messages yet. Say hello — your lawyer is notified.",
      tooBig: "Attachments must be 25 MB or smaller.",
      attachDropped: "The attachment did not go through — the connection dropped. Try again when you are back.",
      notSent: NOT_SENT,
      restored: "Draft restored — not sent yet.",
    };
  }
  const firm = firmName?.trim() && firmName.trim() !== "Your firm" ? firmName.trim() : "your firm";
  return {
    empty: `Messages between you and ${firm} appear here. Write the first one below.`,
    tooBig: "That file was not attached because it is larger than 25 MB. Try a smaller file.",
    attachDropped: "The attachment did not go through because the connection dropped. Try again when you are back online.",
    notSent: "Your message was not sent because the connection dropped. What you wrote is kept on this device. Send it again when you are back online.",
    restored: "Draft restored. It has not been sent yet.",
  };
}

export function MessagesThread({
  firmId, matterId, appointmentId, userId, initial, timezone, senderNames, firmName, audience,
}: {
  firmId: string; matterId: string | null; appointmentId: string | null; userId: string;
  initial: MessageRow[]; timezone: string; senderNames: Record<string, string>; firmName: string;
  /** Who is reading. Left out, a page under /app is the client's and anything else the console's. */
  audience?: Audience;
}) {
  const pathname = usePathname();
  const reader: Audience = audience ?? (pathname === "/app" || pathname?.startsWith("/app/") ? "client" : "staff");
  const words = useMemo(() => threadWords(reader, firmName), [reader, firmName]);
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
    if (file.size > 25 * 1024 * 1024) { setError(words.tooBig); return; }
    const supabase = supabaseBrowser();
    if (!supabase) return;
    setError(null);
    setBusy(`Attaching ${file.name}…`);
    try {
      const created = await createDocument({ firmId, matterId, appointmentId, name: file.name, mime: file.type || "application/octet-stream", sizeBytes: file.size });
      if (!created.ok) { setError(created.error); return; }
      const { error: upErr } = await supabase.storage.from("documents").upload(created.storagePath, file, { contentType: file.type || undefined });
      if (upErr) { setError(userErrorMessage(upErr, "The attachment")); return; }
      const fin = await finalizeDocumentVersion({ documentId: created.documentId, versionId: created.versionId, storagePath: created.storagePath, mime: file.type || "application/octet-stream", sizeBytes: file.size, checksum: await sha256Hex(file) });
      if (fin?.error) { setError(fin.error); return; }
      setAttachments((a) => [...a, { document_id: created.documentId, name: file.name, mime: file.type || null }]);
    } catch (e) {
      // Never the thrown text itself: it is a stack's words, not the client's (DESIGN.md, errors).
      setError(isNetworkFailure(e) ? words.attachDropped : userErrorMessage(e, "The attachment"));
    } finally {
      setBusy(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentId, firmId, matterId, words]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("Sending…");
    try {
      const r = await sendMessage({ firmId, matterId, appointmentId, body, attachments, id: draft.value.id });
      if (r?.error) { setError(r.error); return; }
      draft.clear();
      setAttemptLost(false);
      // A new id for whatever is written next, so the sent message's id is never reused.
      freshId.current = crypto.randomUUID();
      draft.set({ body: "", attachments: [], id: freshId.current });
      if (boxRef.current) boxRef.current.value = "";
    } catch (e) {
      setAttemptLost(true);
      setError(isNetworkFailure(e) ? words.notSent : userErrorMessage(e, "Your message"));
    } finally {
      setBusy(null);
    }
  }

  // The client reads "Mon 2 Nov, 10:05 WAT": short, because it sits under every bubble, and
  // always with its zone. The console keeps its own short date.
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  const sentAt = (iso: string) => (reader === "client" ? shortWhenWords(iso, timezone) : fmt.format(new Date(iso)));
  const docsHref = matterId ? `/app/matters/${matterId}?tab=documents` : `/app/appointments/${appointmentId}`;

  return (
    <div className="flex flex-col">
      {/* dvh, not vh: the on-screen keyboard shrinks the viewport, and vh does
          not notice — the transcript would keep a height the phone no longer
          has and push the composer under the keyboard. */}
      <div className="max-h-[50dvh] space-y-3 overflow-y-auto px-4 py-4 sm:px-5 lg:max-h-[55dvh]">
        {messages.length === 0 &&
          (reader === "client" ? (
            <EmptyState title="No messages yet" hint={words.empty} />
          ) : (
            <p className="py-6 text-center text-15 text-ink-muted">{words.empty}</p>
          ))}
        {messages.map((m) => {
          const mine = m.sender_id === userId;
          const name = mine ? "You" : (m.sender_id && senderNames[m.sender_id]) || firmName;
          return (
            <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
              {/* rounded-card: the radius scale stops at 12px (DESIGN.md), and a bubble is a card. */}
              <div className={`max-w-[85%] rounded-card px-4 py-2.5 text-15 ${mine ? "bg-brand text-brand-on" : "bg-sunken text-ink"}`}>
                {!mine && <p className="mb-0.5 text-13 font-semibold opacity-80">{name}</p>}
                {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                {m.attachments?.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-13">
                    {m.attachments.map((a) => (
                      // A full 44px row, because an attachment is something a thumb opens.
                      <li key={a.document_id}><a href={docsHref} className="inline-flex min-h-11 items-center gap-1 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"><Icon name="paperclip" size={12} />{a.name}</a></li>
                    ))}
                  </ul>
                )}
                <p className={`mt-1 text-11 ${mine ? "text-brand-on opacity-80" : "text-ink-muted"}`}>
                  {sentAt(m.created_at)}
                  {mine && m.read_at ? (reader === "client" ? <span className="ml-2">Read</span> : " · Read") : null}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {/* Sticky, so Send stays on screen when the keyboard opens over the page
          and the bottom bar sits above it. */}
      <form onSubmit={submit} className="sticky bottom-0 space-y-2 border-t border-hairline bg-raised px-4 py-3 sm:px-5">
        {error && <Alert kind="error">{error}</Alert>}
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-13">
            {attachments.map((a) => (
              <li key={a.document_id} className="inline-flex items-center gap-1.5 rounded-full bg-sunken py-1 pl-2.5 pr-1 text-ink">
                <Icon name="paperclip" size={12} />
                {a.name}
                {/* 44px to hit, drawn as a 24px circle: the negative margin keeps the chip the
                    height it was while the thumb gets the full target. */}
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((c) => c.filter((x) => x.document_id !== a.document_id))}
                  className="group -my-2.5 -mr-2.5 grid size-11 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-brand"
                >
                  <span className="grid size-6 place-items-center rounded-full group-hover:bg-hover">
                    <Icon name="close" size={12} strokeWidth={2.4} />
                  </span>
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
          // The Input component's own field look (src/components/ui/input.tsx): radius, ground and ink.
          className="w-full rounded-control border border-edge bg-raised px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-brand focus:outline focus:outline-2 focus:outline-brand"
        />
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-15 text-brand underline focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand">
            {busy?.startsWith("Attaching") ? busy : "Attach a document"}
            <input type="file" className="sr-only" onChange={attach} disabled={Boolean(busy)} />
          </label>
          <Button type="submit" disabled={Boolean(busy) || !online || (!body.trim() && attachments.length === 0)}>{busy === "Sending…" ? "Sending…" : "Send"}</Button>
        </div>
        {draft.restored && <p className="text-13 text-ink-muted">{words.restored}</p>}
        <OfflineNote />
      </form>
    </div>
  );
}
