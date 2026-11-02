// The client's conversation list, rendered the same whether it is the whole
// screen on a phone or the left pane beside an open conversation on a laptop.
// `activeKey` marks the open one, which only the pane ever has.
//
// The rows are divided by the list items, not by borders on the links: a link
// with a border or a tinted ground of its own is drawn as a control and then
// has to clear 3:1 against the page (DESIGN.md), which a hairline never does.
// The open row is marked by aria-current and a bar at its edge, never by a tint.

import type { ReactNode } from "react";
import Link from "next/link";
import { Card, EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { shortWhenWords } from "@/lib/notifications-copy";
import type { ClientThread } from "@/lib/portal-threads";

export function ThreadList({
  threads,
  timezone,
  userId,
  activeKey,
  emptyHint,
  emptyAction,
}: {
  threads: ClientThread[];
  timezone: string;
  userId: string;
  activeKey?: string;
  /** What will appear here, said by the screen that knows the firm's name. */
  emptyHint?: string;
  /** The one thing that would start a conversation, for a client who has none. */
  emptyAction?: ReactNode;
}) {
  return (
    <Card>
      {threads.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          hint={
            emptyHint ??
            "Each matter and consultation has its own private conversation. Only your firm and the people on that matter or consultation can read it."
          }
          action={emptyAction}
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {threads.map((t) => {
            const open = activeKey === t.key;
            return (
              <li key={t.key}>
                <Link
                  href={t.href}
                  aria-current={open ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-start justify-between gap-3 px-4 py-3.5 transition duration-fast hover:bg-hover",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand",
                    open && "shadow-[inset_3px_0_0_var(--dk-primary)]",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-15 font-semibold leading-snug text-ink">{t.title}</p>
                    <p className="mt-0.5 truncate text-13 text-ink-muted">{t.subtitle}</p>
                    {t.last && (
                      // The preview and its time on one line: the preview gives way, the time
                      // (with its zone) never does.
                      <p className="mt-1 flex gap-2 text-13 text-ink-muted">
                        <span className="min-w-0 flex-1 truncate">
                          {t.last.sender_id === userId ? "You: " : ""}
                          {t.last.body || "Attachment"}
                        </span>
                        <span className="shrink-0">{shortWhenWords(t.last.created_at, timezone)}</span>
                      </p>
                    )}
                  </div>
                  {t.unread > 0 && (
                    <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-11 font-bold text-brand-on">
                      <span className="sr-only">Unread messages: </span>
                      {t.unread}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
