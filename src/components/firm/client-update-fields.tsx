"use client";

// The client update's shape, asked the same way on every form that posts one — the court-update
// form and the free note on the matter timeline. What the client reads is in
// src/components/portal/update-structure.tsx, and the two are written to match.
//
// "Action from the client" is three states on purpose. Not stated is the default and is shown to
// the client as nothing, which is what it is; "nothing needed" is a claim, so it is a choice the
// lawyer makes, and it is then said out loud on the client's screen.

import type { ReactNode } from "react";

export type ActionRequired = "unstated" | "none" | "required";

export interface ClientUpdateShape {
  meaning: string;
  nextStep: string;
  clientAction: string;
  actionRequired: ActionRequired;
  /** YYYY-MM-DD or "". */
  nextUpdateBy: string;
}

export const EMPTY_SHAPE: ClientUpdateShape = { meaning: "", nextStep: "", clientAction: "", actionRequired: "unstated", nextUpdateBy: "" };

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

export function ClientUpdateFields({
  idPrefix, value, onChange, intro,
}: {
  idPrefix: string;
  value: ClientUpdateShape;
  onChange: (next: ClientUpdateShape) => void;
  intro?: ReactNode;
}) {
  const set = (patch: Partial<ClientUpdateShape>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="rounded-lg border border-gray-200 p-3">
      <legend className="px-1 text-sm font-medium text-gray-900">So the client knows where they stand</legend>
      {intro ?? (
        <p className="text-xs text-gray-500">
          Each part is optional and each is shown to the client by name. Leave one empty and it is simply not said.
        </p>
      )}
      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor={`${idPrefix}-meaning`} className="text-sm font-medium text-gray-900">What it means for them</label>
          <textarea id={`${idPrefix}-meaning`} rows={2} maxLength={2000} value={value.meaning} onChange={(e) => set({ meaning: e.target.value })} className={field} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-next`} className="text-sm font-medium text-gray-900">What happens next</label>
          <textarea id={`${idPrefix}-next`} rows={2} maxLength={2000} value={value.nextStep} onChange={(e) => set({ nextStep: e.target.value })} className={field} />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">Action from the client</p>
          <div className="mt-1 grid gap-2 sm:grid-cols-3">
            {([["unstated", "Not stated"], ["none", "Nothing is needed from them"], ["required", "They must do something"]] as Array<[ActionRequired, string]>).map(([v, label]) => (
              <label key={v} className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${value.actionRequired === v ? "border-gray-900" : "border-gray-200"}`}>
                <input type="radio" name={`${idPrefix}-action-required`} className="mt-0.5 h-4 w-4" checked={value.actionRequired === v} onChange={() => set({ actionRequired: v, clientAction: v === "required" ? value.clientAction : "" })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {value.actionRequired === "required" && (
            <div className="mt-2">
              <label htmlFor={`${idPrefix}-action`} className="text-sm font-medium text-gray-900">What they must do <span className="text-red-700">*</span></label>
              <textarea id={`${idPrefix}-action`} rows={2} maxLength={2000} required value={value.clientAction} onChange={(e) => set({ clientAction: e.target.value })} className={field} placeholder="Be at court by 8:30 that morning with your ID." />
            </div>
          )}
        </div>
        <div>
          <label htmlFor={`${idPrefix}-next-by`} className="text-sm font-medium text-gray-900">When to expect the next update</label>
          <input id={`${idPrefix}-next-by`} type="date" value={value.nextUpdateBy} onChange={(e) => set({ nextUpdateBy: e.target.value })} className={field} />
        </div>
      </div>
    </fieldset>
  );
}
