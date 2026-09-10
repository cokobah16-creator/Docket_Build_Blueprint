// Platform landing. A request only lands here when no tenant was resolved
// (middleware rewrites tenant hosts onto /[firm]); on preview deployments
// pass ?firm=<slug> to view a tenant site.

import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";

export default function PlatformLanding() {
  const configured = isSupabaseConfigured();
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="font-heading text-4xl font-semibold text-brand">Docket</h1>
        <p className="mt-3 text-lg text-gray-600">
          The client experience platform for law firms — book, pay, meet your
          lawyer face to face, and track your matter from your phone.
        </p>
      </div>

      {configured ? (
        <Card>
          <CardBody className="space-y-3">
            <p className="text-sm text-gray-700">
              This host is not mapped to a firm. Tenant sites are served from
              their own domain or <code>{"{slug}"}.docket.app</code> subdomain.
            </p>
            <p className="text-sm text-gray-700">
              On a preview deployment, open a tenant with{" "}
              <Link className="font-medium text-brand underline" href="/?firm=attorneys-klinique">
                ?firm=attorneys-klinique
              </Link>
              .
            </p>
          </CardBody>
        </Card>
      ) : (
        <Alert kind="warning" title="Supabase is not configured yet">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (see{" "}
          <code>.env.example</code>) in the hosting environment, apply the
          migrations and seed from <code>supabase/</code>, and the tenant
          sites, client portal and staff console come alive.
        </Alert>
      )}

      <p className="text-sm text-gray-500">
        Slice 0 foundation: multi-tenant schema, RLS, booking engine, payments
        and adapters — see the repository README.
      </p>
    </main>
  );
}
