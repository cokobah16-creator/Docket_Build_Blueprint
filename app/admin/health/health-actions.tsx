// The one thing an operator can DO from the health screen: put a single failed message back in
// the queue.
//
// WHY IT ASKS FOR AN ID INSTEAD OF PUTTING A BUTTON ON A ROW. platform_notification_health is
// GROUPED — firm, status, channel, event, and counts. It carries no notification id, because it
// carries no payload and no recipient either: migration 20 chose that shape so an operator can
// see that something is failing without reading anybody's business. retry_notification() works
// on ONE notification, so the id has to come from somewhere that legitimately has it — the
// dispatcher's own log, or the Sentry event raised when the send failed. There is no bulk
// retry, and inventing one would mean giving this screen the ids, which would mean giving it
// the rows.
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Send one failed notification again. Returns void: it always redirects with the outcome. */
async function retryOneNotification(formData: FormData): Promise<void> {
  "use server";

  const id = String(formData.get("notification") ?? "").trim();
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

/**
 * The retry form. `failedRows` is only used to say how many failed messages the grouped view
 * can see, so the number on screen is the database's count and not a guess.
 */
export function RetryNotification({ failedRows }: { failedRows: number }) {
  return (
    <form action={retryOneNotification} className="space-y-3">
      <div>
        <label htmlFor="notification-id" className="block text-sm font-medium text-gray-800">
          Notification id
        </label>
        <input
          id="notification-id"
          name="notification"
          required
          inputMode="text"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder="00000000-0000-0000-0000-000000000000"
          aria-describedby="notification-id-hint"
          className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-brand focus:outline focus:outline-2 focus:outline-brand"
        />
      </div>
      <p id="notification-id-hint" className="text-sm text-gray-600">
        {failedRows === 0
          ? "Nothing is currently failed in the groups below, so there should be nothing to send again."
          : `${failedRows} failed message${failedRows === 1 ? "" : "s"} ${failedRows === 1 ? "is" : "are"} in the groups below.`}{" "}
        The id is not on this page and cannot be — the queue is grouped so that it carries no
        recipient and no payload. Copy it from the dispatcher log or from the Sentry event for
        the failure. The database refuses anything that is not failed right now, and stops at
        five attempts.
      </p>
      <button
        type="submit"
        className="min-h-[44px] w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
      >
        Send this one again
      </button>
    </form>
  );
}
