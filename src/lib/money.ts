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
