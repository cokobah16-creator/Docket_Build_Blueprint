"use client";

// The catalogue, edited: one card per service, opening into a form that says what each switch
// will do to a client before it is saved.
//
// Rules obeyed here:
//  · The database is the authorization layer. Nothing here decides who may write — the actions
//    in "@/lib/actions/services" write the table as the signed-in person and RLS (admin_w)
//    answers. Whatever the database says, refusal or not, is shown word for word. `canWrite` only
//    decides whether the forms are offered at all, so a lawyer or a suspended firm reads the
//    catalogue instead of being handed buttons that all refuse.
//  · The fee is TYPED, never computed here. Turning naira into kobo is done exactly once, on the
//    server, because 19.99 * 100 is 1998.9999999999998 in a browser as much as anywhere else.
//    This file never multiplies a fee by anything: the exact kobo figure, the VAT and the total
//    come back from the database on the next render.
//  · Mobile first: one column at 390px, 44px targets, nothing that scrolls sideways.
//  · Every empty state names the next action.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createService, deleteService, setServiceActive, updateService } from "@/lib/actions/services";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/cn";

/** One service as this screen needs it: the row, plus what the database says about its use. */
export interface ServiceView {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceMinor: number;
  /** The fee written the way a lawyer types it — the box below is filled with this. */
  priceText: string;
  currency: "NGN" | "USD";
  durationMin: number;
  lawyerCategory: string;
  requiresPrepayment: boolean;
  virtualAvailable: boolean;
  isActive: boolean;
  sort: number;
  feeLabel: string;
  vatLabel: string | null;
  totalLabel: string;
  minorLabel: string;
  totalAppointments: number;
  upcomingAppointments: number;
  formName: string | null;
  formActive: boolean;
}

interface Draft {
  slug: string;
  name: string;
  description: string;
  priceText: string;
  currency: "NGN" | "USD";
  durationMin: string;
  lawyerCategory: string;
  requiresPrepayment: boolean;
  virtualAvailable: boolean;
  isActive: boolean;
  sort: string;
}

const field =
  "mt-1 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-900 focus:border-brand focus:outline focus:outline-2 focus:outline-brand";
const labelClass = "block text-sm font-medium text-gray-800";
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The fee as typed, with the punctuation a person uses stripped off. No arithmetic. */
function cleanAmount(raw: string): string {
  return raw.trim().replace(/^(NGN|USD)\s*/i, "").replace(/[₦$,\s]/g, "");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function draftFrom(s: ServiceView): Draft {
  return {
    slug: s.slug,
    name: s.name,
    description: s.description,
    priceText: s.priceText,
    currency: s.currency,
    durationMin: String(s.durationMin),
    lawyerCategory: s.lawyerCategory,
    requiresPrepayment: s.requiresPrepayment,
    virtualAvailable: s.virtualAvailable,
    isActive: s.isActive,
    sort: String(s.sort),
  };
}

function emptyDraft(currency: "NGN" | "USD", nextSort: number): Draft {
  return {
    slug: "",
    name: "",
    description: "",
    priceText: "",
    currency,
    durationMin: "45",
    lawyerCategory: "",
    requiresPrepayment: true,
    virtualAvailable: true,
    isActive: false,
    sort: String(nextSort),
  };
}

/**
 * Why this draft cannot be saved, in the words the person typing needs. The server action
 * checks the same things and its answer is the one that counts; this one only saves a round
 * trip.
 */
function draftProblem(d: Draft): string | null {
  if (d.name.trim().length < 2) return "Give the service a name a client would recognise.";
  if (!SLUG_RE.test(d.slug.trim())) {
    return "A web address is lowercase letters, digits and single hyphens — for example company-registration.";
  }
  const amount = cleanAmount(d.priceText);
  if (amount === "") return "Type the fee. A service that is free is priced 0.";
  if (!AMOUNT_RE.test(amount)) return `“${d.priceText.trim()}” is not an amount. Write it as 25000, 25,000 or 25000.50.`;
  const minutes = Number(d.durationMin);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
    return "The length is a whole number of minutes, between 5 and 480.";
  }
  const sort = Number(d.sort);
  if (!Number.isInteger(sort) || sort < 0 || sort > 999) return "The order is a whole number between 0 and 999.";
  return null;
}

export function ServicesEditor({
  firmId,
  firmSlug,
  canWrite,
  defaultCurrency,
  vatRate,
  hasSettlementAccount,
  firmIsActive,
  services,
  categories,
}: {
  firmId: string;
  firmSlug: string | null;
  canWrite: boolean;
  defaultCurrency: "NGN" | "USD";
  vatRate: number;
  hasSettlementAccount: boolean;
  firmIsActive: boolean;
  services: ServiceView[];
  categories: string[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [rowBusy, startRowAction] = useTransition();

  const nextSort = useMemo(
    () => (services.length === 0 ? 10 : Math.min(999, Math.max(...services.map((s) => s.sort)) + 10)),
    [services],
  );

  function openNew() {
    setOpenId("new");
    setDraft(emptyDraft(defaultCurrency, nextSort));
    setFormError(null);
    setNotice(null);
  }

  function openExisting(s: ServiceView) {
    setOpenId(s.id);
    setDraft(draftFrom(s));
    setFormError(null);
    setNotice(null);
  }

  function close() {
    setOpenId(null);
    setDraft(null);
    setFormError(null);
  }

  function patch(changes: Partial<Draft>) {
    setFormError(null);
    setDraft((d) => (d ? { ...d, ...changes } : d));
  }

  function save() {
    if (!draft) return;
    const problem = draftProblem(draft);
    if (problem) {
      setFormError(problem);
      return;
    }
    const input = {
      firmId,
      slug: draft.slug.trim(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      priceText: draft.priceText,
      currency: draft.currency,
      durationMin: Number(draft.durationMin),
      lawyerCategory: draft.lawyerCategory.trim(),
      requiresPrepayment: draft.requiresPrepayment,
      virtualAvailable: draft.virtualAvailable,
      isActive: draft.isActive,
      sort: Number(draft.sort),
    };
    const creating = openId === "new";
    startSave(async () => {
      const result = creating ? await createService(input) : await updateService(String(openId), input);
      if (result.error) {
        setFormError(result.error);
        return;
      }
      setNotice(result.notice ?? "Saved.");
      close();
      router.refresh();
    });
  }

  function toggleActive(s: ServiceView) {
    setRowError(null);
    setNotice(null);
    startRowAction(async () => {
      const result = await setServiceActive(firmId, s.id, !s.isActive);
      if (result.error) {
        setRowError({ id: s.id, message: result.error });
        return;
      }
      setNotice(result.notice ?? "Saved.");
      router.refresh();
    });
  }

  function remove(s: ServiceView) {
    setRowError(null);
    setNotice(null);
    startRowAction(async () => {
      const result = await deleteService(firmId, s.id);
      if (result.error) {
        setRowError({ id: s.id, message: result.error });
        return;
      }
      setConfirmDelete(null);
      setNotice(`“${s.name}” was deleted.`);
      router.refresh();
    });
  }

  /** What this draft would mean for a client, said before it is saved. */
  function consequences(d: Draft): Array<{ tone: "good" | "warn"; text: string }> {
    const out: Array<{ tone: "good" | "warn"; text: string }> = [];
    const amount = cleanAmount(d.priceText);
    const priced = AMOUNT_RE.test(amount) && Number(amount) > 0;
    const free = AMOUNT_RE.test(amount) && Number(amount) === 0;

    if (!d.isActive) {
      out.push({ tone: "warn", text: "Switched off: it is not on the booking page at all, and book_appointment() refuses it with “service unavailable”." });
    } else if (!firmIsActive) {
      out.push({ tone: "warn", text: "Switched on, but the firm is not active on Docket yet, so book_appointment() still refuses every booking with “this firm is not taking bookings”." });
    } else {
      out.push({ tone: "good", text: "Switched on: a client can pick it on the booking page." });
    }

    if (free) {
      out.push({ tone: "good", text: "Free: the consultation is confirmed the moment it is booked. No invoice is raised and nothing is charged." });
    } else if (priced && d.requiresPrepayment) {
      out.push({ tone: "good", text: "Paid first: the slot is held for fifteen minutes while the client pays, and the consultation stays “awaiting payment” until the money lands." });
      if (!hasSettlementAccount) {
        out.push({ tone: "warn", text: "This firm has no settlement account, so book_appointment() will refuse this service with “this firm is not yet set up to receive payments”. Price it at zero, or turn off payment first, until Docket sets the account up." });
      }
    } else if (priced) {
      out.push({ tone: "good", text: "Invoiced, not prepaid: the consultation is confirmed straight away and the invoice is left for the client to pay." });
    }

    if (priced && vatRate > 0) {
      out.push({ tone: "good", text: `VAT at ${vatRate}% is added to the invoice by the database when it is raised.` });
    }

    out.push(
      d.virtualAvailable
        ? { tone: "good", text: "A client may pick a video consultation, or in person, or phone." }
        : { tone: "warn", text: "No video consultation: only in person or phone. A virtual booking is refused with “service not available virtually”." },
    );
    return out;
  }

  const form = draft && (
    <div className="space-y-4">
      <div>
        <label className={labelClass} htmlFor="svc-name">Name</label>
        <input
          id="svc-name"
          className={field}
          value={draft.name}
          maxLength={120}
          placeholder="Company registration"
          onChange={(e) => {
            const name = e.target.value;
            patch(openId === "new" && (draft.slug === "" || draft.slug === slugify(draft.name)) ? { name, slug: slugify(name) } : { name });
          }}
        />
        <p className="mt-1 text-sm text-gray-500">What a client sees first on the booking page.</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="svc-slug">Web address</label>
        <input
          id="svc-slug"
          className={field}
          value={draft.slug}
          maxLength={60}
          inputMode="url"
          onChange={(e) => patch({ slug: e.target.value.toLowerCase() })}
        />
        <p className="mt-1 break-words text-sm text-gray-500">
          {firmSlug ? `/${firmSlug}/book?service=${draft.slug || "…"}` : "Used in the link that opens the booking page straight on this service."}
          {openId !== "new" && " Changing it breaks any link already shared with a client."}
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="svc-description">Description</label>
        <textarea
          id="svc-description"
          rows={3}
          className={field}
          maxLength={1000}
          value={draft.description}
          placeholder="What is covered, and what the client should bring."
          onChange={(e) => patch({ description: e.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="svc-price">
            Fee in {draft.currency === "NGN" ? "naira" : "dollars"}
          </label>
          <input
            id="svc-price"
            className={field}
            value={draft.priceText}
            inputMode="decimal"
            placeholder={draft.currency === "NGN" ? "25,000" : "250.00"}
            onChange={(e) => patch({ priceText: e.target.value })}
          />
          <p className="mt-1 text-sm text-gray-500">
            Type it as you would write it on a bill. 0 means the consultation is free.
          </p>
        </div>
        <div>
          <label className={labelClass} htmlFor="svc-currency">Currency</label>
          <select
            id="svc-currency"
            className={field}
            value={draft.currency}
            onChange={(e) => patch({ currency: e.target.value === "USD" ? "USD" : "NGN" })}
          >
            <option value="NGN">Naira (NGN)</option>
            <option value="USD">Dollars (USD)</option>
          </select>
          <p className="mt-1 text-sm text-gray-500">
            {defaultCurrency === draft.currency
              ? "The firm's own currency."
              : `The firm bills in ${defaultCurrency} by default. A service in another currency is invoiced and settled in that currency on its own.`}
          </p>
        </div>
        <div>
          <label className={labelClass} htmlFor="svc-duration">Length in minutes</label>
          <input
            id="svc-duration"
            className={field}
            value={draft.durationMin}
            inputMode="numeric"
            onChange={(e) => patch({ durationMin: e.target.value.replace(/[^0-9]/g, "") })}
          />
          <p className="mt-1 text-sm text-gray-500">The diary blocks exactly this much time.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="svc-sort">Order on the page</label>
          <input
            id="svc-sort"
            className={field}
            value={draft.sort}
            inputMode="numeric"
            onChange={(e) => patch({ sort: e.target.value.replace(/[^0-9]/g, "") })}
          />
          <p className="mt-1 text-sm text-gray-500">Smaller numbers come first.</p>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="svc-category">Lawyer category</label>
        <input
          id="svc-category"
          className={field}
          value={draft.lawyerCategory}
          maxLength={60}
          list="svc-categories"
          placeholder="general"
          onChange={(e) => patch({ lawyerCategory: e.target.value })}
        />
        <datalist id="svc-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <p className="mt-1 text-sm text-gray-500">
          A note of the kind of counsel this service needs. The booking engine does not read it — it offers whichever
          lawyer the client picks — so treat it as a label for your own people, not a filter.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className={labelClass}>Switches</legend>
        {[
          {
            id: "isActive",
            label: "On the booking page",
            value: draft.isActive,
            set: (v: boolean) => patch({ isActive: v }),
          },
          {
            id: "virtualAvailable",
            label: "Can be a video consultation",
            value: draft.virtualAvailable,
            set: (v: boolean) => patch({ virtualAvailable: v }),
          },
          {
            id: "requiresPrepayment",
            label: "Payment before the consultation is confirmed",
            value: draft.requiresPrepayment,
            set: (v: boolean) => patch({ requiresPrepayment: v }),
          },
        ].map((row) => (
          <label key={row.id} className="flex min-h-[44px] items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={row.value}
              onChange={(e) => row.set(e.target.checked)}
            />
            <span className="text-sm text-gray-800">{row.label}</span>
          </label>
        ))}
      </fieldset>

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
        <p className="text-sm font-medium text-gray-900">What this does to a client</p>
        <ul className="mt-2 space-y-1.5">
          {consequences(draft).map((c) => (
            <li key={c.text} className="flex gap-2 text-sm">
              <span aria-hidden="true" className={c.tone === "good" ? "text-emerald-700" : "text-amber-700"}>
                {c.tone === "good" ? "✓" : "!"}
              </span>
              <span className="text-gray-700">{c.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {formError && (
        <Alert kind="error" title="The database refused this, or the form is not ready">
          {formError}
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={save} disabled={saving}>
          {saving ? "Saving…" : openId === "new" ? "Add this service" : "Save changes"}
        </Button>
        <Button size="lg" variant="ghost" onClick={close} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader
        title={`Catalogue · ${services.length} service${services.length === 1 ? "" : "s"}`}
        action={
          canWrite && openId !== "new" ? (
            <Button size="sm" onClick={openNew}>
              Add a service
            </Button>
          ) : undefined
        }
      />

      {notice && (
        <div className="px-5 pt-4">
          <Alert kind="success">{notice}</Alert>
        </div>
      )}

      {openId === "new" && (
        <CardBody className="border-b border-gray-100 bg-white">
          <h3 className="font-heading text-base font-semibold text-gray-900">A new service</h3>
          <p className="mb-4 mt-1 text-sm text-gray-600">
            It starts switched off, so nothing goes live while you are still deciding. Switch it on below when the fee
            and the length are right.
          </p>
          {form}
        </CardBody>
      )}

      {services.length === 0 && openId !== "new" ? (
        <EmptyState
          title="This firm has nothing a client can book"
          hint={
            canWrite
              ? "A service is the thing a client picks, pays for and turns up to. Add the first one — a consultation with a fee and a length is enough to open the booking page."
              : "An owner or admin of this firm has to add one. Until then the booking page has nothing to offer."
          }
          action={
            canWrite ? (
              <Button size="lg" onClick={openNew}>
                Add the first service
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-gray-100">
          {services.map((s) => {
            const open = openId === s.id;
            return (
              <li key={s.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-900">{s.name}</p>
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                          s.isActive
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : "border-gray-200 bg-gray-50 text-gray-600",
                        )}
                      >
                        {s.isActive ? "on the booking page" : "switched off"}
                      </span>
                      {s.priceMinor === 0 && (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-900">
                          free
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-700">
                      {s.feeLabel} · {s.durationMin} minutes
                      {s.vatLabel ? ` · plus VAT ${s.vatLabel}, so the invoice reads ${s.totalLabel}` : ""}
                      {s.priceMinor > 0 ? ` · held as ${s.minorLabel}` : ""}
                    </p>
                    <p className="mt-0.5 break-words text-xs text-gray-500">
                      /{s.slug}
                      {s.lawyerCategory ? ` · ${s.lawyerCategory}` : ""}
                      {s.virtualAvailable ? " · video allowed" : " · no video"}
                      {s.priceMinor > 0 ? (s.requiresPrepayment ? " · paid first" : " · invoiced after") : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {s.totalAppointments === 0
                        ? "Never booked."
                        : `${s.totalAppointments} consultation${s.totalAppointments === 1 ? "" : "s"} booked${s.upcomingAppointments > 0 ? `, ${s.upcomingAppointments} still to come` : ""}.`}
                      {" "}
                      {s.formName
                        ? `Intake form: ${s.formName}${s.formActive ? "" : " (switched off)"}.`
                        : "No intake form of its own."}
                    </p>
                  </div>
                  {canWrite && !open && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button size="sm" variant="ghost" onClick={() => openExisting(s)}>
                        Edit
                      </Button>
                      <Button size="sm" variant={s.isActive ? "ghost" : "primary"} onClick={() => toggleActive(s)} disabled={rowBusy}>
                        {s.isActive ? "Switch off" : "Switch on"}
                      </Button>
                    </div>
                  )}
                </div>

                {rowError?.id === s.id && (
                  <div className="mt-3">
                    <Alert kind="error" title="The database refused this">
                      {rowError.message}
                    </Alert>
                  </div>
                )}

                {!open && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {s.isActive && firmSlug && (
                      <Link
                        href={`/${firmSlug}/book?service=${s.slug}`}
                        className="flex min-h-[44px] items-center text-sm font-medium text-brand underline"
                      >
                        Open it on the booking page
                      </Link>
                    )}
                    {!canWrite ? null : confirmDelete === s.id ? (
                      <div className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-3">
                        <p className="text-sm text-red-900">
                          Delete “{s.name}” for good?{" "}
                          {s.totalAppointments > 0
                            ? `${s.totalAppointments} consultation${s.totalAppointments === 1 ? " has" : "s have"} been booked on it, so the database will refuse — switching it off is what you want.`
                            : "Nothing has ever been booked on it, so it will go."}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="danger" onClick={() => remove(s)} disabled={rowBusy}>
                            {rowBusy ? "Deleting…" : "Delete permanently"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)} disabled={rowBusy}>
                            Keep it
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="min-h-[44px] text-sm font-medium text-red-700 underline"
                        onClick={() => {
                          setRowError(null);
                          setConfirmDelete(s.id);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}

                {open && <div className="mt-4">{form}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
