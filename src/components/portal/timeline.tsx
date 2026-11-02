"use client";

// Matter timeline: client-visible updates, newest first, live via Realtime
// (RLS decides what the subscription delivers).
//
// The newest few are shown and the rest fold away under "Earlier updates", so on a phone the
// matter's latest news is not the top of a hundred-entry scroll. A new update arriving live goes
// to the top, as it always did.

import { UpdateKindMark } from "@/components/ui/update-kind";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { calendarDayWords, dayWords, whenWords } from "@/lib/notifications-copy";
import { EmptyState } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import type { UpdateRow } from "@/lib/db/types";
import { UpdateStructure } from "./update-structure";

/** How many updates show before the rest fold away. */
const SHOWN = 5;

export function Timeline({ matterId, initial, timezone }: { matterId: string; initial: UpdateRow[]; timezone: string }) {
  const [items, setItems] = useState<UpdateRow[]>(initial);

  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    const channel = supabase
      .channel(`updates-${matterId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "updates", filter: `matter_id=eq.${matterId}` }, (payload) => {
        const row = payload.new as UpdateRow & { visibility?: string };
        if (row.visibility && row.visibility !== "client") return;
        setItems((cur) => (cur.some((u) => u.id === row.id) ? cur : [row, ...cur].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matterId]);

  if (items.length === 0) {
    return <EmptyState title="No updates yet" hint="Your lawyer's updates on this matter appear here as they happen." />;
  }

  const entry = (u: UpdateRow) => {
    const p = u.payload ?? {};
    const nextDate = typeof p.next_date === "string" ? p.next_date : null;
    // post_court_update() stores an instant; a bare day, if one ever arrives, is a day and has no time.
    const nextWhen = nextDate ? (/^\d{4}-\d{2}-\d{2}$/.test(nextDate) ? calendarDayWords(nextDate) : whenWords(nextDate, timezone)) : "";
    return (
      <li key={u.id} className="flex gap-3 px-5 py-4">
        <UpdateKindMark kind={u.kind} />
        <div className="min-w-0 flex-1">
          <p className="text-15 font-medium text-ink">{u.title}</p>
          {u.body && <p className="mt-1 whitespace-pre-wrap text-15 text-ink">{u.body}</p>}
          <UpdateStructure update={u} />
          {u.kind === "court_sitting" && (
            <dl className="mt-2 grid gap-1 text-13 text-ink-muted sm:grid-cols-2">
              {typeof p.court_name === "string" && p.court_name && <div><dt className="inline text-ink-muted">Court: </dt><dd className="inline">{p.court_name}</dd></div>}
              {nextWhen && <div><dt className="inline text-ink-muted">Next date: </dt><dd className="inline">{nextWhen}{typeof p.next_purpose === "string" && p.next_purpose ? ` (${p.next_purpose})` : ""}</dd></div>}
            </dl>
          )}
          <p className="mt-1 text-13 text-ink-muted">{dayWords(u.occurred_at, timezone)}</p>
        </div>
      </li>
    );
  };
  const recent = items.slice(0, SHOWN);
  const earlier = items.slice(SHOWN);

  return (
    <>
      <ol className="divide-y divide-hairline">{recent.map(entry)}</ol>
      {earlier.length > 0 && (
        <Disclosure framed={false} summary={`Earlier updates (${earlier.length})`} className="border-t border-hairline px-5 pb-1">
          {/* The fold's own padding is cancelled so an entry lines up with the ones above it. */}
          <ol className="-mx-5 -mb-3 divide-y divide-hairline border-t border-hairline">{earlier.map(entry)}</ol>
        </Disclosure>
      )}
    </>
  );
}
