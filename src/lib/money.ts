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
