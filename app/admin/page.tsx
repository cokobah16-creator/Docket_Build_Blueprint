// Platform admin: the Docket operator's view of its tenants. Gated by the
// platform_admins table (never an env allowlist) and by an MFA-verified
// session; the database exposes firm lifecycle rows to platform admins and
// no matter content whatsoever.

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { FirmAdminRow } from "@/lib/db/types";
import { AdminCreateFirm } from "./create-firm";
import { setFirmStatus } from "./actions";

export const metadata = { title: "Platform admin" };

export default async function AdminPage() {
  const supabase = await supabaseServer();
  if (!supabase) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="warning" title="Not configured">
          Supabase environment variables are not set. See <code>.env.example</code>.
        </Alert>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/firm/login");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") redirect("/firm/security/mfa");

  const { data: adminRow } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!adminRow) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="error" title="Platform admins only">
          This account is not a Docket platform administrator. Platform admins are
          added by the operator with the service role; firm staff use the console
          at <a className="underline" href="/firm">/firm</a>.
        </Alert>
      </main>
    );
  }

  const { data: firmRows } = await supabase
    .from("firms")
    .select("id, slug, name, legal_name, plan, status, state_code, custom_domain, created_at")
    .order("created_at", { ascending: false });
  const firms = (firmRows ?? []) as FirmAdminRow[];

  const { data: memberRows } = await supabase.from("firm_members").select("firm_id, role");
  const members = (memberRows ?? []) as Array<{ firm_id: string; role: string }>;
  const memberCount = new Map<string, number>();
  for (const m of members) memberCount.set(m.firm_id, (memberCount.get(m.firm_id) ?? 0) + 1);

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-accent">Docket</p>
          <h1 className="font-heading text-2xl font-semibold text-brand">Platform admin</h1>
        </div>
        <p className="text-sm text-gray-500">{firms.length} firm{firms.length === 1 ? "" : "s"} · no access to matter content</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader title="Firms" />
          {firms.length === 0 ? (
            <EmptyState title="No firms yet" hint="Create the first firm on the right, or let a firm register itself at /firm/start." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Firm</TH>
                    <TH>Slug / domain</TH>
                    <TH>State</TH>
                    <TH>Plan</TH>
                    <TH>Members</TH>
                    <TH>Status</TH>
                    <TH>Created</TH>
                    <TH>
                      <span className="sr-only">Actions</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {firms.map((f) => (
                    <TR key={f.id}>
                      <TD>
                        <p className="font-medium text-gray-900">{f.name}</p>
                        {f.legal_name && <p className="text-xs text-gray-500">{f.legal_name}</p>}
                      </TD>
                      <TD>
                        <a className="text-brand underline" href={`/?firm=${f.slug}`}>{f.slug}</a>
                        {f.custom_domain && <p className="text-xs text-gray-500">{f.custom_domain}</p>}
                      </TD>
                      <TD>{f.state_code ?? "—"}</TD>
                      <TD>{f.plan}</TD>
                      <TD>{memberCount.get(f.id) ?? 0}</TD>
                      <TD>
                        <Badge>{f.status}</Badge>
                      </TD>
                      <TD>{new Date(f.created_at).toLocaleDateString("en-GB")}</TD>
                      <TD>
                        <form action={setFirmStatus} className="flex items-center gap-2">
                          <input type="hidden" name="firmId" value={f.id} />
                          <input type="hidden" name="status" value={f.status === "suspended" ? "active" : "suspended"} />
                          <button
                            type="submit"
                            className="text-xs font-medium text-brand underline"
                          >
                            {f.status === "suspended" ? "Reactivate" : "Suspend"}
                          </button>
                        </form>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Create a firm for an owner" />
          <CardBody>
            <AdminCreateFirm />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Health" />
        <EmptyState
          title="Queue and webhook health arrive with slice 5"
          hint="Queued/failed notifications, failed webhooks and custom-domain mapping through the Vercel Domains API."
        />
      </Card>
    </main>
  );
}
