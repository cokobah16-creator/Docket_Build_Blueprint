"use client";

// The rest of the platform's controls over a firm: its plan, its domain, and the queue of
// domains firms have asked for.
//
// Nothing here decides anything. Each form posts to a server action which calls one RPC, and
// whatever the database or Vercel says comes back on screen unedited. The only judgement in
// this file is about ORDER and WORDING: which button is offered first, and what it warns you
// about before you press it.
//
// This file must never import src/lib/providers/domains/vercel.ts. VERCEL_TOKEN is a server
// secret; the client's half of the conversation is a form field and nothing more.

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import {
  completeDomainRequest,
  rejectDomainRequest,
  setFirmDomain,
  setFirmPlan,
  startDomainRequest,
  type DomainRequestState,
  type FirmWriteState,
} from "./actions";

const fieldClass =
  "min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900";
const buttonClass =
  "min-h-[44px] w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50";

function Result({ state }: { state: FirmWriteState | DomainRequestState }) {
  return (
    <>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.done && <Alert kind="success">{state.done}</Alert>}
      {state.notice && <Alert kind="info">{state.notice}</Alert>}
    </>
  );
}

// ---------------------------------------------------------------- plan
export function FirmPlanControl({ firmId, plan }: { firmId: string; plan: string }) {
  const [state, action, pending] = useActionState<FirmWriteState, FormData>(setFirmPlan, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="firmId" value={firmId} />
      <label className="block text-xs font-medium text-gray-600" htmlFor={`plan-${firmId}`}>
        Plan
      </label>
      <select id={`plan-${firmId}`} name="plan" defaultValue={plan} className={fieldClass}>
        <option value="free">Free</option>
        <option value="standard">Standard</option>
        <option value="enterprise">Enterprise</option>
      </select>
      <input
        name="note"
        maxLength={500}
        placeholder="Why (kept in the audit trail)"
        aria-label="Why this plan is changing"
        className={fieldClass}
      />
      <button type="submit" disabled={pending} className={`${buttonClass} bg-brand text-white`}>
        {pending ? "Saving…" : "Set plan"}
      </button>
      <Result state={state} />
    </form>
  );
}

// ---------------------------------------------------------------- domain, straight onto a firm
export function FirmDomainControl({
  firmId,
  currentDomain,
  providerConfigured,
}: {
  firmId: string;
  currentDomain: string | null;
  providerConfigured: boolean;
}) {
  const [state, action, pending] = useActionState<FirmWriteState, FormData>(setFirmDomain, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="firmId" value={firmId} />
      <input type="hidden" name="currentDomain" value={currentDomain ?? ""} />
      <label className="block text-xs font-medium text-gray-600" htmlFor={`domain-${firmId}`}>
        Custom domain
      </label>
      <input
        id={`domain-${firmId}`}
        name="domain"
        defaultValue={currentDomain ?? ""}
        inputMode="url"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="chambers.example.ng"
        className={fieldClass}
      />
      <p className="text-xs text-gray-500">
        Vercel is asked to serve it first; only then is it written to the firm. Clear the box to
        unmap — the firm falls back to its Docket address.
      </p>
      <input
        name="note"
        maxLength={500}
        placeholder="Why (kept in the audit trail)"
        aria-label="Why this domain is changing"
        className={fieldClass}
      />
      <label className="flex items-start gap-2 text-xs text-gray-600">
        <input type="checkbox" name="force" value="on" className="mt-1 h-4 w-4" />
        <span>
          {providerConfigured
            ? "Map it anyway, even if Vercel has not verified it yet. Only if you know this deployment already answers for the host."
            : "Map it anyway. Vercel is not configured on this deployment, so nothing will check that the host is served."}
        </span>
      </label>
      <button type="submit" disabled={pending} className={`${buttonClass} bg-brand text-white`}>
        {pending ? "Working…" : currentDomain ? "Update domain" : "Map domain"}
      </button>
      <Result state={state} />
    </form>
  );
}

// ---------------------------------------------------------------- the request queue
export function DomainRequestControls({
  requestId,
  hostname,
  status,
}: {
  requestId: string;
  hostname: string;
  status: string;
}) {
  const [startState, startAction, starting] = useActionState<DomainRequestState, FormData>(
    startDomainRequest,
    {},
  );
  const [liveState, liveAction, going] = useActionState<DomainRequestState, FormData>(
    completeDomainRequest,
    {},
  );
  const [rejectState, rejectAction, rejecting] = useActionState<DomainRequestState, FormData>(
    rejectDomainRequest,
    {},
  );

  return (
    <div className="space-y-4">
      <form action={startAction} className="space-y-2">
        <input type="hidden" name="requestId" value={requestId} />
        <p className="text-xs font-medium text-gray-600">Step 1 — ask Vercel to serve it</p>
        <p className="text-xs text-gray-500">
          Nothing about the firm changes yet. Vercel returns the records the firm has to add at
          its registrar, and they are saved here so you can pass them on.
        </p>
        <button
          type="submit"
          disabled={starting}
          className={`${buttonClass} border border-gray-300 bg-white text-brand`}
        >
          {starting ? "Asking Vercel…" : status === "verifying" ? `Ask Vercel about ${hostname} again` : `Add ${hostname} to Vercel`}
        </button>
        <Result state={startState} />
      </form>

      <form action={liveAction} className="space-y-2">
        <input type="hidden" name="requestId" value={requestId} />
        <p className="text-xs font-medium text-gray-600">Step 2 — map it and go live</p>
        <p className="text-xs text-gray-500">
          Vercel is checked again. Only if it confirms the host is written to the firm, and only
          then is the request marked live.
        </p>
        <input
          name="note"
          maxLength={500}
          placeholder="Note for the firm and the audit trail"
          aria-label="Note for the firm"
          className={fieldClass}
        />
        <label className="flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" name="force" value="on" className="mt-1 h-4 w-4" />
          <span>
            Go live anyway — Vercel has not verified it, DNS has not moved yet, or Vercel is not
            configured on this deployment at all.
          </span>
        </label>
        <button type="submit" disabled={going} className={`${buttonClass} bg-brand text-white`}>
          {going ? "Mapping…" : "Map it and go live"}
        </button>
        <Result state={liveState} />
      </form>

      <form action={rejectAction} className="space-y-2">
        <input type="hidden" name="requestId" value={requestId} />
        <p className="text-xs font-medium text-gray-600">Or turn it down</p>
        <input
          name="note"
          maxLength={500}
          required
          placeholder="Why — the firm reads this"
          aria-label="Why this request is being turned down"
          className={fieldClass}
        />
        <button
          type="submit"
          disabled={rejecting}
          className={`${buttonClass} border border-red-200 bg-white text-red-700`}
        >
          {rejecting ? "Working…" : "Turn it down"}
        </button>
        <Result state={rejectState} />
      </form>
    </div>
  );
}
