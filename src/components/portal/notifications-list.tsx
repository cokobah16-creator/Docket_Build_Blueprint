"use client";

// The notification rows, on the notifications screen and — with `compact` —
// inside the home screen's "Recent notifications" card.
//
// An unread row carries three signals, not one: a 7px dot in the firm's
// primary, the tinted ground, and the word "Unread" for a screen reader. A
// read row keeps the dot's space so the two line up.

import Link from "next/link";
import { useState } from "react";
import { markNotificationsRead } from "@/lib/actions/portal";
import { describeNotification } from "@/lib/notifications-copy";
import { AppEmpty } from "@/components/app/card";
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

  if (items.length === 0) {
    return <AppEmpty title="Nothing yet" hint="Reminders, updates and messages land here." />;
  }

  return (
    <div>
      {!compact && unread > 0 && (
        <div className="flex justify-end border-b border-dk-rule px-4">
          <button
            type="button"
            onClick={readAll}
            className="min-h-[44px] text-[12.5px] font-medium text-dk-pri underline underline-offset-2"
          >
            Mark all read ({unread})
          </button>
        </div>
      )}
      <ul className="divide-y divide-dk-rule">
        {items.map((n) => {
          const c = describeNotification(n.event, n.payload, (n.firm_id && firmNames[n.firm_id]) || "Your firm", timezone);
          const isUnread = !n.read_at;
          return (
            <li key={n.id}>
              <Link
                href={c.url}
                onClick={() => readOne(n.id)}
                className={`flex gap-[11px] px-4 py-[13px] ${isUnread ? "bg-dk-tint" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-[6px] h-[7px] w-[7px] flex-none rounded-full ${isUnread ? "bg-dk-pri" : "bg-transparent"}`}
                />
                <span className="min-w-0 flex-1">
                  {isUnread && <span className="sr-only">Unread. </span>}
                  <span className="block text-[13.5px] font-semibold leading-[1.35] text-dk-strong">{c.title}</span>
                  {c.body && <span className="mt-0.5 block text-[12.5px] leading-[1.4] text-dk-soft">{c.body}</span>}
                  <span className="mt-[3px] block text-[11px] text-dk-muted">{fmt.format(new Date(n.created_at))}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
