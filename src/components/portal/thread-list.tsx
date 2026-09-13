// The client's conversation list, rendered the same whether it is the whole
// screen on a phone or the left pane beside an open conversation on a laptop.
// `activeKey` marks the open one, which only the pane ever has.

import Link from "next/link";
import { Card, EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { ClientThread } from "@/lib/portal-threads";

export function ThreadList({
  threads,
  timezone,
  userId,
  activeKey,
}: {
  threads: ClientThread[];
  timezone: string;
  userId: string;
  activeKey?: string;
}) {
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  return (
    <Card>
      {threads.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          hint="Each matter and consultation has its own secure thread with your firm."
        />
      ) : (
        <ul>
          {threads.map((t) => {
            const open = activeKey === t.key;
            return (
              <li key={t.key}>
                <Link
                  href={t.href}
                  aria-current={open ? "page" : undefined}
                  className={cn(
                    "flex items-start justify-between gap-3 border-t border-gray-100 px-4 py-3.5 first:border-t-0",
                    open ? "bg-brand-surface" : "hover:bg-gray-50",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-snug text-gray-900">{t.title}</p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">{t.subtitle}</p>
                    {t.last && (
                      <p className="mt-1 truncate text-xs text-gray-600">
                        {t.last.sender_id === userId ? "You: " : ""}
                        {t.last.body ?? "Attachment"} · {fmt.format(new Date(t.last.created_at))}
                      </p>
                    )}
                  </div>
                  {t.unread > 0 && (
                    <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-on">
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
