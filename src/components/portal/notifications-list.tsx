"use client";

// A client's notifications: what describeNotification() says about each one, newest first.
//
// The rows are divided by the list items, and an unread row's tint sits on the item too, never
// on the link: a link with a border or a ground of its own is drawn as a control and then has to
// clear 3:1 against the page (DESIGN.md), which a hairline or a quiet tint never does.

import Link from "next/link";
import { useState } from "react";
import { markNotificationsRead } from "@/lib/actions/portal";
import { describeNotification, shortWhenWords } from "@/lib/notifications-copy";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import type { NotificationRow } from "@/lib/db/types";

export function NotificationsList({ rows, firmNames, timezone, compact = false }: { rows: NotificationRow[]; firmNames: Record<string, string>; timezone: string; compact?: boolean }) {
  const [items, setItems] = useState(rows);
  const unread = items.filter((n) => !n.read_at).length;

  async function readAll() {
    setItems((cur) => cur.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    await markNotificationsRead("all");
  }
  function readOne(id: string) {
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    markNotificationsRead([id]).catch(() => undefined);
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No notifications yet"
        hint="Reminders, updates and messages from your lawyer appear here."
        // Inside the home screen's activity panel a centred block floats; there it starts left.
        align={compact ? "start" : "center"}
      />
    );
  }
  return (
    <div>
      {!compact && unread > 0 && (
        <div className="flex justify-end border-b border-hairline px-4 py-2">
          <Button size="sm" variant="ghost" onClick={readAll}>
            {unread === 1 ? "Mark 1 notification as read" : `Mark all ${unread} as read`}
          </Button>
        </div>
      )}
      <ul className="divide-y divide-hairline">
        {items.map((n) => {
          const c = describeNotification(n.event, n.payload, (n.firm_id && firmNames[n.firm_id]) || "Your firm", timezone);
          // Unread carries a dot, a word for screen readers and a tinted ground: never colour alone.
          return (
            <li key={n.id} className={n.read_at ? undefined : "bg-sunken"}>
              <Link
                href={c.url}
                onClick={() => readOne(n.id)}
                className="flex min-h-11 items-start gap-2.5 px-4 py-3 transition duration-fast hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
              >
                <span
                  aria-hidden="true"
                  className={`mt-2 size-[7px] shrink-0 rounded-full ${n.read_at ? "bg-transparent" : "bg-brand"}`}
                />
                <span className="min-w-0 flex-1">
                  {!n.read_at && <span className="sr-only">Unread. </span>}
                  <span className="block text-15 font-semibold leading-snug text-ink">{c.title}</span>
                  {c.body && <span className="mt-0.5 block text-13 leading-[1.4] text-ink-muted">{c.body}</span>}
                  <span className="mt-0.5 block text-11 text-ink-muted">{shortWhenWords(n.created_at, timezone)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
