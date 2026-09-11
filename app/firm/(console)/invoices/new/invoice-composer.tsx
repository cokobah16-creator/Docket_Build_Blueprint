"use client";

// The invoice composer: who is billed, what for, in which currency, at the
// firm's own VAT rate — with the total worked out in front of the lawyer before
// anything is written, and a plain choice between keeping it as a draft and
// issuing it to the client.
//
// Rules enforced here:
//  · The database decides. create_invoice() runs as the signed-in staff member
//    (staff_w: firm member + MFA + firm not suspended), mints the number and
//    applies the firm's VAT rate; this screen only asks for the lines, and any
//    refusal is shown exactly as the database worded it.
//  · Money is integer minor units. Amounts are typed in naira or dollars and
//    turned into kobo or cents in the server action — the arithmetic below is
//    the same arithmetic create_invoice() does, so the preview and the invoice
//    can never disagree.
//  · The note travels to the client: it goes into the notification and, when the
//    invoice is against a matter, onto the client's own timeline. It is never
//    presented as an internal note.
//  · Nothing is firm-specific: the firm, its people, its matters, its currency
//    and its VAT rate all arrive as props from the caller's context.
//
// CopyLink at the foot of this file is the one interactive control the invoice
// screen needs, and lives here so the invoices area keeps to its own files.

import { useMemo, useRef, useState, useTransition, type SyntheticEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createInvoice } from "@/lib/actions/invoices";
import { formatMoneyMinor } from "@/lib/money";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

const MAX_ITEMS = 50;

export interface ClientOption {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface MatterOption {
  id: string;
  reference: string;
  title: string;
  closed: boolean;
}

interface Line {
  key: string;
  description: string;
  quantity: string;
  unit: string;
}

/** The first line is keyed the same on the server and in the browser, so nothing
 *  is re-keyed at hydration; every line added afterwards is keyed in order. */
function lineWithKey(key: string): Line {
  return { key, description: "", quantity: "1", unit: "" };
}

/** Same conversion as the server action: money never goes through raw float × 100. */
function toMinorUnits(major: number): number {
  return Math.round(Number((major * 100).toFixed(4)));
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[\s,]/g, "").trim();
  if (cleaned === "") return NaN;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

export function InvoiceComposer({
  firmId,
  firmName,
  clients,
  matters,
  defaultCurrency,
  vatRate,
  preselectedClientId,
  preselectedMatterId,
  firmQuery,
}: {
  firmId: string;
  firmName: string;
  clients: ClientOption[];
  matters: MatterOption[];
  defaultCurrency: "NGN" | "USD";
  /** firms.vat_rate, as a percentage. Zero means this firm adds no VAT. */
  vatRate: number;
  preselectedClientId: string | null;
  preselectedMatterId: string | null;
  /** "?firm=…" when a member of more than one firm is working in a chosen firm. */
  firmQuery: string;
}) {
  const router = useRouter();

  const [clientId, setClientId] = useState(preselectedClientId ?? "");
  const [clientFilter, setClientFilter] = useState("");
  const [matterId, setMatterId] = useState(preselectedMatterId ?? "");
  const [currency, setCurrency] = useState<"NGN" | "USD">(defaultCurrency);
  const [lines, setLines] = useState<Line[]>(() => [lineWithKey("line-0")]);
  const nextLineKey = useRef(0);
  const [dueOn, setDueOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const currencies: Array<"NGN" | "USD"> = defaultCurrency === "USD" ? ["USD", "NGN"] : ["NGN", "USD"];

  const filteredClients = useMemo(() => {
    const needle = clientFilter.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.email ?? "").toLowerCase().includes(needle) ||
        (c.phone ?? "").replace(/\D/g, "").includes(needle.replace(/\D/g, "")),
    );
  }, [clientFilter, clients]);

  const chosenClient = clients.find((c) => c.id === clientId) ?? null;

  // The preview, worked out exactly as create_invoice() works it out: each line
  // is rounded to minor units before it is multiplied, VAT is a rounded
  // percentage of the subtotal, and the total is the two added together.
  const totals = useMemo(() => {
    let subtotal = 0;
    for (const line of lines) {
      const quantity = parseAmount(line.quantity);
      const unit = parseAmount(line.unit);
      if (!Number.isFinite(quantity) || !Number.isFinite(unit) || quantity <= 0 || unit < 0) continue;
      subtotal += Math.round(toMinorUnits(unit) * quantity);
    }
    const vat = Math.round((subtotal * vatRate) / 100);
    return { subtotal, vat, total: subtotal + vat };
  }, [lines, vatRate]);

  const money = (minor: number) => formatMoneyMinor(minor, currency);

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function freshLine(): Line {
    nextLineKey.current += 1;
    return lineWithKey(`line-${nextLineKey.current}`);
  }

  function addLine() {
    setLines((current) => (current.length >= MAX_ITEMS ? current : [...current, freshLine()]));
  }

  function removeLine(key: string) {
    setLines((current) => (current.length === 1 ? [freshLine()] : current.filter((line) => line.key !== key)));
  }

  function submit(event: SyntheticEvent, issue: boolean) {
    event.preventDefault();
    setError(null);

    if (!clientId) {
      setError("Choose the client this invoice is for.");
      return;
    }

    // A row left entirely blank is simply not a line; a half-filled one is a mistake.
    const filled = lines.filter((line) => line.description.trim() !== "" || line.unit.trim() !== "");
    if (filled.length === 0) {
      setError("Add at least one line — what the client is being billed for, and how much.");
      return;
    }

    const items: Array<{ description: string; quantity: number; unitMajor: number }> = [];
    for (const line of filled) {
      const description = line.description.trim();
      const quantity = parseAmount(line.quantity);
      const unit = parseAmount(line.unit);
      if (!description) {
        setError("Every line needs a description — say what the client is paying for.");
        return;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(`Give a quantity above zero for “${description}”.`);
        return;
      }
      if (!Number.isFinite(unit) || unit < 0) {
        setError(`Give an amount of zero or more for “${description}”.`);
        return;
      }
      items.push({ description, quantity, unitMajor: unit });
    }
    if (totals.subtotal <= 0) {
      setError("An invoice must come to more than zero.");
      return;
    }

    startTransition(async () => {
      const result = await createInvoice({
        firmId,
        clientId,
        items,
        matterId: matterId || null,
        currency,
        dueOn: dueOn || null,
        issue,
        note: note.trim() || null,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/firm/invoices/${result.invoice_id}${firmQuery}`);
      router.refresh();
    });
  }

  if (clients.length === 0) {
    return (
      <Card>
        <CardHeader title="Nobody to bill yet" />
        <CardBody className="space-y-3">
          <p className="text-sm text-gray-700">
            An invoice is raised against a person {firmName} already acts for. Nobody has booked a consultation or
            been added to a matter yet, so there is nobody to bill.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/firm/matters/new${firmQuery}`}
              className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90"
            >
              Open a matter and invite the client
            </Link>
            <Link
              href={`/firm/clients${firmQuery}`}
              className="flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-brand hover:bg-black/5"
            >
              See who is on the books
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={(e) => submit(e, false)} className="space-y-5">
      {error && <Alert kind="error" title="This invoice was not raised">{error}</Alert>}

      <Card>
        <CardHeader title="Who is billed" />
        <CardBody className="space-y-4">
          <div>
            <label htmlFor="client_filter" className="text-sm font-medium text-gray-900">
              Find the client
            </label>
            <p className="text-xs text-gray-500">
              Everyone {firmName} acts for: the people who have booked a consultation and the people named on a matter.
            </p>
            <input
              id="client_filter"
              type="search"
              inputMode="search"
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              placeholder="Name, email or phone number"
              maxLength={80}
              className={field}
            />
          </div>

          <div>
            <label htmlFor="client" className="text-sm font-medium text-gray-900">
              Client <span className="text-red-700">*</span>
            </label>
            <select id="client" value={clientId} onChange={(e) => setClientId(e.target.value)} className={field}>
              <option value="">Choose a client…</option>
              {filteredClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ""}
                </option>
              ))}
            </select>
            {filteredClients.length === 0 && (
              <p className="mt-1 text-xs text-amber-800">
                Nobody matches that. Clear the search to see everyone on the firm&rsquo;s books.
              </p>
            )}
            {chosenClient && !chosenClient.email && (
              <p className="mt-1 text-xs text-amber-800">
                {chosenClient.name} has no email address on file, so no receipt can be emailed. They will still see
                the invoice in their app.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="matter" className="text-sm font-medium text-gray-900">
              Against a matter
            </label>
            <p className="text-xs text-gray-500">
              Optional. Attach it and the issued invoice appears on that matter&rsquo;s timeline for the client.
            </p>
            {matters.length === 0 ? (
              <p className={cn(field, "text-gray-600")}>
                This firm has no matters yet, so the invoice stands on its own.
              </p>
            ) : (
              <select id="matter" value={matterId} onChange={(e) => setMatterId(e.target.value)} className={field}>
                <option value="">No matter — bill the client directly</option>
                {matters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.reference} · {m.title}
                    {m.closed ? " (closed)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="currency" className="text-sm font-medium text-gray-900">
                Currency
              </label>
              <p className="text-xs text-gray-500">The firm bills in {defaultCurrency} unless you say otherwise.</p>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "NGN" | "USD")}
                className={field}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c === "NGN" ? "NGN — Nigerian naira" : "USD — US dollars"}
                    {c === defaultCurrency ? " (the firm's own)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="due_on" className="text-sm font-medium text-gray-900">
                Falls due on
              </label>
              <p className="text-xs text-gray-500">Optional. After this day the invoice reads as overdue.</p>
              <input id="due_on" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className={field} />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="What for"
          action={
            <Button type="button" size="sm" variant="ghost" onClick={addLine} disabled={lines.length >= MAX_ITEMS}>
              Add a line
            </Button>
          }
        />
        <CardBody className="space-y-4">
          {lines.map((line, index) => {
            const quantity = parseAmount(line.quantity);
            const unit = parseAmount(line.unit);
            const lineMinor =
              Number.isFinite(quantity) && Number.isFinite(unit) && quantity > 0 && unit >= 0
                ? Math.round(toMinorUnits(unit) * quantity)
                : null;
            return (
              <div key={line.key} className="rounded-lg border border-gray-200 p-3">
                <div>
                  <label htmlFor={`description_${line.key}`} className="text-sm font-medium text-gray-900">
                    Line {index + 1}
                  </label>
                  <input
                    id={`description_${line.key}`}
                    type="text"
                    maxLength={300}
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    placeholder="Professional fees — drafting and filing the statement of claim"
                    className={field}
                  />
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={`quantity_${line.key}`} className="text-sm font-medium text-gray-900">
                      Quantity
                    </label>
                    <input
                      id={`quantity_${line.key}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.25"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      className={field}
                    />
                  </div>
                  <div>
                    <label htmlFor={`unit_${line.key}`} className="text-sm font-medium text-gray-900">
                      Amount each ({currency})
                    </label>
                    <input
                      id={`unit_${line.key}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={line.unit}
                      onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                      placeholder="0.00"
                      className={field}
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-gray-700">
                    {lineMinor === null ? "—" : <span className="font-medium text-gray-900">{money(lineMinor)}</span>}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeLine(line.key)}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="ghost" onClick={addLine} disabled={lines.length >= MAX_ITEMS}>
              Add another line
            </Button>
            {lines.length >= MAX_ITEMS && (
              <p className="text-xs text-gray-500">An invoice takes at most {MAX_ITEMS} lines.</p>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What it comes to" />
        <CardBody>
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-gray-600">Subtotal</dt>
              <dd className="font-medium text-gray-900">{money(totals.subtotal)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-gray-600">VAT at {vatRate}%</dt>
              <dd className="font-medium text-gray-900">{money(totals.vat)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-gray-100 pt-2">
              <dt className="font-heading text-base font-semibold text-brand">Total</dt>
              <dd className="font-heading text-base font-semibold text-brand">{money(totals.total)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-gray-500">
            {vatRate > 0
              ? `VAT is the firm's own rate of ${vatRate}%, applied by the database when the invoice is raised.`
              : "This firm has no VAT rate set, so no VAT is added. An owner can set it on the firm's record."}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Send it, or keep it" />
        <CardBody className="space-y-4">
          <div>
            <label htmlFor="note" className="text-sm font-medium text-gray-900">
              Note to the client
            </label>
            <p className="text-xs text-gray-500">
              Optional, and the client reads it: it goes out with the invoice and, when the invoice is against a
              matter, onto that matter&rsquo;s timeline. Keep anything internal off this screen.
            </p>
            <textarea
              id="note"
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={field}
            />
          </div>

          <Alert kind="info" title="Issuing tells the client">
            Issue it now and {chosenClient ? chosenClient.name : "the client"} is notified straight away and can pay
            from their own app; the money settles into {firmName}&rsquo;s account, not Docket&rsquo;s. Save it as a
            draft and nobody outside the firm can see it until you issue it.
          </Alert>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" size="lg" onClick={(e) => submit(e, true)} disabled={pending}>
              {pending ? "Working…" : `Issue now${totals.total > 0 ? ` · ${money(totals.total)}` : ""}`}
            </Button>
            <Button type="submit" size="lg" variant="ghost" disabled={pending}>
              {pending ? "Working…" : "Save as a draft"}
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            The invoice number is issued by the database as the invoice is raised, in the firm&rsquo;s own series.
          </p>
        </CardBody>
      </Card>
    </form>
  );
}

/**
 * The client's pay link, ready to hand over: readable, selectable, and copied in
 * one tap where the browser allows it. When the clipboard is refused — an
 * insecure origin, a locked-down browser — the link is shown for a long press
 * instead of failing silently.
 */
export function CopyLink({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("manual");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={value}
          aria-label={label}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800"
        />
        <Button type="button" variant="ghost" onClick={copy}>
          {state === "copied" ? "Copied" : label}
        </Button>
      </div>
      {state === "manual" && (
        <p className="text-xs text-gray-600">
          This browser would not let the page copy for you — press and hold the link above to copy it.
        </p>
      )}
    </div>
  );
}
