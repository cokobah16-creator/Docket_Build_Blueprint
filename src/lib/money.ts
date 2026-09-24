/**
 * "₦50,000", "₦7,500.08", "$19.99" — for screens. Amounts are stored in minor
 * units (kobo/cents).
 *
 * Naira are quoted whole in practice, so a round amount is shown without kobo.
 * An amount that is NOT round has its kobo shown, because rounding them away
 * would print a figure that is not the figure owed — VAT at 7.5% lands on part
 * of a kobo often enough for that to matter. Every other currency always shows
 * its minor units: a dollar invoice for 1999 cents is $19.99, not $20.
 */
export function formatMoneyMinor(minor: number, currency: string): string {
  const wholeNaira = currency === "NGN" && minor % 100 === 0;
  const digits = wholeNaira ? 0 : 2;
  return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 100);
}

/**
 * The VAT on an amount in minor units, worked out exactly as the database does it.
 *
 * book_appointment() and create_invoice() both compute
 * `round(amount_minor * vat_rate / 100.0)` in Postgres numeric: exact decimal
 * arithmetic, rounded half away from zero. firms.vat_rate is numeric(5,2), so
 * the rate is a whole number of hundredths of a percent. This does the same sum
 * on whole numbers: the amount times the rate in hundredths is an integer, and
 * dividing that by 10,000 with a half rounded away from zero gives the same
 * whole minor unit Postgres does.
 * `Math.round(amount * rate / 100)` usually agrees, but it works in binary
 * fractions: 7.55 is not exactly 7.55 in a double, and a product that should
 * end in exactly .5 can land just under it and round down.
 *
 * `ratePercent` is the percentage as stored: 7.5 means 7.5%. A missing rate
 * counts as zero, as `coalesce(vat_rate, 0)` does. The total a client pays is
 * `amountMinor + vatMinor(amountMinor, ratePercent)`.
 */
export function vatMinor(amountMinor: number, ratePercent: number): number {
  if (!Number.isFinite(amountMinor) || !Number.isFinite(ratePercent)) return 0;
  const hundredths = Math.round(ratePercent * 100);
  const scaled = Math.abs(Math.round(amountMinor) * hundredths);
  const remainder = scaled % 10_000;
  const whole = (scaled - remainder) / 10_000 + (remainder * 2 >= 10_000 ? 1 : 0);
  return whole === 0 ? 0 : (amountMinor < 0) !== (hundredths < 0) ? -whole : whole;
}

/**
 * The price a client pays for a fee, for the public site: "₦53,750 incl. VAT"
 * when the firm charges VAT on it, the plain fee otherwise.
 */
export function formatPriceWithVat(priceMinor: number, currency: string, ratePercent: number): string {
  const vat = vatMinor(priceMinor, ratePercent);
  const total = formatMoneyMinor(priceMinor + vat, currency);
  return vat > 0 ? `${total} incl. VAT` : total;
}

/** "NGN 50,000.00" — ASCII-safe for PDFs and SMS. */
export function formatMoneyPlain(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A per-currency total from firm_overview, written out in full: "₦575,000 · $537.50".
 *
 * Minor units of two currencies cannot be added, so these arrive apart and stay
 * apart. An empty map is a real answer — nothing outstanding — and reads as zero
 * in the currency the firm bills in.
 */
export function formatMoneyByCurrency(byCurrency: Record<string, number>, fallbackCurrency: string): string {
  const entries = Object.entries(byCurrency ?? {}).filter(([, minor]) => Number(minor) !== 0);
  if (entries.length === 0) return formatMoneyMinor(0, fallbackCurrency);
  entries.sort((a, b) => (a[0] === fallbackCurrency ? -1 : b[0] === fallbackCurrency ? 1 : a[0].localeCompare(b[0])));
  return entries.map(([currency, minor]) => formatMoneyMinor(Number(minor), currency)).join(" · ");
}
