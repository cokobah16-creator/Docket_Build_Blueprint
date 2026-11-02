// The firm's own contact details, ready to show on its Contact and Urgent help pages.
//
// firms.brand.contact is free text, as the firm typed it in /firm/admin/settings (migration 50
// keeps each field as text up to 200 characters). So every field comes back twice: the text to
// show, exactly as typed, and a link when one can safely be built from it. A number that cannot
// be dialled as written, or an address that is not an email address, is still shown, just not
// as a link: a link that rings the wrong number is worse than none.

import type { FirmPublic } from "@/lib/db/types";
import { telHref, whatsappHref } from "@/lib/nigeria";

export interface ContactLine {
  /** As the firm typed it. */
  text: string;
  /** tel:, https://wa.me/ or mailto:, or null when the text cannot be linked. */
  href: string | null;
}

/** One address, with no spaces or angle brackets: enough to trust it inside mailto:. */
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function line(value: string | null | undefined, toHref: (text: string) => string | null): ContactLine | null {
  const text = value?.trim();
  return text ? { text, href: toHref(text) } : null;
}

export function firmContact(firm: FirmPublic): {
  phone: ContactLine | null;
  whatsapp: ContactLine | null;
  email: ContactLine | null;
  address: string | null;
} {
  const c = firm.brand.contact ?? {};
  return {
    phone: line(c.phone, telHref),
    whatsapp: line(c.whatsapp, whatsappHref),
    email: line(c.email, (text) => (EMAIL.test(text) ? `mailto:${text}` : null)),
    address: c.address?.trim() || null,
  };
}
