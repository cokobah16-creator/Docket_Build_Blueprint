import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientMatters, clientTimezone } from "@/lib/portal-data";
import { Card, CardBody, EmptyState } from "@/components/ui/card";

export const metadata = { title: "Matters" };

export default async function MattersPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");
  const [matters, tz] = await Promise.all([clientMatters(supabase), clientTimezone(supabase, user.id)]);
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz });

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-2xl font-semibold text-brand">Matters</h1>
      <Card>
        {matters.length === 0 ? (
          <EmptyState title="No matters yet" hint="When your firm opens a matter for you, it appears here with its timeline, documents, messages and invoices." />
        ) : (
          <CardBody className="divide-y divide-gray-100 p-0">
            {matters.map((m) => (
              <Link key={m.id} href={`/app/matters/${m.id}`} className="block px-5 py-4 hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{m.title}</p>
                    <p className="text-xs text-gray-500">{m.reference} · {m.firm_name}{m.lawyer_names.length ? ` · ${m.lawyer_names.join(", ")}` : ""}</p>
                  </div>
                  {m.status && (
                    <span className="shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium" style={m.status.colour ? { borderColor: m.status.colour, color: m.status.colour } : undefined}>
                      {m.status.label}
                    </span>
                  )}
                </div>
                {m.last_update && <p className="mt-2 truncate text-xs text-gray-600">Latest: {m.last_update.title} · {fmt.format(new Date(m.last_update.occurred_at))}</p>}
                {m.next_event_at && <p className="mt-1 text-xs text-gray-600">Next court date: {fmt.format(new Date(m.next_event_at))}{m.next_event_note ? ` · ${m.next_event_note}` : ""}</p>}
                {m.next_action && <p className="mt-1 text-xs font-medium text-brand">Next: {m.next_action}</p>}
              </Link>
            ))}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
