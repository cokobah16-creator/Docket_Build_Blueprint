// Platform admin. Ships in slice 5 (create firm via a service-role server
// action guarded by a platform-admin allowlist, domain mapping, health).
// Until then this route is an honest placeholder — no fake controls.

import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Platform admin" };

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-heading text-2xl font-semibold text-brand">Platform admin</h1>
      <div className="mt-4">
        <Alert kind="info" title="Arrives in slice 5">
          Firm creation, custom-domain mapping and platform health land here,
          guarded by a platform-admin allowlist and served by service-role
          server actions.
        </Alert>
      </div>
    </main>
  );
}
