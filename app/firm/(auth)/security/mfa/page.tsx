import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { MfaSetup } from "./mfa-setup";

// RENDERED PER REQUEST, ALWAYS.
//
// This page decides what to show from the caller's own session, so a single build-time render
// shared by everyone is always wrong for somebody. Next.js prerendered it anyway — a session
// read that resolves to "nobody" during the build looks, from the outside, exactly like a page
// with no request-time input — and a prerendered page is also a page whose inline bootstrap
// scripts carry no nonce, which the content security policy in src/lib/csp.ts then refuses.
// Two separate faults with one cause; force-dynamic settles both.
export const dynamic = "force-dynamic";

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
