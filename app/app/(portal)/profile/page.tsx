import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { signOut } from "../actions";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const { data } = await supabase
    .from("profiles")
    .select("full_name, phone, email, timezone, preferred_channel")
    .eq("id", user.id)
    .maybeSingle();
  const profile = (data ?? null) as {
    full_name: string | null;
    phone: string | null;
    email: string | null;
    timezone: string;
    preferred_channel: string;
  } | null;

  const rows: Array<[string, string]> = [
    ["Name", profile?.full_name ?? "—"],
    ["Phone", profile?.phone ?? user.phone ?? "—"],
    ["Email", profile?.email ?? user.email ?? "—"],
    ["Timezone", profile?.timezone ?? "Africa/Lagos"],
    ["Preferred channel", profile?.preferred_channel ?? "sms"],
  ];

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">Profile</h1>
      <Card>
        <CardHeader title="Your details" />
        <CardBody>
          <dl className="space-y-3">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-gray-500">{label}</dt>
                <dd className="text-sm font-medium text-gray-900">{value}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
      <form action={signOut}>
        <Button type="submit" variant="ghost" className="w-full">
          Sign out
        </Button>
      </form>
    </div>
  );
}
