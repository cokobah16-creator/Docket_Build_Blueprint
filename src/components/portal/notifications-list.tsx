"use client";

import Link from "next/link";
import { useState } from "react";
import { markNotificationsRead } from "@/lib/actions/portal";
import { describeNotification } from "@/lib/notifications-copy";
import { Button } from "@/components/ui/button";
import type { NotificationRow } from "@/lib/db/types";

export function NotificationsList({ rows, firmNames, timezone, compact = false }: { rows: NotificationRow[]; firmNames: Record<string, string>; timezone: string; compact?: boolean }) {
  const [items, setItems] = useState(rows);
  const unread = items.filter((n) => !n.read_at).length;
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });

  async function readAll() {
    setItems((cur) => cur.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    await markNotificationsRead("all");
  }
  function readOne(id: string) {
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    markNotificationsRead([id]).catch(() => undefined);
  }

  if (items.length === 0) return <p className="px-5 py-8 text-center text-sm text-gray-500">Nothing yet. Reminders, updates and messages land here.</p>;
  return (
    <div>
      {!compact && unread > 0 && (
        <div className="flex justify-end border-b border-gray-100 px-4 py-2">
          <Button size="sm" variant="ghost" onClick={readAll}>Mark all read ({unread})</Button>
        </div>
      )}
      <ul>
        {items.map((n) => {
          const c = describeNotification(n.event, n.payload, (n.firm_id && firmNames[n.firm_id]) || "Your firm", timezone);
          // Unread carries a dot and a tinted ground — never colour alone.
          return (
            <li key={n.id}>
              <Link
                href={c.url}
                onClick={() => readOne(n.id)}
                className={`flex items-start gap-2.5 border-t border-gray-100 px-4 py-3 first:border-t-0 hover:bg-gray-50 ${n.read_at ? "" : "bg-[#FBFAF7]"}`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-[7px] shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-brand"}`}
                />
                <span className="min-w-0 flex-1">
                  {!n.read_at && <span className="sr-only">Unread. </span>}
                  <span className="block text-[13.5px] font-semibold leading-snug text-gray-900">{c.title}</span>
                  {c.body && <span className="mt-0.5 block text-[12.5px] leading-[1.4] text-gray-600">{c.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-gray-500">{fmt.format(new Date(n.created_at))}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
