"use client";

// Matter timeline: client-visible updates, newest first, live via Realtime
// (RLS decides what the subscription delivers).

import { UpdateKindMark } from "@/components/ui/update-kind";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { UpdateRow } from "@/lib/db/types";
import { UpdateStructure } from "./update-structure";

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
    return <p className="px-5 py-8 text-center text-15 text-ink-muted">No updates yet. Your lawyer's updates on this matter appear here as they happen.</p>;
  }
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  return (
    <ol className="divide-y divide-hairline">
      {items.map((u) => {
        const p = u.payload ?? {};
        const nextDate = typeof p.next_date === "string" ? p.next_date : null;
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
                  {nextDate && <div><dt className="inline text-ink-muted">Next date: </dt><dd className="inline">{fmt.format(new Date(nextDate))}{typeof p.next_purpose === "string" && p.next_purpose ? ` · ${p.next_purpose}` : ""}</dd></div>}
                </dl>
              )}
              <p className="mt-1 text-13 text-ink-muted">{fmt.format(new Date(u.occurred_at))}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
