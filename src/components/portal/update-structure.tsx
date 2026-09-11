// The client update's shape, as the client reads it — and as staff see that the client reads it.
//
// Every part is named, and a part that was not given is not shown: an absence must not look like
// a statement. The one thing said out loud from a false is "Nothing is needed from you", because
// that is a claim the lawyer made, and it is the whole point of the flag.

import { formatDay } from "@/lib/days";

interface Shaped {
  meaning: string | null;
  next_step: string | null;
  client_action: string | null;
  action_required: boolean | null;
  next_update_by: string | null;
}

export function UpdateStructure({ update, compact = false }: { update: Shaped; compact?: boolean }) {
  const u = update;
  const rows: Array<[string, string, string?]> = [];
  if (u.meaning) rows.push(["What it means", u.meaning]);
  if (u.next_step) rows.push(["What happens next", u.next_step]);
  if (u.action_required === true && u.client_action) rows.push(["What you must do", u.client_action, "action"]);
  if (u.action_required === false) rows.push(["Action from you", "Nothing is needed from you.", "none"]);
  if (u.next_update_by) rows.push(["Next update", `Expect to hear from us by ${formatDay(u.next_update_by)}.`]);
  if (rows.length === 0) return null;
  return (
    <dl className={compact ? "mt-2 space-y-1.5 text-xs" : "mt-3 space-y-2 text-sm"}>
      {rows.map(([label, text, kind]) => (
        <div
          key={label}
          className={
            kind === "action"
              ? "rounded-lg border border-amber-300 bg-amber-50 px-3 py-2"
              : kind === "none"
                ? "rounded-lg border border-green-200 bg-green-50 px-3 py-2"
                : ""
          }
        >
          <dt className={compact ? "text-[10.5px] uppercase tracking-[0.06em] text-gray-500" : "text-[11px] uppercase tracking-[0.06em] text-gray-500"}>{label}</dt>
          <dd className={kind === "action" ? "font-medium text-amber-900" : kind === "none" ? "text-green-900" : "text-gray-800"}>{text}</dd>
        </div>
      ))}
    </dl>
  );
}
