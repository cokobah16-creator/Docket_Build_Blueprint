import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, EmptyState } from "@/components/ui/card";

export const metadata = { title: "Matters" };

export default async function MattersPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">Matters</h1>
      <Card>
        <EmptyState
          title="No matters yet"
          hint="Matters your firm opens for you appear here — timeline, documents, messages and invoices in one place (slice 3)."
        />
      </Card>
    </div>
  );
}
