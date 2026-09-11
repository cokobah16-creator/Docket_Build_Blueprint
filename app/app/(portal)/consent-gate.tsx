"use client";

// First-login consent capture (NDPA): the client accepts the firm's current
// terms and privacy notice; versions are recorded in consent_records by the
// recordConsent server action.
//
// Two things here are not styling.
//
// It covers the tab bar. The gate renders inside the portal shell, so the
// fixed bar (z-40) used to sit on top of it, fully tappable — one tap on
// "Matters" and the gate was behind you. It is now a z-50 sheet over the whole
// viewport, and aria-modal so a screen reader treats what is underneath as
// inert too.
//
// And it can fail. recordConsent returns void and returns early on a zod
// failure, a missing Supabase client, or no session, so the old form set the
// button to "Saving…" on submit and left it there for ever: no error, no
// retry. The submit button now reads the form's own pending state instead of a
// local flag, and if the action settles while this gate is still on screen —
// which, since a successful write revalidates /app past the gate, means it did
// not write — it says so and offers the button back. Nothing about what the
// action does on the server changes.

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { recordConsent } from "./actions";
import { AppButton, AppCard, Footnote } from "@/components/app";
import { Alert } from "@/components/ui/alert";
import { ShieldIcon } from "@/components/ui/icons";

export function ConsentGate({
  firmId,
  firmName,
  termsVersion,
  privacyVersion,
  termsUrl,
  privacyUrl,
}: {
  firmId: string;
  firmName: string;
  termsVersion: string;
  privacyVersion: string;
  termsUrl: string | null;
  privacyUrl: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const onPending = useCallback(() => setFailed(false), []);
  const onSettled = useCallback(() => setFailed(true), []);

  // The tab bar is fixed and lives outside this subtree, so z-50 and
  // aria-modal keep a pointer and a screen reader out of it but do nothing
  // about a keyboard: five Tab presses still reached "Matters" and the gate
  // was behind you. `inert` removes it from focus order as well as from the
  // accessibility tree. The tabIndex pass is the fallback for a browser
  // without inert, and both are undone when the gate unmounts.
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('nav[aria-label="Primary"]');
    if (!bar) return;
    const focusable = Array.from(bar.querySelectorAll<HTMLElement>("a, button, [tabindex]"));
    const previous = focusable.map((el) => el.getAttribute("tabindex"));
    bar.setAttribute("inert", "");
    focusable.forEach((el) => el.setAttribute("tabindex", "-1"));
    return () => {
      bar.removeAttribute("inert");
      focusable.forEach((el, i) => {
        const before = previous[i];
        if (before === null) el.removeAttribute("tabindex");
        else el.setAttribute("tabindex", before);
      });
    };
  }, []);

  const linkClass = "font-medium text-dk-pri underline underline-offset-2";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
      className="dk-safe-top dk-safe-bottom fixed inset-0 z-50 overflow-y-auto bg-dk-surface"
    >
      <div className="dk-rise mx-auto flex min-h-full w-full max-w-lg flex-col justify-center gap-3.5 px-4 py-8">
        <header>
          <span
            aria-hidden="true"
            className="mb-3 grid h-11 w-11 place-items-center rounded-full border border-dk-line bg-white text-dk-pri"
          >
            <ShieldIcon size={21} />
          </span>
          <h1
            id="consent-title"
            className="font-app-head text-[23px] font-semibold leading-tight tracking-[-0.015em] text-dk-pri"
          >
            Before you continue with {firmName}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-dk-muted">
            Accept both documents to open your portal.
          </p>
        </header>

        <AppCard>
          <form action={recordConsent}>
            <input type="hidden" name="firmId" value={firmId} />
            <input type="hidden" name="termsVersion" value={termsVersion} />
            <input type="hidden" name="privacyVersion" value={privacyVersion} />

            <div className="divide-y divide-dk-rule">
              {/* The label is the tap target, not the 20px box inside it. */}
              <label className="flex min-h-[52px] cursor-pointer items-start gap-3 px-[17px] py-[15px] text-[13.5px] leading-relaxed text-dk-body">
                <input
                  type="checkbox"
                  required
                  className="mt-[3px] h-5 w-5 flex-none accent-dk-pri"
                />
                <span>
                  I accept the{" "}
                  {termsUrl ? (
                    <a href={termsUrl} target="_blank" rel="noreferrer" className={linkClass}>
                      terms of service
                    </a>
                  ) : (
                    "terms of service"
                  )}{" "}
                  (version <span className="font-mono text-[12.5px]">{termsVersion}</span>).
                </span>
              </label>

              <label className="flex min-h-[52px] cursor-pointer items-start gap-3 px-[17px] py-[15px] text-[13.5px] leading-relaxed text-dk-body">
                <input
                  type="checkbox"
                  required
                  className="mt-[3px] h-5 w-5 flex-none accent-dk-pri"
                />
                <span>
                  I have read the{" "}
                  {privacyUrl ? (
                    <a href={privacyUrl} target="_blank" rel="noreferrer" className={linkClass}>
                      privacy notice
                    </a>
                  ) : (
                    "privacy notice"
                  )}{" "}
                  (version <span className="font-mono text-[12.5px]">{privacyVersion}</span>).
                </span>
              </label>
            </div>

            <div className="space-y-3 border-t border-dk-rule px-[17px] py-[15px]">
              {failed && (
                <Alert kind="error" title="That did not save">
                  Your acceptance was not recorded, so nothing has changed. Check your
                  connection and try again. If it keeps failing, contact {firmName}.
                </Alert>
              )}
              <ConsentSubmit failed={failed} onPending={onPending} onSettled={onSettled} />
            </div>
          </form>
        </AppCard>

        <Footnote>
          Docket records which version of each document you accepted.
        </Footnote>
      </div>
    </div>
  );
}

/**
 * The submit button, and the gate's only way of telling whether the action
 * worked.
 *
 * `useFormStatus` has to be read from inside the form, so this is its own
 * component. A successful `recordConsent` revalidates `/app`, the server
 * re-renders the home page without the gate, and this unmounts — so a
 * pending-to-settled transition that this component actually lives to see is
 * the failure case. The short timer is there because "settled" and "unmounted"
 * arrive in the same React commit on success, and only the order of the two is
 * not ours to rely on.
 */
function ConsentSubmit({
  failed,
  onPending,
  onSettled,
}: {
  failed: boolean;
  onPending: () => void;
  onSettled: () => void;
}) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      onPending();
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    const t = setTimeout(onSettled, 200);
    return () => clearTimeout(t);
  }, [pending, onPending, onSettled]);

  return (
    <AppButton type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : failed ? "Try again" : "Agree and continue"}
    </AppButton>
  );
}
