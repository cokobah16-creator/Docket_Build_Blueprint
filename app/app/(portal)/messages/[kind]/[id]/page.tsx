import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { selectedFirm } from "@/lib/portal-firm";
import { clientThreads } from "@/lib/portal-threads";
import { Card, CardHeader } from "@/components/ui/card";
import { MessagesThread } from "@/components/portal/messages-thread";
import { ThreadList } from "@/components/portal/thread-list";
import { Screen, ScreenHeader } from "@/components/portal/screen";
import { ListDetail } from "@/components/shell/layout";
import type { MessageRow } from "@/lib/db/types";

export const metadata = { title: "Conversation" };

export default async function ThreadPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind === "matter") redirect(`/app/matters/${id}?tab=messages`);
  if (kind !== "appointment") notFound();
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const { data: apptRow } = await supabase.from("appointments").select("id, firm_id, reference, lawyer_id, starts_at").eq("id", id).maybeSingle();
  const appt = apptRow as { id: string; firm_id: string; reference: string; lawyer_id: string | null; starts_at: string } | null;
  if (!appt) notFound();
  const [firm, { data: msgs }, { data: lawyer }, selected] = await Promise.all([
    firmById(appt.firm_id),
    supabase.from("messages").select("id, firm_id, matter_id, appointment_id, sender_id, body, attachments, read_at, created_at").eq("appointment_id", appt.id).order("created_at", { ascending: true }).limit(200),
    appt.lawyer_id ? supabase.from("lawyer_public").select("id, full_name, title").eq("id", appt.lawyer_id).maybeSingle() : Promise.resolve({ data: null }),
    selectedFirm(supabase),
  ]);
  // The list beside the conversation, on the one screen wide enough to hold
  // both. It is the same loader the index route uses, so the two agree.
  const { threads, timezone: tz } = await clientThreads(supabase, user.id, selected?.id);
  const law = lawyer as { id: string; full_name: string | null; title: string | null } | null;
  const senderNames = law ? { [law.id]: law.full_name ?? law.title ?? firm?.name ?? "Your lawyer" } : {};

  return (
    <>
      {/* The back chevron is how a phone leaves a full-screen conversation. It
          is hidden from 1024px, where the list it would go back to is already
          on screen beside this one. */}
      <div className="lg:hidden">
        <ScreenHeader back="/app/messages" backLabel="Back to messages" title={`Consultation ${appt.reference}`}>
          <Link href={`/app/appointments/${appt.id}`} className="shrink-0 text-13 font-medium text-brand underline underline-offset-2">Details</Link>
        </ScreenHeader>
      </div>
      <Screen>
        <ListDetail
          list={<ThreadList threads={threads} timezone={tz} userId={user.id} activeKey={`a-${appt.id}`} />}
          detail={
            <Card>
              {/* On a phone the sticky bar above already names this thread. */}
              <div className="hidden lg:block">
                <CardHeader
                  title={`Consultation ${appt.reference}`}
                  action={
                    <Link href={`/app/appointments/${appt.id}`} className="text-13 font-medium text-brand underline underline-offset-2">
                      Details
                    </Link>
                  }
                />
              </div>
              <MessagesThread firmId={appt.firm_id} matterId={null} appointmentId={appt.id} userId={user.id} initial={(msgs ?? []) as MessageRow[]} timezone={tz} senderNames={senderNames} firmName={firm?.name ?? "Your firm"} />
            </Card>
          }
        />
      </Screen>
    </>
  );
}
