// The staff console's selected firm, remembered between requests.
//
// A member of more than one firm switches with `?firm=`. Every link the console draws after that
// would have to carry it — the bottom tabs, the Me screen, every row — or the next tap silently
// returns them to their first membership. So the middleware remembers the parameter in this
// cookie, on the one path prefix the console owns, and requestedFirmId() (src/lib/firm-data.ts)
// reads it back when a page arrives without it.
//
// A view preference, never an authorisation: staffContext() matches the value against the
// caller's own memberships on every request, and a value naming no firm of theirs selects
// nothing. Imported by both the middleware (edge) and server code, so it carries nothing else.

export const STAFF_FIRM_COOKIE = "dk_staff_firm";

/** Thirty days: long enough that a two-firm member is not re-asked every week, short enough to lapse. */
export const STAFF_FIRM_MAX_AGE = 60 * 60 * 24 * 30;
