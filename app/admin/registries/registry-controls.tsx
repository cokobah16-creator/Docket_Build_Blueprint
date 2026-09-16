"use client";

// The platform's four acts on a registry: create it, add a member, remove a member, suspend or
// restore it. Each is one database function that checks is_platform_admin() and mfa_ok() for
// itself; this file chooses which box comes first and repeats the database's words.

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { addRegistryMember, createRegistry, removeRegistryMember, setRegistryStatus, type RegistryWriteState } from "@/lib/actions/registry";

export function CreateRegistryForm({ courts }: { courts: Array<{ id: string; label: string }> }) {
  const [state, action, pending] = useActionState<RegistryWriteState, FormData>(createRegistry, {});
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.done && <Alert kind="success">{state.done}</Alert>}
      <Select label="Court" name="courtId" required error={state.fieldErrors?.courtId}>
        <option value="">Choose the court whose registry this is</option>
        {courts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </Select>
      <Input label="Registry name" name="name" required maxLength={200} placeholder="Registry of the Federal High Court, Lagos" error={state.fieldErrors?.name} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Contact name (optional)" name="contactName" maxLength={200} />
        <Input label="Contact email (optional)" name="contactEmail" type="email" maxLength={320} autoCapitalize="none" />
      </div>
      <Input label="Note (optional)" name="note" maxLength={2000} hint="Who agreed to the pilot, and on what terms. Kept in the audit trail." />
      <Button type="submit" disabled={pending || courts.length === 0}>{pending ? "Creating…" : "Create the registry"}</Button>
      {courts.length === 0 && <p className="text-xs text-ink-muted">Every platform-wide court already has a registry, or none is active.</p>}
    </form>
  );
}

export function AddMemberForm({ registryId }: { registryId: string }) {
  const [state, action, pending] = useActionState<RegistryWriteState, FormData>(addRegistryMember, {});
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="registryId" value={registryId} />
      <label className="block text-xs text-ink">Email (they sign up first)
        <input name="email" type="email" required autoCapitalize="none" className="mt-1 block min-h-[40px] w-56 rounded-lg border border-edge px-2 text-base" />
      </label>
      <label className="block text-xs text-ink">Role
        <select name="role" defaultValue="clerk" className="mt-1 block min-h-[40px] rounded-lg border border-edge bg-raised px-2 text-base">
          <option value="registrar">Registrar — publishes and withdraws</option>
          <option value="clerk">Clerk — stages</option>
        </select>
      </label>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Adding…" : "Add"}</Button>
      {state.error && <p className="basis-full text-xs text-red-800">{state.error}</p>}
      {state.done && <p className="basis-full text-xs text-emerald-800">{state.done}</p>}
    </form>
  );
}

export function RemoveMemberButton({ registryId, userId }: { registryId: string; userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-red-800">{error}</span>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
        if (!window.confirm("Remove this person from the registry?")) return;
        setBusy(true); setError(null);
        const r = await removeRegistryMember(registryId, userId);
        setBusy(false);
        if (r?.error) setError(r.error); else router.refresh();
      }}>Remove</Button>
    </span>
  );
}

export function RegistryStatusForm({ registryId, status }: { registryId: string; status: string }) {
  const [state, action, pending] = useActionState<RegistryWriteState, FormData>(setRegistryStatus, {});
  const next = status === "active" ? "suspended" : "active";
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-t border-hairline pt-3">
      <input type="hidden" name="registryId" value={registryId} />
      <input type="hidden" name="status" value={next} />
      <label className="block text-xs text-ink">Why (kept in the audit trail)
        <input name="note" maxLength={500} className="mt-1 block min-h-[40px] w-64 rounded-lg border border-edge px-2 text-base" />
      </label>
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? "Saving…" : next === "suspended" ? "Suspend — nothing new can be published" : "Restore"}
      </Button>
      {state.error && <p className="basis-full text-xs text-red-800">{state.error}</p>}
      {state.done && <p className="basis-full text-xs text-emerald-800">{state.done}</p>}
    </form>
  );
}
