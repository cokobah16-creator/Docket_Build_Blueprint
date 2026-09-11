"use client";

// Acknowledging a process served on the firm. The note and the moment it is
// saved become part of the service record the other firm can see, so this is a
// deliberate act with its own control rather than a tick in a list.
//
// The field is given an id of its own per service record: several of these sit
// on one screen, one to a served process, and a shared id would leave every
// label pointing at the first row's box.

import { useActionState } from "react";
import { AppButton, AppPill } from "@/components/app";
import { acknowledgeService, type AcknowledgeState } from "./actions";

// The console's own field: neutral edge, 44px of thumb, and a focus ring in the
// shell's ink rather than any firm's colour.
const field =
  "mt-1.5 min-h-[44px] w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong placeholder:text-dk-muted focus:border-dk-pri focus:outline-none";

export function AcknowledgeButton({ serviceId }: { serviceId: string }) {
  const [state, action, pending] = useActionState<AcknowledgeState, FormData>(acknowledgeService, {});
  if (state.done) return <AppPill kind="confirmed">Acknowledged</AppPill>;
  const noteId = `ack_note_${serviceId}`;
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <input type="hidden" name="serviceId" value={serviceId} />
      <div>
        <label htmlFor={noteId} className="text-[13px] font-semibold text-dk-strong">
          Note <span className="font-normal text-dk-muted">(optional)</span>
        </label>
        <input id={noteId} name="note" placeholder="Received at chambers" className={field} />
      </div>
      <AppButton type="submit" variant="primary-sm" disabled={pending}>
        {pending ? "Saving…" : "Acknowledge receipt"}
      </AppButton>
      {/* A refusal is bad news the lawyer must act on, so it keeps its ink and
          says so in words. */}
      {state.error && (
        <p role="alert" className="text-[12px] font-semibold leading-snug text-[#B42318]">
          Not acknowledged: {state.error}
        </p>
      )}
    </form>
  );
}
