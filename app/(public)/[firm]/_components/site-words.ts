// Words a firm's public site repeats on several pages, written once so they read the same
// everywhere (docs/VOICE.md).

import type { FirmBrand } from "@/lib/db/types";
import { formatPriceWithVat } from "@/lib/money";

/**
 * The label on the site's booking button: the firm's own words when it has set brand.cta,
 * otherwise "Book a consultation", in sentence case like every other button. A blank cta
 * counts as unset, so a firm that cleared the field never gets an empty button.
 */
export function ctaLabel(brand: FirmBrand): string {
  return brand.cta?.trim() || "Book a consultation";
}

/**
 * A fee as the client will pay it: "₦32,250 including VAT" when the firm charges VAT on it,
 * the plain amount when it does not, and "Nothing to pay" for a free service, never "₦0".
 *
 * The VAT is vatMinor(), the same sum book_appointment() adds, so the figure here is the
 * figure the booking charges.
 */
export function priceIncludingVat(priceMinor: number, currency: string, vatRate: number): string {
  if (priceMinor <= 0) return "Nothing to pay";
  return formatPriceWithVat(priceMinor, currency, vatRate);
}
