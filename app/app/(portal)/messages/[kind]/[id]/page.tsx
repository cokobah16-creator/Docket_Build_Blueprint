// A consultation's message thread: a pushed screen back to Messages. The
// sub-header carries the reference in mono and the way through to the
// appointment itself; the card carries nothing but the thread, because the
// bubbles are already the screen.

import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { clientTimezone } from "@/lib/portal-data";
import {
  AppCard,
  AppCardHeader,
  AppLink,
  Footnote,
  PushedScreen,
  SubHeader,
  SubHeaderRef,
} from "@/components/app";
import { MessagesThread } from "@/components/portal/messages-thread";
import type { MessageRow } from "@/lib/db/types";

export const metadata = { title: "Conversation" };

export default async function ThreadPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind === "matter") redirect(`/app/matters/${id}?tab=messages`);
  if (kind !== "appointment") notFound();
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const { data: apptRow } = await supabase.from("appointments").select("id, firm_id, reference, lawyer_id, starts_at").eq("id", id).maybeSingle();
  const appt = apptRow as { id: string; firm_id: string; reference: string; lawyer_id: string | null; starts_at: string } | null;
  if (!appt) notFound();
  const [firm, tz, { data: msgs }, { data: lawyer }] = await Promise.all([
    firmById(appt.firm_id),
    clientTimezone(supabase, user.id),
    supabase.from("messages").select("id, firm_id, matter_id, appointment_id, sender_id, body, attachments, read_at, created_at").eq("appointment_id", appt.id).order("created_at", { ascending: true }).limit(200),
    appt.lawyer_id ? supabase.from("lawyer_public").select("id, full_name, title").eq("id", appt.lawyer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const law = lawyer as { id: string; full_name: string | null; title: string | null } | null;
  const firmName = firm?.name ?? "Your firm";
  const senderNames = law ? { [law.id]: law.full_name ?? law.title ?? firm?.name ?? "Your lawyer" } : {};
  // Who the thread is with: the lawyer when the consultation has one, the firm
  // otherwise. Never both, and never a name that is not on the record.
  const counterparty = law?.full_name ?? law?.title ?? firmName;
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(appt.starts_at));

  return (
    <PushedScreen
      header={
        <SubHeader backHref="/app/messages" backLabel="Back to messages">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2.5">
            <SubHeaderRef>{appt.reference}</SubHeaderRef>
            <AppLink
              href={`/app/appointments/${appt.id}`}
              className="inline-flex min-h-[44px] flex-none items-center"
            >
              Details
            </AppLink>
          </div>
        </SubHeader>
      }
    >
      <h1 className="sr-only">Messages about consultation {appt.reference}</h1>

      <AppCard>
        <AppCardHeader title={counterparty} />
        <MessagesThread
          firmId={appt.firm_id}
          matterId={null}
          appointmentId={appt.id}
          userId={user.id}
          initial={(msgs ?? []) as MessageRow[]}
          timezone={tz}
          senderNames={senderNames}
          firmName={firmName}
        />
      </AppCard>

      <Footnote>
        This thread is about your consultation on {when} ({tz}).
      </Footnote>
    </PushedScreen>
  );
}
