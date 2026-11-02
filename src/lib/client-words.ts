// The words a CLIENT sees for values the database stores as codes.
//
// A client should never read "virtual", "Africa/Lagos", "awaiting_payment" or
// "succeeded" (docs/VOICE.md, rule 4). These maps are the one place each code
// becomes words, so "Not paid yet" reads the same on the home screen, the
// consultation page and the payments list.
//
// They are for the client portal and a firm's public site only. The staff
// console keeps the StatusPill table's own labels (src/components/ui/badge.tsx):
// a lawyer reading "Awaiting payment" in a work queue is reading a state, and the
// table is shared, so client wording goes through StatusPill's `label` prop
// rather than into the table.
//
// No imports, so it runs anywhere, including a client component.

/** "Video call", "In person", "Phone call". */
export function modeLabel(mode: string | null | undefined): string {
  switch (mode) {
    case "virtual":
      return "Video call";
    case "in_person":
      return "In person";
    case "phone":
      return "Phone call";
    default:
      return "Consultation";
  }
}

/**
 * The zone a time is given in, as a person says it: "WAT" for Lagos, otherwise
 * the city, "London time". Never the IANA name.
 */
export function zoneLabel(tz: string | null | undefined): string {
  if (!tz || tz === "Africa/Lagos") return "WAT";
  const city = tz.split("/").pop() ?? tz;
  return `${city.replace(/_/g, " ")} time`;
}

/**
 * Client words for a status, passed to StatusPill as `label`. Undefined means the
 * pill's own label already reads well to a client.
 */
const CLIENT_STATUS_WORDS: Record<string, string> = {
  // appointments
  pending: "Held",
  awaiting_payment: "Not paid yet",
  rescheduled: "Moved",
  no_show: "Missed",
  // invoices
  issued: "To pay",
  partially_paid: "Part paid",
};

export function clientStatusLabel(status: string | null | undefined): string | undefined {
  return status ? CLIENT_STATUS_WORDS[status] : undefined;
}

/** A payment, in words: "Paid", "Not added to this invoice", "Refunded". */
export function paymentStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "succeeded":
      return "Paid";
    case "failed":
      // The webhook records only charge.success (supabase/functions/paystack-webhook), so a
      // 'failed' row is money Paystack DID take that settled to an account other than the firm's,
      // and record_payment() refused to count it (migration 35). "Did not go through" would tell
      // the client their money never moved; what is true is that it was not counted here.
      return "Not added to this invoice";
    case "initiated":
      return "Started, not finished";
    case "refunded":
      return "Refunded";
    default:
      return "Unknown";
  }
}

/** "Good morning", "Good afternoon" or "Good evening", for the hour in `tz`. */
export function greeting(now: Date, tz: string | null | undefined): string {
  let hour = now.getUTCHours() + 1; // WAT, if the zone cannot be read
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz || "Africa/Lagos" }).format(now),
    );
  } catch {
    // an unknown zone name: keep the WAT reading
  }
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}
