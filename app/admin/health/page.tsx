// /admin/health — is anything failing, and where.
//
// Three questions, in the order a Docket operator should answer them:
//   1. Did anybody's money go to the wrong account?  (settlement — the serious one)
//   2. Are clients getting the messages we promised?  (the notification queue)
//   3. Is anything reaching us that we could not verify?  (webhooks)
//
// WHAT THIS PAGE CAN SEE, and what it deliberately cannot. Everything here comes from three
// definer views built in migration 20 — platform_notification_health, platform_settlement_health
// and webhook_events. A platform admin has NO row read of firms, notifications or payments;
// migration 13 removed the last of it. So:
//   · the queue is GROUPED, and carries no payload and no recipient. An operator can see that
//     twelve reminders failed on one firm's SMS channel without learning who was being reminded
//     or what about. That boundary is stated on the page, because an operator should know the
//     shape of the room they are working in.
//   · settlement shows the invoice number, the amount, and the two Paystack subaccount codes.
//     That is a deliberate narrowing of "platform admins never see matter content": reconciling
//     a mis-settled charge is impossible without it. It stops there — no line items, no matter,
//     no client.
//   · webhooks show what a provider sent and what Docket did with it, never the body of a
//     verified event.
//
// Money is never added across currencies: a per-currency total is built with
// formatMoneyByCurrency, which keeps naira and dollars apart on purpose.
//
// Every read is capped, and every cap is said out loud rather than quietly truncating.

import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  failedNotifications, notificationHealth, platformContext, settlementHealth, webhookEvents,
} from "@/lib/admin-data";
import { formatMoneyByCurrency, formatMoneyMinor } from "@/lib/money";
import { formatWhen } from "@/lib/time";
import type { NotificationHealthRow, SettlementHealthRow, WebhookEventRow } from "@/lib/db/types";
import { FailedNotifications } from "./health-actions";

export const metadata = { title: "Platform health" };

/** admin-data caps the grouped queue at 200 groups; these two are ours. */
const QUEUE_GROUP_LIMIT = 200;
const SETTLEMENT_LIMIT = 100;
const WEBHOOK_LIMIT = 100;

/** Failed first, then what is still waiting, then everything that already worked. */
const STATUS_RANK: Record<string, number> = { failed: 0, queued: 1, sending: 2, sent: 3 };

const STATUS_STYLE: Record<string, string> = {
  failed: "bg-red-100 text-red-900",
  queued: "bg-amber-100 text-amber-900",
  sending: "bg-sky-100 text-sky-900",
  sent: "bg-emerald-100 text-emerald-900",
};

const OUTCOME_MEANING: Record<string, string> = {
  processed: "Verified and acted on.",
  ignored: "Verified, but nothing in Docket needed to change.",
  unverified: "The signature did not check out. Either the webhook secret on this deployment is wrong, or somebody is probing the endpoint.",
  unreadable: "The signature checked out but the body could not be read as an event Docket knows.",
  error: "Docket accepted it and then failed while acting on it. This one is ours.",
};

const OUTCOME_STYLE: Record<string, string> = {
  processed: "bg-emerald-100 text-emerald-900",
  ignored: "bg-gray-100 text-gray-700",
  unverified: "bg-red-100 text-red-900",
  unreadable: "bg-amber-100 text-amber-900",
  error: "bg-red-100 text-red-900",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="break-words text-sm text-gray-900">{children}</dd>
    </div>
  );
}

/** "3 days ago", "2 hours ago" — how long something has been sitting there. */
function agoLabel(iso: string, nowMs: number): string {
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const minutes = Math.round((nowMs - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return rtf.format(-Math.max(1, minutes), "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

/** A firm with a name, or the plain truth that this notification belongs to no firm. */
function firmLabel(row: { firm_name: string | null; firm_slug: string | null; firm_id: string | null }): string {
  if (row.firm_name) return row.firm_name;
  if (row.firm_slug) return row.firm_slug;
  return row.firm_id ? `Firm ${row.firm_id}` : "Not tied to a firm";
}

export default async function AdminHealthPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await platformContext();
  if (!ctx) {
    // The layout has already said which of the four things went wrong; this is only here so the
    // page can never render a half-authenticated screen if it is ever reached another way.
    return (
      <Alert kind="error" title="Not available">
        This screen is for Docket platform administrators.
      </Alert>
    );
  }

  const [queue, settlement, webhooks, failed] = await Promise.all([
    notificationHealth(ctx.supabase),
    settlementHealth(ctx.supabase, SETTLEMENT_LIMIT),
    webhookEvents(ctx.supabase, { limit: WEBHOOK_LIMIT }),
    failedNotifications(ctx.supabase),
  ]);

  const tz = ctx.timezone;
  const nowMs = Date.now();
  const when = (iso: string) => formatWhen(iso, tz);

  // ---------------------------------------------------------------- the queue, summed
  const overdue = queue.reduce((sum, r) => sum + Number(r.overdue ?? 0), 0);
  const failedRows = queue
    .filter((r) => r.status === "failed")
    .reduce((sum, r) => sum + Number(r.rows ?? 0), 0);
  const queuedRows = queue
    .filter((r) => r.status === "queued")
    .reduce((sum, r) => sum + Number(r.rows ?? 0), 0);

  // Grouped by firm so an operator reads "this firm's SMS is broken", not a flat list of rows.
  const byFirm = new Map<string, { key: string; label: string; rows: NotificationHealthRow[] }>();
  for (const row of queue) {
    const key = row.firm_id ?? "none";
    const entry = byFirm.get(key) ?? { key, label: firmLabel(row), rows: [] };
    entry.rows.push(row);
    byFirm.set(key, entry);
  }
  const firmGroups = Array.from(byFirm.values()).map((g) => ({
    ...g,
    rows: [...g.rows].sort(
      (a, b) =>
        (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
        Number(b.overdue ?? 0) - Number(a.overdue ?? 0) ||
        Number(b.rows ?? 0) - Number(a.rows ?? 0),
    ),
  }));
  firmGroups.sort((a, b) => {
    const bad = (g: { rows: NotificationHealthRow[] }) =>
      g.rows.reduce((sum, r) => sum + Number(r.overdue ?? 0) + (r.status === "failed" ? Number(r.rows ?? 0) : 0), 0);
    return bad(b) - bad(a) || a.label.localeCompare(b.label);
  });

  // ---------------------------------------------------------------- settlement, mismatches first
  const disagrees = (r: SettlementHealthRow) =>
    r.settlement_mismatch ||
    (!!r.reported_subaccount && !!r.expected_subaccount && r.reported_subaccount !== r.expected_subaccount);
  const mismatched = settlement.filter(disagrees);
  const otherFailures = settlement.filter((r) => !disagrees(r));

  // Minor units of two currencies are never added. This keeps them apart, per currency.
  const mismatchedByCurrency: Record<string, number> = {};
  for (const row of mismatched) {
    mismatchedByCurrency[row.currency] = (mismatchedByCurrency[row.currency] ?? 0) + Number(row.amount_minor ?? 0);
  }
  const mismatchCurrencies = Object.keys(mismatchedByCurrency);

  // ---------------------------------------------------------------- webhooks, bad first
  const badWebhooks = webhooks.filter((w) => w.outcome !== "processed");
  const goodWebhooks = webhooks.filter((w) => w.outcome === "processed");

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-brand">Platform health</h1>
        <p className="text-sm text-gray-600">
          {mismatched.length} settlement mismatch{mismatched.length === 1 ? "" : "es"} · {failedRows} failed
          message{failedRows === 1 ? "" : "s"} · {overdue} overdue in the queue · {badWebhooks.length} webhook
          {badWebhooks.length === 1 ? "" : "s"} that did not process
        </p>
      </header>

      <Alert kind="info" title="What this page can and cannot see">
        The queue below is <strong>grouped</strong>: counts, timings and one representative error per
        group. It carries no message payload and no recipient, by design — an operator can see that a
        firm&apos;s reminders are failing without learning who was being reminded or what about.
        Settlement is the one deliberate exception: an invoice number, an amount and two Paystack
        subaccount codes, because a charge that settled to the wrong account cannot be reconciled
        without them. Nothing on this page reaches a matter, a document or a client.
      </Alert>

      {/* ============================================================ settlement */}
      <section id="settlement" className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-gray-900">Settlement</h2>

        {mismatched.length > 0 && (
          <Alert kind="error" title="Money went somewhere Docket did not expect">
            {mismatched.length} payment{mismatched.length === 1 ? "" : "s"}{" "}
            {mismatched.length === 1 ? "was" : "were"} reported by Paystack against a subaccount that is
            not the one set on the firm.{" "}
            {mismatchCurrencies.length > 0 && (
              <>
                Together that is{" "}
                <strong>{formatMoneyByCurrency(mismatchedByCurrency, mismatchCurrencies[0])}</strong>, kept
                per currency because minor units of two currencies are not the same thing.{" "}
              </>
            )}
            Each one was recorded as a <strong>failed</strong> payment and the invoice was{" "}
            <strong>not</strong> marked paid, so on Docket the client still shows as owing while their
            money has already left their account. A message telling the firm was queued for it; the
            queue below is where you check that it actually went out. Reconcile each one with
            Paystack directly — Docket cannot move a settlement, and nothing on this screen will
            change one.
          </Alert>
        )}

        {settlement.length === 0 ? (
          <Card>
            <EmptyState
              title="No payment is waiting to be reconciled"
              hint="This view holds only payments that did not reach 'succeeded' — so either every charge settled to the right account, or no firm has taken one yet. Check the notification queue below."
            />
          </Card>
        ) : (
          <>
            {mismatched.length > 0 && (
              <ul className="space-y-4">
                {mismatched.map((row) => (
                  <li key={row.payment_id}>
                    <Card className="border-red-200">
                      <CardHeader
                        title={`Invoice ${row.invoice_number}`}
                        action={<Badge className="bg-red-100 text-red-900">subaccount mismatch</Badge>}
                      />
                      <CardBody>
                        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <Field label="Firm">{firmLabel(row)}</Field>
                          <Field label="Amount">{formatMoneyMinor(Number(row.amount_minor), row.currency)}</Field>
                          <Field label="Payment status">{row.status}</Field>
                          <Field label="Paystack reported">
                            <code className="break-all">{row.reported_subaccount ?? "none given"}</code>
                          </Field>
                          <Field label="Docket expected">
                            <code className="break-all">{row.expected_subaccount ?? "none set for this firm"}</code>
                          </Field>
                          <Field label="Provider reference">
                            <code className="break-all">{row.provider_ref}</code>
                          </Field>
                          <Field label="Paid">
                            {row.paid_at ? when(row.paid_at) : "never recorded as paid"}
                          </Field>
                        </dl>
                        {!row.expected_subaccount && (
                          <p className="mt-3 text-sm text-red-800">
                            This firm has no Paystack subaccount at all, so nothing it charges can ever
                            settle correctly. Only the firm can set one, in its own settings — the
                            platform has no write on that column. Ask an owner to add it before the
                            firm takes another payment;{" "}
                            <Link href={`/admin#firm-${row.firm_id}`} className="font-medium underline">
                              its card on the firms screen
                            </Link>{" "}
                            names the owners.
                          </p>
                        )}
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>
            )}

            {otherFailures.length > 0 && (
              <Card>
                <CardHeader
                  title={`Payments that did not succeed (${otherFailures.length})`}
                  action={<Badge>no mismatch</Badge>}
                />
                <Table>
                  <THead>
                    <TR>
                      <TH>Invoice</TH>
                      <TH>Firm</TH>
                      <TH>Amount</TH>
                      <TH>Status</TH>
                      <TH>Reference</TH>
                      <TH>Paid</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {otherFailures.map((row) => (
                      <TR key={row.payment_id}>
                        <TD className="font-medium text-gray-900">{row.invoice_number}</TD>
                        <TD>{firmLabel(row)}</TD>
                        <TD className="whitespace-nowrap">
                          {formatMoneyMinor(Number(row.amount_minor), row.currency)}
                        </TD>
                        <TD>{row.status}</TD>
                        <TD className="break-all font-mono text-xs">{row.provider_ref}</TD>
                        <TD className="whitespace-nowrap">{row.paid_at ? when(row.paid_at) : "—"}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            )}

            {settlement.length === SETTLEMENT_LIMIT && (
              <p className="text-xs text-gray-500">
                Showing {SETTLEMENT_LIMIT} unsuccessful payments, the most recently recorded first.
                There are more than that, and they are not on this page.
              </p>
            )}
          </>
        )}
      </section>

      {/* ============================================================ notifications */}
      <section id="queue" className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-gray-900">The notification queue</h2>

        {sp.error && <Alert kind="error">{sp.error}</Alert>}
        {sp.done && <Alert kind="success">{sp.done}</Alert>}

        {overdue > 0 && (
          <Alert kind="warning" title="The dispatcher looks like it has stopped">
            {overdue} message{overdue === 1 ? " is" : "s are"} still queued more than fifteen minutes
            after the time {overdue === 1 ? "it was" : "they were"} due to go out. Messages queue in
            Postgres and are sent by the <code>dispatch-notifications</code> Edge Function, which is
            scheduled from the Supabase dashboard (Integrations → Cron → an HTTP request to{" "}
            <code>/functions/v1/dispatch-notifications</code> every minute). If nothing is moving,
            that schedule is the first thing to check.
          </Alert>
        )}

        <p className="text-sm text-gray-600">
          {queuedRows} waiting · {failedRows} failed · {overdue} overdue ·{" "}
          {queue.length} group{queue.length === 1 ? "" : "s"} across {firmGroups.length} firm
          {firmGroups.length === 1 ? "" : "s"}
        </p>

        {queue.length === 0 ? (
          <Card>
            <EmptyState
              title="There is nothing in the notification queue"
              hint="No firm on Docket has a message waiting, sent or failed. If that is a surprise, the dispatch-notifications Edge Function has never run — schedule it from the Supabase dashboard."
            />
          </Card>
        ) : (
          <ul className="space-y-4">
            {firmGroups.map((group) => (
              <li key={group.key}>
                <Card>
                  <CardHeader
                    title={group.label}
                    action={
                      <span className="flex flex-wrap items-center justify-end gap-2">
                        {group.rows.some((r) => r.status === "failed") && (
                          <Badge className="bg-red-100 text-red-900">failing</Badge>
                        )}
                        {group.rows.some((r) => Number(r.overdue ?? 0) > 0) && (
                          <Badge className="bg-amber-100 text-amber-900">overdue</Badge>
                        )}
                      </span>
                    }
                  />
                  <Table>
                    <THead>
                      <TR>
                        <TH>Status</TH>
                        <TH>Channel</TH>
                        <TH>Event</TH>
                        <TH>Count</TH>
                        <TH>Overdue</TH>
                        <TH>Oldest</TH>
                        <TH>Tries</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {group.rows.map((row) => (
                        <TR key={`${row.status}-${row.channel}-${row.event}`}>
                          <TD>
                            <Badge className={STATUS_STYLE[row.status] ?? "bg-gray-100 text-gray-700"}>
                              {row.status}
                            </Badge>
                          </TD>
                          <TD>{row.channel}</TD>
                          <TD className="break-words">{row.event.replace(/_/g, " ")}</TD>
                          <TD className="tabular-nums">{row.rows}</TD>
                          <TD className={Number(row.overdue ?? 0) > 0 ? "font-medium text-amber-800" : ""}>
                            {row.overdue}
                          </TD>
                          <TD className="whitespace-nowrap">
                            {when(row.oldest)}
                            <span className="block text-xs text-gray-500">
                              {agoLabel(row.oldest, nowMs)}
                            </span>
                          </TD>
                          <TD className="tabular-nums">{row.most_attempts}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>

                  {group.rows.some((r) => r.last_error) && (
                    <div className="space-y-2 border-t border-gray-100 px-5 py-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">
                        The most recent error in each group that has one
                      </p>
                      <ul className="space-y-1">
                        {group.rows
                          .filter((r) => r.last_error)
                          .map((r) => (
                            <li key={`err-${r.status}-${r.channel}-${r.event}`} className="text-sm text-gray-700">
                              <span className="font-medium text-gray-900">
                                {r.channel} · {r.event.replace(/_/g, " ")}
                              </span>
                              <span className="block break-words text-red-800">{r.last_error}</span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}

        {queue.length === QUEUE_GROUP_LIMIT && (
          <p className="text-xs text-gray-500">
            Showing the {QUEUE_GROUP_LIMIT} largest groups. Smaller ones are not on this page.
          </p>
        )}

        <Card>
          <CardHeader title="Send one failed message again" />
          <CardBody>
            <FailedNotifications rows={failed} timezone={ctx.timezone} />
          </CardBody>
        </Card>
      </section>

      {/* ============================================================ webhooks */}
      <section id="webhooks" className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-gray-900">What providers sent us</h2>

        {badWebhooks.length > 0 && (
          <Alert kind="warning" title={`${badWebhooks.length} did not process`}>
            An <strong>unverified</strong> outcome means the signature did not check out: either the
            webhook secret on this deployment does not match the one in the provider&apos;s dashboard,
            or somebody is probing the endpoint. Neither is harmless, and the two are told apart by
            whether the provider references below look like real charges.
          </Alert>
        )}

        {webhooks.length === 0 ? (
          <Card>
            <EmptyState
              title="No provider has called this deployment yet"
              hint="Paystack calls /functions/v1/paystack-webhook when a charge succeeds. If a firm has taken a payment and nothing is here, the webhook URL in the Paystack dashboard is the first thing to check."
            />
          </Card>
        ) : (
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH>Received</TH>
                  <TH>Provider</TH>
                  <TH>Event</TH>
                  <TH>Outcome</TH>
                  <TH>Signature</TH>
                  <TH>Reference</TH>
                </TR>
              </THead>
              <TBody>
                {[...badWebhooks, ...goodWebhooks].map((w: WebhookEventRow) => (
                  <TR key={w.id}>
                    <TD className="whitespace-nowrap">{when(w.received_at)}</TD>
                    <TD>{w.provider}</TD>
                    <TD className="break-words">{w.event_type ?? "—"}</TD>
                    <TD>
                      <Badge className={OUTCOME_STYLE[w.outcome] ?? "bg-gray-100 text-gray-700"}>
                        {w.outcome}
                      </Badge>
                      {w.error && <span className="block break-words text-xs text-red-800">{w.error}</span>}
                    </TD>
                    <TD>{w.signature_ok ? "verified" : "not verified"}</TD>
                    <TD className="break-all font-mono text-xs">{w.provider_ref ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}

        <Card>
          <CardHeader title="What each outcome means" />
          <CardBody>
            <dl className="space-y-2">
              {Object.entries(OUTCOME_MEANING).map(([outcome, meaning]) => (
                <div key={outcome} className="sm:flex sm:gap-3">
                  <dt className="text-sm font-medium text-gray-900 sm:w-28 sm:shrink-0">{outcome}</dt>
                  <dd className="text-sm text-gray-700">{meaning}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        {webhooks.length === WEBHOOK_LIMIT && (
          <p className="text-xs text-gray-500">
            Showing the {WEBHOOK_LIMIT} most recent calls. Older ones are not on this page.
          </p>
        )}
      </section>

      <p className="text-sm text-gray-600">
        The reference data behind non-sitting days is on{" "}
        <Link href="/admin/reference" className="font-medium text-brand underline">
          the reference screen
        </Link>
        .
      </p>
    </div>
  );
}
