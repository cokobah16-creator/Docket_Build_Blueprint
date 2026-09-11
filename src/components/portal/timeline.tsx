"use client";

// Matter timeline: client-visible updates, newest first, live via Realtime
// (RLS decides what the subscription delivers).
//
// It renders in both shells — inside the client's matter card and inside the
// console's — so there is not a fixed colour below: every one is a dk-* token
// the shell redefines, and the firm's brand only reaches the client side.
//
// The kind used to be an emoji in a 24px column (⚖ 🎥 📅 📄 ✉ ★ ₦ 📎 ✎ ⇄).
// It is now a line icon from the app's own set, on the shell's quiet grey, in
// a 28px disc that keeps every row's text on one left margin whatever the
// glyph. The icon is not the only signal: each row carries the kind as
// screen-reader text, because a picture of a balance is not a word.

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { AppEmpty } from "@/components/app/card";
import type { IconProps } from "@/components/ui/icons";
import {
  CalendarIcon,
  DocumentIcon,
  MailIcon,
  NairaIcon,
  PaperclipIcon,
  PencilIcon,
  ScalesIcon,
  StarIcon,
  SwapIcon,
  VideoIcon,
} from "@/components/ui/icons";
import type { UpdateRow } from "@/lib/db/types";

type IconGlyph = (p: IconProps) => React.JSX.Element;

/**
 * The ten `update_kind` values, each with its mark and its name. Typed as
 * possibly-missing on purpose: the enum can grow in a migration before it
 * grows here, and an unnamed kind falls back to a dot rather than nothing.
 */
const KINDS: Record<string, { Icon: IconGlyph; label: string } | undefined> = {
  court_sitting: { Icon: ScalesIcon, label: "Court sitting" },
  consultation: { Icon: VideoIcon, label: "Consultation" },
  appointment: { Icon: CalendarIcon, label: "Appointment" },
  filing: { Icon: DocumentIcon, label: "Filing" },
  correspondence: { Icon: MailIcon, label: "Correspondence" },
  milestone: { Icon: StarIcon, label: "Milestone" },
  fee: { Icon: NairaIcon, label: "Fee" },
  document: { Icon: PaperclipIcon, label: "Document" },
  note: { Icon: PencilIcon, label: "Note" },
  status_change: { Icon: SwapIcon, label: "Status change" },
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
    return <AppEmpty title="No updates yet" hint="Your lawyer's updates on this matter appear here as they happen." />;
  }
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone });
  return (
    <ol className="divide-y divide-dk-rule">
      {items.map((u) => {
        const p = u.payload ?? {};
        const nextDate = typeof p.next_date === "string" ? p.next_date : null;
        const kind = KINDS[u.kind];
        const Glyph = kind?.Icon;
        return (
          <li key={u.id} className="flex gap-[11px] px-4 py-[13px]">
            <span
              aria-hidden="true"
              className="mt-[1px] grid h-7 w-7 flex-none place-items-center rounded-full bg-dk-rule text-dk-soft"
            >
              {Glyph ? <Glyph size={15} /> : <span className="h-[5px] w-[5px] rounded-full bg-dk-muted" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                <span className="sr-only">{kind?.label ?? "Update"}. </span>
                {u.title}
              </p>
              {u.body && (
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-dk-body">{u.body}</p>
              )}
              {u.kind === "court_sitting" && (
                <dl className="mt-1.5 grid gap-1 text-[12px] leading-snug text-dk-soft">
                  {typeof p.court_name === "string" && p.court_name && (
                    <div>
                      <dt className="inline text-dk-muted">Court: </dt>
                      <dd className="inline">{p.court_name}</dd>
                    </div>
                  )}
                  {nextDate && (
                    <div>
                      <dt className="inline text-dk-muted">Next date: </dt>
                      <dd className="inline">
                        {fmt.format(new Date(nextDate))}
                        {typeof p.next_purpose === "string" && p.next_purpose ? ` · ${p.next_purpose}` : ""}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              <p className="mt-[3px] text-[11px] text-dk-muted">{fmt.format(new Date(u.occurred_at))}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
