"use client";

// Client sign-in: phone OTP (primary for Nigerian clients) or email magic
// link. No passwords for clients; Supabase Auth issues the session and RLS
// does the rest.

import { useRouter } from "next/navigation";
import { SignInForms } from "@/components/auth/sign-in-forms";
import { Card, CardBody } from "@/components/ui/card";

export default function ClientLoginPage() {
  const router = useRouter();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="font-heading text-2xl font-semibold text-brand">Sign in</h1>
      <p className="mt-1 text-sm text-gray-600">Use the phone number or email your firm has for you.</p>
      <Card className="mt-4">
        <CardBody>
          <SignInForms redirectNext="/app" onSignedIn={() => router.replace("/app")} />
        </CardBody>
      </Card>
      <p className="mt-6 text-center text-sm text-gray-500">
        Staff? <a href="/firm/login" className="font-medium text-brand underline">Sign in to the console</a>
      </p>
    </main>
  );
}
