"use client";

import { useActionState } from "react";
import { setFirmStatus, type FirmStatusState } from "./actions";

export function FirmStatusButton({ firmId, status }: { firmId: string; status: string }) {
  const [state, action, pending] = useActionState<FirmStatusState, FormData>(setFirmStatus, {});
  const next = status === "active" ? "suspended" : "active";
  const label = status === "pending" ? "Verify and activate" : status === "suspended" ? "Reactivate" : "Suspend";
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="firmId" value={firmId} />
      <input type="hidden" name="status" value={next} />
      <button type="submit" disabled={pending} className="text-left text-xs font-medium text-brand underline disabled:opacity-50">
        {pending ? "Saving…" : label}
      </button>
      {state.error && <p role="alert" className="text-xs text-red-700">{state.error}</p>}
    </form>
  );
}
