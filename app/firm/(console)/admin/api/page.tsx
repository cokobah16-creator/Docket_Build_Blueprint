// /firm/admin/api — the keys another system uses, and where events are pushed.
//
// Owners and administrators only, which is the database's rule and not this screen's:
// issue_api_credential(), revoke_api_credential(), set_api_endpoint() and remove_api_endpoint() all
// ask admin_w(). A lawyer who types the address reads the same refusal a lawyer would get from the
// API itself.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { todayIn } from "@/lib/days";
import { PartnerApiPanel } from "./partner-api-panel";
import type { ApiCredentialRow, ApiEndpointSummary } from "@/lib/db/types";

export const metadata = { title: "Partner API" };

export default async function PartnerApiPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
    );
  }
  const { supabase, firmId, timezone: tz, isAdmin } = ctx;

  if (!isAdmin) {
    return (
      <Alert kind="info" title="An owner's or administrator's screen">
        A partner key reads across the whole firm, so issuing one is an owner&rsquo;s or
        administrator&rsquo;s act with a second factor. The database refuses it either way; this is
        only the polite version. <Link href="/firm/admin" className="underline">Back to Administration</Link>.
      </Alert>
    );
  }

  const [{ data: credRows, error }, { data: endpointRows }] = await Promise.all([
    supabase.from("api_credentials").select("*").eq("firm_id", firmId).order("created_at", { ascending: false }).limit(100),
    supabase.rpc("api_endpoint_list", { p_firm: firmId }),
  ]);

  return (
    <div className="flex flex-col gap-3.5">
      <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Partner API</h1>

      {error && (
        <Alert kind="error" title="The keys did not load">
          Nothing is shown because nothing could be read — not because there are none. Try again.
        </Alert>
      )}

      <Card>
        <CardBody className="text-[12.5px] leading-[1.55] text-[#57534E]">
          <p>
            A key lets another system — an accounting package, your own reporting — read this
            firm&rsquo;s matters, invoices, clients and event feed. It is <strong>read only</strong>:
            nothing another system does through it can change a thing here.
          </p>
          <p className="mt-2">
            A key reads across the <em>whole firm</em>, including matters restricted to a team. That
            is the one place where a key is wider than a person, so it is said here rather than
            found later: if that is not what you want, do not issue one with Matters.
          </p>
          <p className="mt-2">
            The contract is written down in{" "}
            <Link href="https://github.com/cokobah16-creator/Docket_Build_Blueprint/blob/main/docs/PARTNER_API.md"
                  className="underline underline-offset-2">docs/PARTNER_API.md</Link> — give it to
            whoever is building against it. There is no sandbox yet, and that document says so.
          </p>
        </CardBody>
      </Card>

      <PartnerApiPanel
        firmId={firmId}
        credentials={(credRows ?? []) as ApiCredentialRow[]}
        endpoints={(endpointRows ?? []) as ApiEndpointSummary[]}
        today={todayIn(tz)}
      />
    </div>
  );
}
