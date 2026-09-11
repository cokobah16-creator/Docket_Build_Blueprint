"use client";

// Creating a firm on somebody else's behalf.
//
// The fields are the ones VERIFICATION reads, not the shortest set the database would accept:
// the registered name and RC/BN number are what the CAC register is checked against, and the
// owner's enrolment number is what the Roll of Legal Practitioners is checked against. They are
// the same fields a firm fills in for itself at /firm/start, asked in the same words, because a
// firm created here should arrive in exactly the state a self-registered one does.
//
// The firm is created PENDING either way — create_firm() hard-codes that — so nothing is public
// until somebody has actually looked at those numbers and set the firm active.

import { useActionState, useState } from "react";
import { NG_STATE_OPTIONS } from "@/lib/nigeria";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { createFirmForOwner, type AdminCreateFirmState } from "./actions";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 63);
}

export function AdminCreateFirm() {
  const [state, action, pending] = useActionState<AdminCreateFirmState, FormData>(createFirmForOwner, {});
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.created && (
        <Alert kind="success" title="Firm created, pending verification">
          <code>{state.created.slug}</code> exists and its owner can sign in. Its references will
          read {state.created.reference_prefix}/… Check the RC/BN number and the owner’s enrolment
          number against the registers, then set the firm active in its card.
        </Alert>
      )}

      <Input
        label="Firm name"
        name="name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugTouched) setSlug(slugify(e.target.value));
        }}
        error={state.fieldErrors?.name}
        required
      />
      <Input
        label="Web address"
        name="slug"
        value={slug}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value.toLowerCase());
        }}
        hint="Lowercase letters, numbers and hyphens. It becomes the firm’s address on Docket; a custom domain can be mapped afterwards."
        error={state.fieldErrors?.slug}
        required
      />
      <Input
        label="Owner’s email"
        name="ownerEmail"
        type="email"
        autoCapitalize="none"
        hint="They must already have a Docket account — the database refuses an email it has never seen."
        error={state.fieldErrors?.ownerEmail}
        required
      />
      <Input
        label="Registered name"
        name="legalName"
        hint="As registered with the CAC. Leave blank if the firm is not registered."
        error={state.fieldErrors?.legalName}
      />
      <Input
        label="RC / BN number"
        name="rcNumber"
        hint="Checked against the CAC register before the firm is activated."
        error={state.fieldErrors?.rcNumber}
      />
      <Select label="State of principal office" name="stateCode" defaultValue="" error={state.fieldErrors?.stateCode}>
        <option value="">Choose a state</option>
        {NG_STATE_OPTIONS.map((s) => (
          <option key={s.code} value={s.code}>
            {s.name}
          </option>
        ))}
      </Select>
      <Input
        label="Owner’s Supreme Court enrolment number"
        name="ownerScn"
        placeholder="SCN123456"
        hint="Checked against the Roll. It can also be added later on their profile."
        error={state.fieldErrors?.ownerScn}
      />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create firm"}
      </Button>
      <p className="text-sm text-gray-500">
        The firm arrives pending: no public site and no bookings until you activate it.
      </p>
    </form>
  );
}
