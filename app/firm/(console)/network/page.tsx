// Docket Network: the firm's place among other firms. Connected firms, invitations out and in,
// joint matters, approaches, alliances, and the counts that say what needs an answer.
//
// Every read runs as the signed-in member and the database decides what comes back:
// connected_firms shows the other firm's contact details only where that firm chose to share
// them; network_incoming shows an invitation only to the firm whose member verified it;
// joint_matters is read under the matter wall; network_invitations never shows a hash. The
// writes are in src/lib/actions/network.ts and every rule is the database's.

import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { buttonClasses } from "@/components/ui/button";
import type {
  ConnectedFirmRow, IntroductionRow, JointMatterRow, NetworkIncomingRow, NetworkInvitationRow, NetworkOverview, CollaborationInboxRow,
} from "@/lib/db/types";
import { todayIn } from "@/lib/days";
import { NetworkPanels } from "./network-panels";

export const metadata = { title: "Docket Network" };

export default async function NetworkPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) return <WorkspaceUnavailable audience="staff" />;
  const { supabase, firmId, firmName, timezone } = ctx;

  const [
    { data: overviewData, error: overviewError },
    { data: connectedRows },
    { data: outgoingRows },
    { data: incomingRows },
    { data: jointRows },
    { data: workRows },
    { data: approachRows },
    { data: firmRow },
  ] = await Promise.all([
    supabase.rpc("network_overview", { p_firm: firmId }),
    supabase.from("connected_firms").select("*").eq("my_firm_id", firmId).order("connected_at", { ascending: false }).limit(200),
    supabase.from("network_invitations").select("id, from_firm_id, to_email, from_firm_name, from_country, from_practice_areas, from_representative, reason, status, code_expires_at, attempts, max_attempts, resends, max_resends, last_sent_at, verified_at, verified_by, accepted_at, accepted_by, accepted_firm_id, connection_id, declined_at, decline_reason, revoked_at, created_by, created_at")
      .eq("from_firm_id", firmId).order("created_at", { ascending: false }).limit(100),
    supabase.from("network_incoming").select("*").eq("my_firm_id", firmId).order("verified_at", { ascending: false }).limit(50),
    supabase.from("joint_matters").select("*").eq("firm_id", firmId).order("reference").limit(200),
    supabase.from("collaboration_inbox").select("*").eq("with_firm_id", firmId).is("ended_at", null).is("declined_at", null).order("proposed_at", { ascending: false }).limit(100),
    supabase.from("network_introductions").select("*").or(`from_firm_id.eq.${firmId},to_firm_id.eq.${firmId}`).order("created_at", { ascending: false }).limit(100),
    supabase.from("firms").select("status, verified_at").eq("id", firmId).maybeSingle(),
  ]);

  const overview = (overviewData && typeof overviewData === "object" ? overviewData : null) as NetworkOverview | null;
  const connected = (connectedRows ?? []) as ConnectedFirmRow[];
  const outgoing = (outgoingRows ?? []) as NetworkInvitationRow[];
  const incoming = (incomingRows ?? []) as NetworkIncomingRow[];
  const joint = (jointRows ?? []) as JointMatterRow[];
  const work = (workRows ?? []) as CollaborationInboxRow[];
  const approaches = (approachRows ?? []) as IntroductionRow[];
  const firm = (firmRow ?? null) as { status: string; verified_at: string | null } | null;
  const verified = firm?.status === "active" && Boolean(firm?.verified_at);
  const today = todayIn(timezone);

  // Names for the firms on the other side of an approach, from what this firm may already read.
  const firmNames = new Map<string, string>();
  for (const c of connected) firmNames.set(c.other_firm_id, c.other_firm_name);
  const unknownIds = Array.from(new Set(approaches.flatMap((a) => [a.from_firm_id, a.to_firm_id]).filter((id) => id !== firmId && !firmNames.has(id))));
  if (unknownIds.length) {
    const { data: dirRows } = await supabase.from("network_directory").select("firm_id, name").in("firm_id", unknownIds);
    for (const d of (dirRows ?? []) as Array<{ firm_id: string; name: string }>) firmNames.set(d.firm_id, d.name);
  }

  const counts: Array<{ label: string; value: number; href: string; hint: string; tone: "quiet" | "waiting" }> = overview
    ? [
        { label: "Connected firms", value: overview.connected, href: "#connected", hint: overview.in_review > 0 ? `${overview.in_review} in review by Docket` : "Verified both ways", tone: "quiet" },
        { label: "Invitations to answer", value: overview.incoming_to_answer, href: "#incoming", hint: "Codes entered by your firm", tone: overview.incoming_to_answer > 0 ? "waiting" : "quiet" },
        { label: "Invitations out", value: overview.outgoing_open, href: "#outgoing", hint: "Waiting for a code or an answer", tone: "quiet" },
        { label: "Joint matters", value: overview.joint_matters, href: "#joint", hint: "Your files with another firm on them", tone: "quiet" },
        { label: "Work from other firms", value: overview.work_from_others, href: "/firm/collaborations", hint: overview.collaborations_to_answer > 0 ? `${overview.collaborations_to_answer} waiting on your answer` : "Live arrangements on their files", tone: overview.collaborations_to_answer > 0 ? "waiting" : "quiet" },
        { label: "Tasks set to your firm", value: overview.open_tasks_for_us, href: "/firm/collaborations", hint: "Open, on live arrangements", tone: overview.open_tasks_for_us > 0 ? "waiting" : "quiet" },
        { label: "Approaches to answer", value: overview.approaches_to_answer, href: "#approaches", hint: "Introductions and referral requests", tone: overview.approaches_to_answer > 0 ? "waiting" : "quiet" },
        { label: "Alliances", value: overview.alliances_active, href: "/firm/network/alliances", hint: overview.alliances_to_answer > 0 ? `${overview.alliances_to_answer} proposed to you` : "Standing relationships", tone: overview.alliances_to_answer > 0 ? "waiting" : "quiet" },
      ]
    : [];

  return (
    <div className="flex flex-col gap-3.5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-21 font-semibold tracking-[-0.01em] text-ink-strong md:text-26">Docket Network</h1>
          <p className="mt-0.5 text-13 text-ink-muted">{firmName} · firms you have verified, and the work between you</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/firm/network/discover" className={buttonClasses("ghost", "sm")}>Discover firms</Link>
          <Link href="/firm/network/profile" className={buttonClasses("ghost", "sm")}>Your network profile</Link>
          <Link href="/firm/network/alliances" className={buttonClasses("ghost", "sm")}>Alliances</Link>
        </div>
      </header>

      {overviewError && (
        <Alert kind="error" title="The counts did not load">
          The lists below are real; the counts are not shown because nothing could be counted. Zeros here would read as &ldquo;nothing to do&rdquo;.
        </Alert>
      )}

      {!verified && (
        <Alert kind="info" title="Your firm is not yet verified by Docket">
          A firm invites, connects with and is found by other firms only once Docket has verified it. The console works meanwhile; what waits is the network.
        </Alert>
      )}

      {overview && !overview.profile_published && verified && (
        <Alert kind="warning" title="Your firm has no network profile yet">
          Other firms find you through it and connected firms read it. <Link href="/firm/network/profile" className="font-medium underline">Write the profile</Link>, and choose what it shows.
        </Alert>
      )}

      {overview && (
        <section aria-labelledby="network-counts" className="overflow-hidden rounded-card border border-hairline bg-raised">
          <h2 id="network-counts" className="flex min-h-11 items-center border-b border-hairline bg-sunken px-3 text-13 font-semibold text-ink-strong">
            At a glance
          </h2>
          <ul className="grid grid-cols-2 divide-y divide-hairline sm:grid-cols-4">
            {counts.map((c) => (
              <li key={c.label}>
                <Link href={c.href} className="flex min-h-11 flex-col justify-center gap-0.5 px-3 py-2 hover:bg-hover">
                  <span className={`text-17 font-semibold tabular-nums ${c.tone === "waiting" && c.value > 0 ? "text-waiting-ink" : "text-ink-strong"}`}>{c.value}</span>
                  <span className="text-13 font-medium text-ink">{c.label}</span>
                  <span className="text-11 text-ink-muted">{c.hint}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NetworkPanels
        firmId={firmId}
        firmName={firmName}
        verified={verified}
        canInvite={verified && ctx.can("invite_firms")}
        connected={connected}
        outgoing={outgoing}
        incoming={incoming}
        joint={joint}
        work={work}
        approaches={approaches}
        firmNames={Object.fromEntries(firmNames)}
        timezone={timezone}
        today={today}
      />

      <Card>
        <CardHeader title="What a connection is, and is not" />
        <CardBody className="space-y-2 text-15 text-ink-muted">
          <p>
            <span className="font-medium text-ink">A connection is a verified relationship.</span> You invite a firm&rsquo;s official email; whoever
            opens the link enters a single use code that proves the email reached them; an owner or administrator of that firm accepts or declines.
            Where the invited address matches nothing the firm has told Docket about itself, Docket checks before the connection is active.
          </p>
          <p>
            <span className="font-medium text-ink">A connection shares nothing by itself.</span> Connected firms read each other&rsquo;s network profile and
            can propose work. No matter, document, client or invoice is visible until the firm that owns a matter brings the other onto it and hands over one
            named document version at a time. Ending a connection ends every live arrangement between the firms at once; nothing already downloaded is recalled.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
