/** "₦50,000" — for screens. Amounts are stored in minor units (kobo/cents). */
export function formatMoneyMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

/** "NGN 50,000.00" — ASCII-safe for PDFs and SMS. */
export function formatMoneyPlain(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
