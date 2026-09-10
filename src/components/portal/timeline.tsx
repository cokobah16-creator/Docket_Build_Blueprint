"use client";

// Matter timeline: client-visible updates, newest first, live via Realtime
// (RLS decides what the subscription delivers).

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { UpdateRow } from "@/lib/db/types";

const KIND_ICON: Record<string, string> = {
  court_sitting: "⚖", consultation: "🎥", appointment: "📅", filing: "📄", correspondence: "✉",
  milestone: "★", fee: "₦", document: "📎", note: "✎", status_change: "⇄",
};

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
    return <p className="px-5 py-8 text-center text-sm text-gray-500">No updates yet. Your lawyer's updates on this matter appear here as they happen.</p>;
  }
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  return (
    <ol className="divide-y divide-gray-100">
      {items.map((u) => {
        const p = u.payload ?? {};
        const nextDate = typeof p.next_date === "string" ? p.next_date : null;
        return (
          <li key={u.id} className="flex gap-3 px-5 py-4">
            <span aria-hidden="true" className="mt-0.5 w-6 text-center text-base">{KIND_ICON[u.kind] ?? "•"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">{u.title}</p>
              {u.body && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{u.body}</p>}
              {u.kind === "court_sitting" && (
                <dl className="mt-2 grid gap-1 text-xs text-gray-600 sm:grid-cols-2">
                  {typeof p.court_name === "string" && p.court_name && <div><dt className="inline text-gray-500">Court: </dt><dd className="inline">{p.court_name}</dd></div>}
                  {nextDate && <div><dt className="inline text-gray-500">Next date: </dt><dd className="inline">{fmt.format(new Date(nextDate))}{typeof p.next_purpose === "string" && p.next_purpose ? ` · ${p.next_purpose}` : ""}</dd></div>}
                </dl>
              )}
              <p className="mt-1 text-xs text-gray-500">{fmt.format(new Date(u.occurred_at))}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
