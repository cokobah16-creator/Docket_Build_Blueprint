// One import, reconciled: every row and what became of it, the matters it filed, and the
// invitations it created — offered here until each client accepts, never in the download,
// because a token is a key.
//
// Rules enforced here: reads run as the signed-in admin under RLS (a lawyer who is not an admin
// sees nothing here); the invitation links are read from invites, which the wall governs; the
// results file a person downloads carries outcomes and references, never tokens.

import Link from "next/link";
import { notFound } from "next/navigation";
import { firmStaff, requestedFirmId, staffContext, staffLabel } from "@/lib/firm-data";
import { formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { ImportBatchRow, ImportRowRecord } from "@/lib/db/types";
import { CopyButton } from "../../../matters/[id]/matter-tabs";
import { ContinueImport, DiscardImport, ResultsDownload } from "./results-actions";

export const metadata = { title: "Import results" };

export default async function ImportResultPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ firm?: string }> }) {
  const { id } = await params;
  const { firm: firmParam } = await searchParams;
  let ctx = await staffContext(await requestedFirmId({ firm: firmParam }));
  if (!ctx) return <Alert kind="warning" title="Not configured">Supabase environment variables are not set, or this account is not a member of a firm.</Alert>;

  const { data: batchRow } = await ctx.supabase.from("import_batches").select("id, firm_id, kind, source_name, row_count, created_by, created_at, processed_at").eq("id", id).maybeSingle();
  const batch = (batchRow ?? null) as ImportBatchRow | null;
  if (!batch) notFound();
  // A member of two firms may arrive here from the other firm's context: the page wears the
  // batch's firm, never the remembered one.
  if (batch.firm_id !== ctx.firmId) {
    const owning = await staffContext(batch.firm_id);
    if (!owning || owning.firmId !== batch.firm_id) notFound();
    ctx = owning;
  }
  const { supabase, timezone } = ctx;

  const [{ data: rowRows }, staff] = await Promise.all([
    supabase.from("import_rows").select("id, batch_id, firm_id, row_no, raw, skip, outcome, matter_id, invite_id, note, processed_at").eq("batch_id", batch.id).order("row_no", { ascending: true }).limit(5000),
    firmStaff(supabase, batch.firm_id),
  ]);
  const rows = (rowRows ?? []) as ImportRowRecord[];
  const matterIds = rows.map((r) => r.matter_id).filter((x): x is string => Boolean(x));
  const inviteIds = rows.map((r) => r.invite_id).filter((x): x is string => Boolean(x));
  const [{ data: matterRows }, { data: inviteRows }] = await Promise.all([
    matterIds.length ? supabase.from("matters").select("id, reference, title").in("id", matterIds) : Promise.resolve({ data: [] as Array<{ id: string; reference: string; title: string }> }),
    inviteIds.length ? supabase.from("invites").select("id, matter_id, phone, email, token, expires_at, accepted_by").in("id", inviteIds) : Promise.resolve({ data: [] as Array<{ id: string; matter_id: string | null; phone: string | null; email: string | null; token: string; expires_at: string; accepted_by: string | null }> }),
  ]);
  const matters = new Map(((matterRows ?? []) as Array<{ id: string; reference: string; title: string }>).map((m) => [m.id, m]));
  const invites = new Map(((inviteRows ?? []) as Array<{ id: string; matter_id: string | null; phone: string | null; email: string | null; token: string; expires_at: string; accepted_by: string | null }>).map((i) => [i.id, i]));
  const names = Object.fromEntries(staff.map((m) => [m.user_id, staffLabel(m)]));

  const created = rows.filter((r) => r.outcome === "created").length;
  const skipped = rows.filter((r) => r.outcome === "skipped").length;
  const failed = rows.filter((r) => r.outcome === "failed").length;
  const pending = rows.filter((r) => !r.processed_at).length;
  const begun = rows.some((r) => r.processed_at);
  // Staged in chunks from the browser; a batch short of its rows has filed nothing and
  // process_import_batch() refuses it — so it is said, not continued.
  const unstaged = Math.max(0, batch.row_count - rows.length);
  const toSend = rows.filter((r) => r.invite_id && !invites.get(r.invite_id)?.accepted_by).length;
  const accepted = rows.filter((r) => r.invite_id && invites.get(r.invite_id)?.accepted_by).length;
  const notInvited = rows.filter((r) => r.note?.startsWith("client not invited")).length;

  const results = rows.map((r) => [r.row_no, r.raw.title ?? "", r.raw.legacy_reference ?? "", r.outcome ?? "pending", r.matter_id ? matters.get(r.matter_id)?.reference ?? "" : "", r.note ?? ""]);

  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/firm/admin/import" className="text-brand underline">← Imports</Link></p>
      <header>
        <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">{batch.source_name ?? "An import"}</h1>
        <p className="text-sm text-gray-600">
          Staged {formatWhen(batch.created_at, timezone)}{batch.created_by ? ` by ${names[batch.created_by] ?? "a colleague"}` : ""}
          {batch.processed_at ? ` · processed ${formatWhen(batch.processed_at, timezone)}` : " · not finished"}
        </p>
      </header>

      {unstaged > 0 && !begun && (
        <Alert kind="warning" title={`${rows.length} of ${batch.row_count} rows arrived; the rest never did`}>
          The file was being staged when the connection dropped, and nothing has been filed from this batch. Open the file again in the
          import wizard to bring it in, and discard this batch.
          <div className="mt-2"><DiscardImport batchId={batch.id} /></div>
        </Alert>
      )}
      {unstaged === 0 && pending > 0 && (
        <Alert kind="warning" title={`${pending} ${pending === 1 ? "row is" : "rows are"} still waiting`}>
          The filing stopped before the end. Continue it here; rows already filed are not filed again.
          <div className="mt-2"><ContinueImport batchId={batch.id} /></div>
        </Alert>
      )}

      <Card>
        <CardHeader title="Reconciliation" action={<ResultsDownload name={`${(batch.source_name ?? "import").replace(/\.csv$/i, "")}-results.csv`} rows={results} />} />
        <CardBody>
          <dl className="grid gap-3 sm:grid-cols-3">
            {([
              ["Rows in the file", batch.row_count],
              ["Matters filed", created],
              ["Left out", skipped],
              ["Refused", failed],
              ["Invitations to send", toSend],
              ["Accepted", accepted],
              ["Clients not invited", notInvited],
            ] as Array<[string, number]>).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-gray-200 px-3 py-2">
                <dt className="text-xs uppercase tracking-wide text-gray-500">{k}</dt>
                <dd className="text-lg font-semibold text-gray-900">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-gray-600">Every number is a count of rows in this import as the database recorded them. Nothing was merged with what was already on the books.</p>
        </CardBody>
      </Card>

      {toSend + accepted > 0 && (
        <Card>
          <CardHeader title="Send each client their link" />
          <CardBody className="space-y-3">
            <p className="text-sm text-gray-600">
              Each link signs the client in — with the account they have, or one they make — and puts them on their matter; it lasts thirty days and is offered here until they accept. Anyone holding a link can join the matter, so send it only to the person it is for. Docket does not send it.
            </p>
            <ul className="divide-y divide-gray-100">
              {rows.filter((r) => r.invite_id && invites.get(r.invite_id)).map((r) => {
                const inv = invites.get(r.invite_id!)!;
                const m = r.matter_id ? matters.get(r.matter_id) : null;
                const digits = inv.phone && /^\+\d{8,15}$/.test(inv.phone) ? inv.phone.replace(/\D/g, "") : null;
                const text = `${ctx.firmName}: your matter ${m?.reference ?? ""} — ${m?.title ?? r.raw.title ?? ""} — is now on Docket. Open this link to follow it and send us documents: ${"{link}"}`;
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{r.raw.client_name ?? inv.phone ?? inv.email ?? "Client"}<span className="ml-2 text-xs font-normal text-gray-500">{[inv.phone, inv.email].filter(Boolean).join(" · ")}</span></p>
                      <p className="text-xs text-gray-600">{m ? `${m.reference} · ${m.title}` : r.raw.title}{inv.accepted_by ? " · accepted" : ""}</p>
                    </div>
                    {!inv.accepted_by && (
                      <div className="flex flex-wrap items-center gap-2">
                        <CopyButton path={`/app/join?token=${encodeURIComponent(inv.token)}`} label="Copy the link" />
                        {digits && (
                          <a href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-3 text-sm font-medium text-brand hover:bg-black/5">WhatsApp</a>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-gray-500">The WhatsApp message says “{"{link}"}” where the copied link goes; paste it in before sending.</p>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Row by row" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
              <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">On Docket as</th><th className="px-3 py-2">Note</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = r.matter_id ? matters.get(r.matter_id) : null;
                return (
                  <tr key={r.id} className={r.outcome === "failed" ? "bg-red-50" : r.outcome === "skipped" ? "text-gray-500" : ""}>
                    <td className="px-3 py-2 font-mono text-xs">{r.row_no}</td>
                    <td className="px-3 py-2">{r.raw.title ?? ""}{r.raw.legacy_reference ? <span className="ml-1 text-xs text-gray-500">({r.raw.legacy_reference})</span> : null}</td>
                    <td className="px-3 py-2 text-xs">{r.outcome ?? "waiting"}</td>
                    <td className="px-3 py-2 text-xs">{m ? <Link href={`/firm/matters/${m.id}`} className="text-brand underline">{m.reference}</Link> : ""}</td>
                    <td className="px-3 py-2 text-xs">{r.note ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-xs text-gray-500">Up to 5,000 rows are shown.</p>
      </Card>
    </div>
  );
}
