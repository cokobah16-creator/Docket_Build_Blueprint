"use client";

// The firm lifecycle control: pending, active, suspended, with a note.
//
// The three states are not shades of the same thing and the screen says so before the operator
// presses anything — suspending a firm stops every write its staff make, which is a serious act
// to take by accident. The words below describe what the DATABASE does, not what this form
// wishes it did: set_firm_status() stamps verified_at on the first activation and queues the
// firm_activated message, and admin_w()/staff_w() both return false while a firm is suspended.

import { useActionState, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { setFirmStatus, type FirmWriteState } from "./actions";

const WHAT_IT_DOES: Record<string, string> = {
  pending:
    "Takes the firm off the public site: no public profile, no booking. Its staff can still sign in and set the firm up.",
  active:
    "Opens the public site and bookings. The first activation stamps the verification date and tells the firm.",
  suspended:
    "Stops every write the firm makes — settings, matters, invoices, everything. Reading still works, so nobody loses sight of their files.",
};

export function FirmStatusControl({ firmId, status }: { firmId: string; status: string }) {
  const [state, action, pending] = useActionState<FirmWriteState, FormData>(setFirmStatus, {});
  const [choice, setChoice] = useState(status);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="firmId" value={firmId} />
      <label className="block text-xs font-medium text-gray-600" htmlFor={`status-${firmId}`}>
        Status
      </label>
      <select
        id={`status-${firmId}`}
        name="status"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
      >
        <option value="pending">Pending — awaiting verification</option>
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
      </select>
      <p className="text-xs text-gray-500">{WHAT_IT_DOES[choice]}</p>
      <input
        name="note"
        maxLength={500}
        placeholder="Why (kept in the audit trail)"
        aria-label="Why this status is changing"
        className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
      />
      <button
        type="submit"
        disabled={pending || choice === status}
        className="min-h-[44px] w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : choice === status ? `Already ${status}` : `Set to ${choice}`}
      </button>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.done && <Alert kind="success">{state.done}</Alert>}
    </form>
  );
}
