// Nigeria-specific helpers shared by every tenant surface. The reference data
// itself (states, courts, holidays) lives in the database (migration 10) so
// the platform can maintain it without a deploy; these are the pure
// functions forms and renderers need on both server and client.

/** ISO 3166-2:NG subdivision codes → names. Mirrors public.ng_states. */
export const NG_STATES: Record<string, string> = {
  AB: "Abia", AD: "Adamawa", AK: "Akwa Ibom", AN: "Anambra", BA: "Bauchi", BY: "Bayelsa",
  BE: "Benue", BO: "Borno", CR: "Cross River", DE: "Delta", EB: "Ebonyi", ED: "Edo",
  EK: "Ekiti", EN: "Enugu", FC: "Federal Capital Territory", GO: "Gombe", IM: "Imo",
  JI: "Jigawa", KD: "Kaduna", KN: "Kano", KT: "Katsina", KE: "Kebbi", KO: "Kogi",
  KW: "Kwara", LA: "Lagos", NA: "Nasarawa", NI: "Niger", OG: "Ogun", ON: "Ondo",
  OS: "Osun", OY: "Oyo", PL: "Plateau", RI: "Rivers", SO: "Sokoto", TA: "Taraba",
  YO: "Yobe", ZA: "Zamfara",
};

export const NG_STATE_OPTIONS = Object.entries(NG_STATES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Human labels for public.court_level. */
export const COURT_LEVEL_LABELS: Record<string, string> = {
  supreme: "Supreme Court",
  court_of_appeal: "Court of Appeal",
  federal_high: "Federal High Court",
  fct_high: "High Court of the FCT",
  state_high: "State High Court",
  national_industrial: "National Industrial Court",
  sharia_appeal: "Sharia Court of Appeal",
  customary_appeal: "Customary Court of Appeal",
  magistrate: "Magistrates' Court",
  district: "District Court",
  customary: "Customary Court",
  area: "Area Court",
  sharia: "Sharia Court",
  tribunal: "Tribunal",
  multi_door: "Multi-Door Courthouse",
};

/**
 * Normalise a Nigerian phone number to E.164 (+234…). Accepts the local
 * 11-digit form (0803 123 4567), 234-prefixed and +234 forms, with spaces,
 * dashes or brackets. Returns null when the input is not a plausible
 * Nigerian mobile/landline number, so callers can fall back to the raw
 * international number (diaspora clients dial from +1, +44 …).
 */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  let national: string | null = null;
  if (/^\+?234\d{10}$/.test(digits)) national = digits.slice(-10);
  else if (/^0\d{10}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{10}$/.test(digits) && /^[789]/.test(digits)) national = digits;
  if (!national) return null;
  return `+234${national}`;
}

/** True for any E.164 number; used to accept diaspora numbers the normaliser declines. */
export function isE164(input: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(input.trim());
}

/**
 * The one E.164 number a link can dial, or null when the text holds no single usable number.
 *
 * A firm's contact phone and WhatsApp number (firms.brand.contact) are free text, kept as the
 * firm typed them: "0803 123 4567", "+234 (0) 803 123 4567", "0803-123-4567". A tel: link made
 * from that raw text dials on some phones and not on others, and wa.me cannot take it at all,
 * because wa.me wants the international number as digits only. So both links start from E.164.
 *
 * A Nigerian number is normalised. Any other number already written in E.164 is kept, for a
 * firm with a line abroad. Everything else gives null: two numbers in one field, an extension,
 * a landline written in its local form ("01 …"), which the normaliser does not accept. The
 * caller then shows the text as typed with no link, rather than a link that may ring the wrong
 * number.
 */
function dialableNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  // "+234 (0) 803 …" and "+234 0803 …": a 0 after the country code is the trunk prefix, which must
  // not be dialled after +234 (and which wa.me rejects), bracketed or not.
  const text = input.replace(/\(0\)/g, "").replace(/^([^\d]*234)[\s().-]*0/, "$1");
  const nigerian = normalizeNigerianPhone(text);
  if (nigerian) return nigerian;
  const compact = text.replace(/[\s().-]/g, "");
  return isE164(compact) ? compact : null;
}

/** "tel:+2348031234567" for a contact number as a firm typed it, or null when it cannot be dialled. */
export function telHref(input: string | null | undefined): string | null {
  const number = dialableNumber(input);
  return number ? `tel:${number}` : null;
}

/**
 * "https://wa.me/2348031234567", a WhatsApp chat with that number, or null. A plain link: it
 * opens WhatsApp itself and needs no WhatsApp integration on Docket's side.
 */
export function whatsappHref(input: string | null | undefined): string | null {
  const number = dialableNumber(input);
  return number ? `https://wa.me/${number.slice(1)}` : null;
}

/**
 * A TIN as it is stored and printed. A TIN pasted from a letter or a PDF can carry an en dash for
 * its hyphen, a no-break space, or a character nobody can see, and the invoice PDF's fonts draw
 * none of them (src/lib/pdf.ts): so full-width forms become plain ones, every dash becomes "-",
 * the invisible characters go, and a run of spaces becomes one. The digits are never touched.
 */
export function normaliseTin(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[‐-―−﹘﹣－]/g, "-")
    .replace(/[­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** What a TIN may be written with once normaliseTin() has tidied it: letters, digits, spaces and hyphens. */
export const TIN_CHARACTERS = /^[A-Za-z0-9 -]*$/;

/**
 * Suit-number sanity check: registries differ, so this only enforces the
 * shape "segments separated by slashes, ending in a year" that every
 * Nigerian court uses (SC/CV/123/2026, CA/L/45/2026, FHC/L/CS/12/2026,
 * LD/1234GCM/2026, NICN/LA/7/2026). Never reject on this alone.
 */
export function looksLikeSuitNumber(input: string): boolean {
  return /^[A-Z0-9]+(\/[A-Z0-9]+)+\/(19|20)\d{2}$/i.test(input.trim());
}

/** Court outcomes as the post-court-update form presents them (blueprint §5.11). */
export const COURT_OUTCOMES: Array<{ key: string; label: string; needsInstance?: boolean }> = [
  { key: "hearing_held", label: "Hearing held" },
  { key: "adjourned", label: "Adjourned", needsInstance: true },
  { key: "ruling_delivered", label: "Ruling delivered" },
  { key: "judgment_delivered", label: "Judgment delivered" },
  { key: "struck_out", label: "Struck out" },
  { key: "stood_down", label: "Stood down" },
  { key: "mention", label: "Mention" },
  { key: "court_did_not_sit", label: "Court did not sit" },
  { key: "hearing_notice", label: "Hearing notice (date fixed, no sitting)" },
  { key: "adjourned_sine_die", label: "Adjourned sine die" },
];

/** "At whose instance" chips for adjournments. */
export const ADJOURNMENT_INSTANCES = [
  "the claimant",
  "the defendant",
  "the prosecution",
  "the court",
  "both parties",
] as const;

/** Nigeria has no daylight saving: Africa/Lagos is fixed UTC+1. */
export const NG_TIMEZONE = "Africa/Lagos";
