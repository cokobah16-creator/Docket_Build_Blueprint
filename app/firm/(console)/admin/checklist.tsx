"use client";

// The checklist: every line a fact firm_readiness() computed, in the order the booking engine
// checks them, each pointing at the screen that changes it. The only thing a person can write
// here is a skip — "we will not do this, and here is why" — which the database stores with who
// and when, and which never marks a fact done.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { resumeOnboardingStep, skipOnboardingStep } from "@/lib/actions/onboarding";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FirmReadiness, OnboardingStep } from "@/lib/db/types";

interface Step {
  key: OnboardingStep;
  label: string;
  done: boolean;
  /** Said when not done: what it costs the firm, and the fix. */
  why: string;
  href: string;
  action: string;
  /** May an admin choose to skip it? Only steps a firm can legitimately do without. */
  skippable: boolean;
}

export function steps(r: FirmReadiness): Step[] {
  return [
    { key: "policies", label: "Publish your terms and privacy notice", done: r.policies_published,
      why: "Every booking is refused until both are published. New clients accept them before they use their portal.",
      href: "/firm/admin/settings", action: "Publish the policies", skippable: false },
    { key: "operations", label: `Confirm the reference prefix (${r.reference_prefix}), VAT and timezone`, done: r.reference_issued,
      why: r.reference_issued ? "" : "The prefix locks at the first reference issued — check it before the first matter, and before an import.",
      href: "/firm/admin/settings", action: "Open operations", skippable: true },
    { key: "people", label: "Invite your colleagues, and a second owner", done: r.members > 1 && r.owners > 1,
      why: r.members <= 1 ? "You are the only member. Nobody else can act for the firm, and one owner cannot be stood down." : "One owner: if they leave, nobody can appoint another.",
      href: "/firm/admin/people", action: "Invite people", skippable: true },
    { key: "profile", label: "Publish at least one practitioner profile", done: r.public_lawyers > 0,
      why: "The booking page lists nobody to book with until a lawyer publishes their profile from Me.",
      href: "/firm/me", action: "Open Me", skippable: false },
    { key: "availability", label: "Set a lawyer's working week", done: r.availability_rules > 0,
      why: "No hours, no times to offer — the wizard shows nothing whatever the catalogue says.",
      href: "/firm/availability", action: "Set availability", skippable: false },
    { key: "services", label: "Price a service and switch it on", done: r.active_services > 0,
      why: "Nothing is bookable. Every firm starts with one unpriced consultation, switched off.",
      href: "/firm/admin/services", action: "Open the catalogue", skippable: false },
    { key: "settlement", label: "Enter the Paystack settlement account", done: r.settlement_account,
      why: r.needs_settlement
        ? "A service switched on asks for payment first, and every booking of it is refused until the account is set."
        : "Not needed yet: nothing switched on asks for payment up front. Needed the day a priced, prepaid service is on.",
      href: "/firm/admin/settings", action: "Set the settlement account", skippable: true },
    { key: "intake", label: "Write the booking questions", done: r.intake_forms > 0,
      why: "Without a form a client books with nothing but their name and the time.",
      href: "/firm/admin/intake", action: "Edit the intake questions", skippable: true },
    { key: "brand", label: "Set your colours and logo", done: r.brand_colours && r.brand_logo,
      why: "Your public site and your clients' app wear these. Until then they wear Docket's defaults.",
      href: "/firm/admin/settings", action: "Open brand", skippable: true },
    { key: "service_of_process", label: "Record the address for service", done: r.address_for_service,
      why: "Other firms cannot serve you through Docket, and the process you serve carries no return address.",
      href: "/firm/admin/settings", action: "Open service of process", skippable: true },
    { key: "import", label: "Bring your existing matters in", done: r.matters > 0,
      why: "Nothing is on the books yet. Import a spreadsheet, or open the first matter by hand.",
      href: "/firm/admin/import", action: "Import a spreadsheet", skippable: true },
    { key: "domain", label: "Ask for your own web address", done: Boolean(r.custom_domain),
      why: r.domain_request ? `Requested; Docket is ${r.domain_request}.` : `Your site answers at /${r.slug}. Optional.`,
      href: "/firm/admin/settings", action: "Ask for a domain", skippable: true },
  ];
}

export function Checklist({ firmId, readiness, canWrite }: { firmId: string; readiness: FirmReadiness; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<OnboardingStep | null>(null);
  const [note, setNote] = useState("");

  const list = steps(readiness);
  const skipped = readiness.skipped ?? {};
  const remaining = list.filter((s) => !s.done && !skipped[s.key]);
  const g = readiness.gates;

  function skip(step: OnboardingStep) {
    setError(null);
    start(async () => {
      const r = await skipOnboardingStep(firmId, step, note);
      if (r?.error) { setError(r.error); return; }
      setSkipping(null); setNote("");
      router.refresh();
    });
  }
  function resume(step: OnboardingStep) {
    setError(null);
    start(async () => {
      const r = await resumeOnboardingStep(firmId, step);
      if (r?.error) { setError(r.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {([
          ["Site published", g.site_open, g.site_open ? `Open at /${readiness.slug}.` : readiness.status === "pending" ? "Awaiting Docket's verification." : "Suspended by Docket."],
          ["Bookable", g.bookable, g.bookable ? "A client can book today." : "Something the booking engine checks is missing — see below."],
          ["Payment-ready", g.payment_ready, readiness.settlement_account ? "Prepaid bookings settle to your account." : readiness.needs_settlement ? "A prepaid service is on and no account is set." : "No prepaid service is on, so nothing is needed yet."],
        ] as Array<[string, boolean, string]>).map(([label, ok, text]) => (
          <div key={label} className={ok ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2" : "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"}>
            <p className={ok ? "text-sm font-semibold text-emerald-900" : "text-sm font-semibold text-amber-900"}>{ok ? "✓ " : "· "}{label}</p>
            <p className="text-xs text-gray-700">{text}</p>
          </div>
        ))}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <p className="text-sm text-gray-600">
        {remaining.length === 0
          ? "Everything on the list is done or set aside."
          : `${remaining.length} ${remaining.length === 1 ? "step" : "steps"} left. Each line is a fact read from the database now, not a box someone ticked.`}
      </p>

      <ol className="divide-y divide-gray-100">
        {list.map((s, i) => {
          const sk = skipped[s.key];
          return (
            <li key={s.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  <span className={s.done ? "mr-2 text-emerald-700" : sk ? "mr-2 text-gray-400" : "mr-2 text-amber-700"}>{s.done ? "✓" : sk ? "–" : String(i + 1)}</span>
                  <span className={sk && !s.done ? "text-gray-500 line-through" : ""}>{s.label}</span>
                </p>
                {!s.done && !sk && s.why && <p className="mt-0.5 text-xs text-gray-600">{s.why}</p>}
                {sk && !s.done && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    Set aside{sk.note ? `: ${sk.note}` : ""}.
                    {canWrite && <button type="button" className="ml-2 underline" disabled={pending} onClick={() => resume(s.key)}>Put it back</button>}
                  </p>
                )}
              </div>
              {!s.done && !sk && (
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={s.href} className="flex min-h-[44px] items-center text-sm font-medium text-brand underline">{s.action}</Link>
                  {canWrite && s.skippable && skipping !== s.key && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setSkipping(s.key); setNote(""); }}>Set aside</Button>
                  )}
                </div>
              )}
              {skipping === s.key && (
                <div className="w-full rounded-lg border border-gray-200 p-3">
                  <label htmlFor={`skip-${s.key}`} className="text-sm font-medium text-gray-900">Why this firm is setting it aside</label>
                  <input id={`skip-${s.key}`} type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Optional, kept in the audit trail" />
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" disabled={pending} onClick={() => skip(s.key)}>{pending ? "Saving…" : "Set aside"}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSkipping(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
