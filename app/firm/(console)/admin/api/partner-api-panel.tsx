"use client";

// Issuing a key, ending one, and saying where events should be pushed.
//
// The key and the signing secret are each shown ONCE, here, at the moment the database mints them.
// Neither is stored by this screen, and neither can be recovered afterwards — Docket keeps only a
// hash of the key, so a database dump is not a set of working credentials.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { formatDay } from "@/lib/days";
import { API_SCOPES, EVENT_TYPES } from "@/lib/partner-api-copy";
import {
  issueApiCredential, removeApiEndpoint, revokeApiCredential, setApiEndpoint,
} from "@/lib/actions/partner-api";
import type { ApiCredentialRow, ApiEndpointSummary } from "@/lib/db/types";

const field =
  "mt-1 block w-full min-h-11 rounded-lg border border-gray-300 px-3 text-[15px] text-gray-900 focus:border-[#141414] focus:outline-none";

export function PartnerApiPanel({ firmId, credentials, endpoints, today }: {
  firmId: string;
  credentials: ApiCredentialRow[];
  endpoints: ApiEndpointSummary[];
  today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ key: string; name: string } | null>(null);
  const [secret, setSecret] = useState<{ value: string; url: string } | null>(null);
  const [form, setForm] = useState({ name: "", scopes: [] as string[], expiresOn: "" });
  const [hook, setHook] = useState({ url: "", types: [] as string[] });

  const live = (c: ApiCredentialRow) => !c.revoked_at && (!c.expires_on || c.expires_on >= today);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  async function issue(e: FormEvent) {
    e.preventDefault();
    setBusy("issue"); setError(null); setIssued(null);
    try {
      const r = await issueApiCredential(firmId, form.name, form.scopes, form.expiresOn || null);
      if ("error" in r) { setError(r.error); return; }
      setIssued({ key: r.key, name: form.name });
      setForm({ name: "", scopes: [], expiresOn: "" });
      router.refresh();
    } catch { setError("Nothing was issued — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function end(id: string) {
    const reason = window.prompt("Why is this key ending? (kept on the record)") ?? "";
    setBusy(id); setError(null);
    try {
      const r = await revokeApiCredential(id, reason);
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function saveHook(e: FormEvent) {
    e.preventDefault();
    setBusy("hook"); setError(null); setSecret(null);
    try {
      const r = await setApiEndpoint(firmId, hook.url, hook.types);
      if ("error" in r) { setError(r.error); return; }
      setSecret({ value: r.signingSecret, url: hook.url });
      setHook({ url: "", types: [] });
      router.refresh();
    } catch { setError("Nothing was saved — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function dropHook(id: string) {
    setBusy(id); setError(null);
    try {
      const r = await removeApiEndpoint(id);
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  return (
    <div className="flex flex-col gap-3.5">
      {error && <Alert kind="error" title="That was refused">{error}</Alert>}

      {issued && (
        <Alert kind="success" title="Copy the key now — it is not shown again">
          <p className="text-sm">This is the only time Docket will show it. Only its hash is stored.</p>
          <code className="mt-2 block break-all rounded-lg bg-white px-2 py-1.5 font-mono text-[11.5px] text-gray-900">{issued.key}</code>
          <p className="mt-2 text-xs">
            Send it as <code>Authorization: Bearer …</code>. If you lose it, revoke it below and issue another —
            there is no way to recover it, which is the point.
          </p>
        </Alert>
      )}

      {secret && (
        <Alert kind="success" title="Copy the signing secret now — it is not shown again">
          <p className="text-sm">
            Whoever runs <span className="font-mono text-xs">{secret.url}</span> verifies our signature with this.
          </p>
          <code className="mt-2 block break-all rounded-lg bg-white px-2 py-1.5 font-mono text-[11.5px] text-gray-900">{secret.value}</code>
        </Alert>
      )}

      <Card>
        <CardHeader title="Keys" />
        <CardBody className="border-b border-gray-100">
          <form onSubmit={issue} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-gray-900">What is it for
                <input type="text" required maxLength={80} value={form.name} placeholder="Accounts package nightly sync"
                       onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
              </label>
              <label className="block text-sm text-gray-900">Last day (optional)
                <input type="date" min={today} value={form.expiresOn}
                       onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} className={field} />
                <span className="mt-1 block text-xs text-gray-500">After it the key opens nothing, with nothing to remember.</span>
              </label>
            </div>
            <fieldset className="rounded-lg border border-gray-200 p-3">
              <legend className="px-1 text-sm font-medium text-gray-800">What it may read</legend>
              <div className="mt-1 space-y-1.5">
                {API_SCOPES.map((s) => (
                  <label key={s.value} className="flex items-start gap-2 text-sm text-gray-900">
                    <input type="checkbox" className="mt-1" checked={form.scopes.includes(s.value)}
                           onChange={() => setForm({ ...form, scopes: toggle(form.scopes, s.value) })} />
                    <span>
                      <span className="font-medium">{s.label}</span>
                      <span className="block text-xs text-gray-500">{s.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={busy === "issue" || form.scopes.length === 0}>
              {busy === "issue" ? "Issuing…" : "Issue a key"}
            </Button>
          </form>
        </CardBody>

        {credentials.length === 0 ? (
          <EmptyState title="No key has been issued" hint="Nothing outside Docket is reading this firm's data." />
        ) : (
          <ul>
            {credentials.map((c) => (
              <li key={c.id} className="border-t border-gray-100 px-[15px] py-3 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[13.5px] font-semibold text-gray-900">
                    {c.name} <span className="font-mono text-xs font-normal text-gray-600">{c.key_prefix}…</span>
                  </p>
                  <span className={live(c) ? "text-xs font-medium text-[#15803D]" : "text-xs text-gray-500"}>
                    {c.revoked_at ? "Revoked"
                      : c.expires_on && c.expires_on < today ? `Expired ${formatDay(c.expires_on)}`
                      : c.expires_on ? `Until ${formatDay(c.expires_on)}` : "Live"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-600">{c.scopes.join(" · ")}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {c.last_used_at
                    ? `Last used ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(c.last_used_at))}`
                    : "Never used"}
                  {c.revoke_reason ? ` · ${c.revoke_reason}` : ""}
                </p>
                {!c.revoked_at && (
                  <Button size="sm" variant="ghost" className="mt-1" disabled={busy === c.id} onClick={() => void end(c.id)}>
                    {busy === c.id ? "Revoking…" : "Revoke it"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Where events are pushed" />
        <CardBody className="border-b border-gray-100">
          <p className="mb-3 text-xs text-gray-500">
            Optional. Without one, a partner reads the same events from the feed whenever they like — nothing is
            lost either way. With one, Docket posts each event as it happens, signed, and retries eight times over
            about a day and a half before giving up and showing it as failed here.
          </p>
          <form onSubmit={saveHook} className="space-y-3">
            <label className="block text-sm text-gray-900">Address
              <input type="url" required value={hook.url} placeholder="https://partner.example/docket/hook"
                     onChange={(e) => setHook({ ...hook, url: e.target.value })} className={field} />
            </label>
            <fieldset className="rounded-lg border border-gray-200 p-3">
              <legend className="px-1 text-sm font-medium text-gray-800">Which events (none ticked: all of them)</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {EVENT_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs">
                    <input type="checkbox" checked={hook.types.includes(t)}
                           onChange={() => setHook({ ...hook, types: toggle(hook.types, t) })} />
                    <span className="font-mono">{t}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={busy === "hook"}>{busy === "hook" ? "Saving…" : "Save the endpoint"}</Button>
          </form>
        </CardBody>

        {endpoints.length === 0 ? (
          <EmptyState title="Nothing is pushed" hint="Events are still there to be read from the feed." />
        ) : (
          <ul>
            {endpoints.map((e) => (
              <li key={e.id} className="border-t border-gray-100 px-[15px] py-3 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="break-all font-mono text-[12.5px] text-gray-900">{e.url}</p>
                  <span className={e.active ? "text-xs font-medium text-[#15803D]" : "text-xs text-gray-500"}>
                    {e.active ? "Active" : "Off"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-600">
                  {e.types.length === 0 ? "Every event" : e.types.join(" · ")}
                </p>
                <p className={e.failed > 0 ? "mt-0.5 text-xs font-medium text-[#B42318]" : "mt-0.5 text-xs text-gray-500"}>
                  {e.delivered} delivered · {e.pending} waiting · {e.failed} failed
                </p>
                {e.active && (
                  <Button size="sm" variant="ghost" className="mt-1" disabled={busy === e.id} onClick={() => void dropHook(e.id)}>
                    Stop pushing to this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
