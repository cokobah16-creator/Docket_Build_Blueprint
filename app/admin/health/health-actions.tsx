// The two things an operator can DO from the health screen: put a failed message back in the
// queue, and enter what a provider charges.
//
// The grouped health view carries no notification id on purpose — no id means no payload and no
// recipient, which is the boundary migration 20 drew. But retry_notification() works on ONE
// message, so an operator who can see that forty reminders failed needs a way to reach one.
// platform_failed_notifications is that way: the same boundary, one row per failed message, with
// an id, what it was, what went wrong and when. Nothing about the person it was going to.
//
// Rules obeyed here:
//  · The database decides. retry_notification() checks is_platform_admin() and mfa_ok() itself,
//    refuses anything that is not currently failed, and stops at five attempts. None of those
//    three rules is repeated below; the refusal is shown word for word instead.
//  · The form action returns void. It always redirects back to /admin/health carrying the
//    outcome, so there is no client JavaScript on this screen at all.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { captureException } from "@/lib/observability";
import { formatWhen } from "@/lib/time";
import type { FailedNotificationRow } from "@/lib/db/types";

/**
 * The event key in ordinary words. describeNotification() needs a payload, a firm name and a
 * zone to build a client-facing sentence, and this screen has none of those by design — so the
 * key itself is unpacked instead.
 */
function describeEvent(event: string): string {
  const words = event.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Send one failed notification again. Returns void: it always redirects with the outcome. */
async function retryOneNotification(formData: FormData): Promise<void> {
  "use server";

  const id = String(formData.get("notificationId") ?? "").trim();
  const qs = new URLSearchParams();

  if (!UUID_RE.test(id)) {
    qs.set(
      "error",
      "That is not a notification id. It is a uuid — 8-4-4-4-12 hexadecimal characters — copied whole from the dispatcher log.",
    );
    redirect(`/admin/health?${qs.toString()}#queue`);
  }

  const supabase = await supabaseServer();
  if (!supabase) {
    qs.set("error", "Supabase is not configured on this deployment, so nothing can be queued.");
    redirect(`/admin/health?${qs.toString()}#queue`);
  }

  const { error } = await supabase.rpc("retry_notification", { p_notification: id });

  if (error) {
    // Worth a Sentry event: a refusal here is either an operator using the wrong id, or the
    // dispatcher having stopped for a reason nobody has looked at yet.
    await captureException(error, {
      where: "admin/health retry_notification",
      extra: { notification: id, code: error.code ?? null },
    });
    qs.set("error", error.message);
  } else {
    revalidatePath("/admin/health");
    qs.set(
      "done",
      "Queued again. The dispatcher picks it up on its next run; if the queue below does not move, the dispatcher itself is what has stopped.",
    );
  }

  redirect(`/admin/health?${qs.toString()}#queue`);
}

/** Enter a provider's rate. The database checks the operator, the second factor and the provider; refusals are shown word for word. */
async function setProviderRateAction(formData: FormData): Promise<void> {
  "use server";

  const qs = new URLSearchParams();
  const provider = String(formData.get("provider") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const currency = String(formData.get("currency") ?? "").trim();
  const amount = String(formData.get("amount") ?? "").trim();
  const effectiveFrom = String(formData.get("effective_from") ?? "").trim();
  const perSegment = formData.get("per_segment") === "on";
  const note = String(formData.get("note") ?? "").trim();

  const minor = Math.round(Number(amount) * 100);
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isFinite(minor) || minor < 0) {
    qs.set("error", "A rate is an amount like 4.00 — the currency's major unit, up to two decimals.");
    redirect(`/admin/health?${qs.toString()}#cost`);
  }
  if (effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    qs.set("error", "The day a rate starts is a calendar day, YYYY-MM-DD.");
    redirect(`/admin/health?${qs.toString()}#cost`);
  }
  const supabase = await supabaseServer();
  if (!supabase) {
    qs.set("error", "Supabase is not configured on this deployment.");
    redirect(`/admin/health?${qs.toString()}#cost`);
  }
  const { error } = await supabase.rpc("set_provider_rate", {
    p_provider: provider, p_channel: channel, p_currency: currency, p_unit_minor: minor,
    p_effective_from: effectiveFrom || null, p_per_segment: perSegment, p_note: note || null,
  });
  if (error) qs.set("error", error.message);
  else { revalidatePath("/admin/health"); qs.set("done", `Rate recorded: ${provider} ${channel} at ${amount} ${currency}${perSegment ? " per segment" : " per message"}.`); }
  redirect(`/admin/health?${qs.toString()}#cost`);
}

const RATE_PROVIDERS = ["termii", "twilio", "resend", "webpush"] as const;
const RATE_CHANNELS = ["sms", "email", "push"] as const;
const inputClass = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

/** The form that enters a rate. No client JavaScript: it posts and redirects like the retry does. */
export function RatesForm() {
  return (
    <form action={setProviderRateAction} className="grid gap-3 sm:grid-cols-3">
      <div>
        <label htmlFor="rate-provider" className="text-sm font-medium text-gray-900">Provider</label>
        <select id="rate-provider" name="provider" className={inputClass} defaultValue="termii">
          {RATE_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="rate-channel" className="text-sm font-medium text-gray-900">Channel</label>
        <select id="rate-channel" name="channel" className={inputClass} defaultValue="sms">
          {RATE_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="rate-currency" className="text-sm font-medium text-gray-900">Currency</label>
        <select id="rate-currency" name="currency" className={inputClass} defaultValue="NGN">
          <option value="NGN">NGN</option>
          <option value="USD">USD</option>
        </select>
      </div>
      <div>
        <label htmlFor="rate-amount" className="text-sm font-medium text-gray-900">Rate</label>
        <p className="text-xs text-gray-500">In the currency's major unit, e.g. 4.00</p>
        <input id="rate-amount" name="amount" type="text" inputMode="decimal" required className={inputClass} />
      </div>
      <div>
        <label htmlFor="rate-from" className="text-sm font-medium text-gray-900">From</label>
        <p className="text-xs text-gray-500">A calendar day. Blank means today.</p>
        <input id="rate-from" name="effective_from" type="date" className={inputClass} />
      </div>
      <div className="flex items-end">
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-900">
          <input type="checkbox" name="per_segment" defaultChecked className="h-5 w-5" /> Per segment (SMS)
        </label>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="rate-note" className="text-sm font-medium text-gray-900">Note</label>
        <input id="rate-note" name="note" type="text" maxLength={300} className={inputClass} placeholder="Which contract, which route" />
      </div>
      <div className="flex items-end">
        <button type="submit" className="min-h-[44px] rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white">Record the rate</button>
      </div>
    </form>
  );
}

/**
 * One row per failed message, each with the button that sends it again.
 *
 * There is no bulk retry. Five failures in a row usually means the provider or the credential is
 * wrong, and sending forty more would cost a client forty more texts before anybody noticed.
 */
export function FailedNotifications({ rows, timezone }: { rows: FailedNotificationRow[]; timezone: string }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        Nothing has failed. A message that fails is listed here with the reason, and can be put
        back in the queue.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {rows.length} failed message{rows.length === 1 ? "" : "s"}. The database refuses a retry on
        anything that is not failed right now, and stops at five attempts. What the message said,
        and who it was for, are not shown here and are not readable from this console.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-gray-900">
                {describeEvent(row.event)} · {row.channel}
              </p>
              <p className="text-xs text-gray-500">
                {row.firm_name ?? "No firm"}
                {row.attempts > 0 ? ` · attempt ${row.attempts} of 5` : ""}
              </p>
            </div>
            {row.error && <p className="mt-1 break-words text-xs text-red-800">{row.error}</p>}
            {(row.failure_kind || row.send_attempts > 0) && (
              <p className="mt-1 text-xs text-gray-500">
                {row.failure_kind === "transient" ? "Transient: the dispatcher tried" : row.failure_kind === "permanent" ? "Permanent: the dispatcher tried" : "Tried"}
                {" "}{row.send_attempts} time{row.send_attempts === 1 ? "" : "s"}{row.provider ? ` with ${row.provider}` : ""}
                {row.failure_kind === "permanent" ? " and stopped — a retry sends the same message to the same address" : ""}.
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Queued {formatWhen(row.created_at, timezone, { dateStyle: "medium", timeStyle: "short" })}
            </p>
            <form action={retryOneNotification} className="mt-2">
              <input type="hidden" name="notificationId" value={row.id} />
              <button
                type="submit"
                disabled={row.attempts >= 5}
                className="min-h-[44px] rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {row.attempts >= 5 ? "Tried five times" : "Send this one again"}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
