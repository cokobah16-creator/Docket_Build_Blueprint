"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acknowledgeService, type AcknowledgeState } from "./actions";

export function AcknowledgeButton({ serviceId }: { serviceId: string }) {
  const [state, action, pending] = useActionState<AcknowledgeState, FormData>(acknowledgeService, {});
  if (state.done) return <p className="text-sm text-green-800">Acknowledged.</p>;
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="serviceId" value={serviceId} />
      <Input label="Note (optional)" name="note" placeholder="Received at chambers" className="sm:w-64" />
      <Button type="submit" size="md" disabled={pending}>{pending ? "Saving…" : "Acknowledge receipt"}</Button>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
