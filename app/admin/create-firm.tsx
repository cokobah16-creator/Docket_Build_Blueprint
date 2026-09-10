"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { createFirmForOwner, type AdminCreateFirmState } from "./actions";

export function AdminCreateFirm() {
  const [state, action, pending] = useActionState<AdminCreateFirmState, FormData>(createFirmForOwner, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.created && (
        <Alert kind="success" title="Firm created">
          <code>{state.created.slug}</code> is pending until its owner signs in, enrols two-factor
          and completes settings.
        </Alert>
      )}
      <Input label="Firm name" name="name" required />
      <Input label="Slug" name="slug" hint="lowercase-with-hyphens; becomes {slug}.docket.app" required />
      <Input
        label="Owner's email"
        name="ownerEmail"
        type="email"
        hint="Must already have a Docket account (they sign up at /firm/start)."
        required
      />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create firm"}
      </Button>
    </form>
  );
}
