// The client update's shape, as the client reads it — and as staff see that the client reads it.
//
// Every part is named, and a part that was not given is not shown: an absence must not look like
// a statement. The one thing said out loud from a false is "Nothing is needed from you", because
// that is a claim the lawyer made, and it is the whole point of the flag.
//
// Both answers sit under the same label, "What you need to do", so a client learns where to look
// once. Each carries its mark as well as its tint, because a status is never colour alone
// (DESIGN.md), and the tints are the theme's status tokens, so they hold in dark mode.

import { calendarDayWords } from "@/lib/notifications-copy";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

interface Shaped {
  meaning: string | null;
  next_step: string | null;
  client_action: string | null;
  action_required: boolean | null;
  next_update_by: string | null;
}

export function UpdateStructure({ update, compact = false }: { update: Shaped; compact?: boolean }) {
  const u = update;
  const rows: Array<[string, string, ("action" | "none")?]> = [];
  if (u.meaning) rows.push(["What it means", u.meaning]);
  if (u.next_step) rows.push(["What happens next", u.next_step]);
  if (u.action_required === true && u.client_action) rows.push(["What you need to do", u.client_action, "action"]);
  if (u.action_required === false) rows.push(["What you need to do", "Nothing is needed from you.", "none"]);
  // The firm is never "we" on a client screen: the portal speaks for several firms (docs/VOICE.md, rule 2).
  if (u.next_update_by) rows.push(["Next update", `Expect to hear from your lawyer by ${calendarDayWords(u.next_update_by)}.`]);
  if (rows.length === 0) return null;
  return (
    <dl className={compact ? "mt-2 space-y-1.5 text-13" : "mt-3 space-y-2 text-15"}>
      {rows.map(([label, text, kind]) => (
        <div
          key={`${label}-${kind ?? ""}`}
          className={cn(
            kind === "action" && "rounded-card border border-waiting-line bg-waiting-bg px-3 py-2",
            kind === "none" && "rounded-card border border-settled-line bg-settled-bg px-3 py-2",
          )}
        >
          <dt className="text-11 uppercase tracking-[0.06em] text-ink-muted">{label}</dt>
          {kind ? (
            <dd className={cn("flex items-start gap-1.5", kind === "action" ? "font-medium text-waiting-ink" : "text-settled-ink")}>
              <Icon name={kind === "action" ? "alert" : "check"} size={compact ? 14 : 16} strokeWidth={2.2} className="mt-0.5 shrink-0" />
              <span>{text}</span>
            </dd>
          ) : (
            <dd className="text-ink">{text}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
