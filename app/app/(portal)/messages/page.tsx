import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, EmptyState } from "@/components/ui/card";

export const metadata = { title: "Messages" };

export default async function MessagesPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">Messages</h1>
      <Card>
        <EmptyState
          title="No messages"
          hint="Secure messages with your firm live here, linked to your matters (slice 3)."
        />
      </Card>
    </div>
  );
}
