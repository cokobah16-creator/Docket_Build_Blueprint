import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { MfaSetup } from "./mfa-setup";

export const metadata = { title: "Two-factor authentication" };

export default async function MfaPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/firm/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/firm/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <MfaSetup />
    </main>
  );
}
