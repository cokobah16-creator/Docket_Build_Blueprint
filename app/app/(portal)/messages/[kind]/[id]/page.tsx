import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { clientTimezone } from "@/lib/portal-data";
import { Card, CardHeader } from "@/components/ui/card";
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
  const senderNames = law ? { [law.id]: law.full_name ?? law.title ?? firm?.name ?? "Your lawyer" } : {};
  return (
    <div className="space-y-5">
      <p className="text-sm"><Link href="/app/messages" className="text-brand underline">← Messages</Link></p>
      <Card>
        <CardHeader title={`Consultation ${appt.reference}`} action={<Link href={`/app/appointments/${appt.id}`} className="text-sm text-brand underline">Details</Link>} />
        <MessagesThread firmId={appt.firm_id} matterId={null} appointmentId={appt.id} userId={user.id} initial={(msgs ?? []) as MessageRow[]} timezone={tz} senderNames={senderNames} firmName={firm?.name ?? "Your firm"} />
      </Card>
    </div>
  );
}
