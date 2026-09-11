// Firm administration: the gate and the navigation for everything a firm changes about ITSELF —
// its settings, its catalogue, its intake questions, its people and its audit trail.
//
// This route group sits inside (console), so the session, the aal2 check and firm membership
// have already been proved by the console layout above. What is added here is the owner/admin
// gate, because the rest of the console is open to every lawyer and staff member and this part
// is not.
//
// The gate here is on the ACCOUNT, not on one firm, and deliberately so: a layout in Next 15
// receives no searchParams, so it cannot see the `?firm=` that a member of more than one firm
// uses to switch. Gating the layout on the default firm would lock such a person out of a firm
// they really do administer, with a link that could never work — a dead end. So the layout asks
// "is this account an owner or an administrator anywhere?", and each screen below re-asks the
// question for the firm it actually resolved. The database asks it a third time, on every write,
// through admin_w(), and that answer is the one that counts.

import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import { AdminNav } from "./admin-nav";

export default async function FirmAdminLayout({ children }: { children: ReactNode }) {
  const ctx = await staffContext(await requestedFirmId());

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm. See{" "}
        <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const administersSomething =
    ctx.isAdmin || ctx.memberships.some((m) => m.role === "owner" || m.role === "admin");

  if (!administersSomething) {
    return (
      <Alert kind="info" title="Only the firm's owner or an administrator can change these">
        <p>
          Settings, services, intake questions, people and the audit trail belong to the people who
          run the firm. Your account is signed in as {ctx.role} at {ctx.firmName}, so this part of
          the console is not yours to change — the database would refuse the writes even if the
          forms were here.
        </p>
        <p className="mt-2">
          If you need something changed, ask an owner or an administrator of the firm.{" "}
          <Link href="/firm" className="font-medium underline">
            Back to Today
          </Link>
          .
        </p>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-xl font-semibold text-gray-900">Firm administration</h1>
        {/* No firm name here. A layout cannot read ?firm=, so the name it would resolve is the
            account's default — which for a member of two firms is the wrong one over a form that
            writes the other. Each screen below names the firm it actually resolved. */}
        <p className="mt-1 text-sm text-gray-600">
          What the firm is, what it sells, who works here and what it has done.
        </p>
      </div>
      {/* useSearchParams() suspends, and a component that reads it must sit under a boundary or
          the production build refuses to prerender the tree around it. */}
      <Suspense fallback={<div className="h-[44px]" />}>
        <AdminNav />
      </Suspense>
      {children}
    </div>
  );
}
