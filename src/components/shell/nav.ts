// What each role can reach, described once.
//
// The sidebar, the tablet rail, the bottom bar and the More sheet are four
// arrangements of THIS list — not four lists. A destination added here appears
// in all of them, and "which five go on the phone" is a property of the
// destination (`primary`) rather than a second array that can drift.
//
// Nothing here decides what a person may do. Every destination is a page that
// re-checks the session, the firm membership and RLS for itself; hiding a link
// is tidiness, never a permission.

import type { IconName } from "@/components/ui/icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Short form for the bottom bar, where five labels share the width. */
  short?: string;
  /** On the phone's bottom bar. At most five, including More. */
  primary?: boolean;
  /** Active only on an exact match — for a section root like /firm or /app. */
  exact?: boolean;
  /** Other paths that should light this destination up. */
  also?: string[];
}

export interface NavSection {
  /** Null for the first group, which needs no heading above the app's name. */
  title: string | null;
  items: NavItem[];
}

export interface NavModel {
  sections: NavSection[];
}

/** Every destination, flattened — what More shows and what active-matching walks. */
export function allItems(model: NavModel): NavItem[] {
  return model.sections.flatMap((s) => s.items);
}

/** The phone's bottom bar: the destinations marked primary, in declared order. */
export function primaryItems(model: NavModel): NavItem[] {
  return allItems(model).filter((i) => i.primary);
}

/** Everything the bottom bar could not fit, still grouped, for the More sheet. */
export function overflowSections(model: NavModel): NavSection[] {
  return model.sections
    .map((s) => ({ title: s.title, items: s.items.filter((i) => !i.primary) }))
    .filter((s) => s.items.length > 0);
}

/**
 * Whether `item` is the destination the current path belongs to.
 *
 * Longest-prefix wins, so /firm/matters/new lights Matters rather than also
 * lighting a shorter sibling, and a section root marked `exact` only lights on
 * its own path.
 */
export function activeHref(model: NavModel, pathname: string): string | null {
  let best: { href: string; score: number } | null = null;
  for (const item of allItems(model)) {
    for (const candidate of [item.href, ...(item.also ?? [])]) {
      const hit = item.exact && candidate === item.href
        ? pathname === candidate
        : pathname === candidate || pathname.startsWith(`${candidate}/`);
      if (!hit) continue;
      if (!best || candidate.length > best.score) best = { href: item.href, score: candidate.length };
    }
  }
  return best?.href ?? null;
}

// ── the staff console ──────────────────────────────────────────────────────
// Ordered the way a working day runs: what is happening now, then the files it
// happens to, then the money and the admin behind them.

export const CONSOLE_NAV: NavModel = {
  sections: [
    {
      title: null,
      items: [
        { href: "/firm", label: "Today", icon: "calendar-today", primary: true, exact: true },
        { href: "/firm/appointments", label: "Consultations", short: "Consults", icon: "video", primary: true },
        { href: "/firm/sittings", label: "Sittings", icon: "scale" },
        { href: "/firm/tasks", label: "Tasks", icon: "check" },
      ],
    },
    {
      title: "Work",
      items: [
        { href: "/firm/matters", label: "Matters", icon: "folder", primary: true },
        { href: "/firm/clients", label: "Clients", icon: "clients", primary: true },
        { href: "/firm/messages", label: "Messages", icon: "mail" },
        { href: "/firm/uploads", label: "Uploads", icon: "upload" },
        { href: "/firm/collaborations", label: "Collaborations", short: "Collab", icon: "transfer" },
      ],
    },
    {
      title: "Firm",
      items: [
        { href: "/firm/inbox", label: "Service inbox", short: "Service", icon: "inbox" },
        { href: "/firm/invoices", label: "Invoices", icon: "card" },
        { href: "/firm/availability", label: "Availability", short: "Hours", icon: "clock" },
        { href: "/firm/overview", label: "Overview", icon: "chart" },
        { href: "/firm/admin", label: "Administration", short: "Admin", icon: "building" },
      ],
    },
    {
      title: "You",
      items: [
        { href: "/firm/me", label: "Me & the firm", short: "Me", icon: "user", also: ["/firm/security"] },
      ],
    },
  ],
};

// ── the client portal ──────────────────────────────────────────────────────
// Five destinations, all primary: the portal has nothing that needs a More.

export const PORTAL_NAV: NavModel = {
  sections: [
    {
      title: null,
      items: [
        { href: "/app", label: "Home", icon: "home", primary: true, exact: true },
        { href: "/app/appointments", label: "Appointments", short: "Appts", icon: "calendar", primary: true },
        { href: "/app/matters", label: "Matters", icon: "folder", primary: true },
        { href: "/app/messages", label: "Messages", icon: "mail", primary: true },
      ],
    },
    {
      title: "Your account",
      items: [
        { href: "/app/court-dates", label: "Court dates", short: "Court", icon: "scale" },
        { href: "/app/payments", label: "Payments", icon: "card" },
        { href: "/app/authority", label: "Authority", icon: "shield" },
        { href: "/app/notifications", label: "Notifications", short: "Alerts", icon: "bell" },
        // Four thumbs and More is five slots, which is the most a phone's bar
        // can label honestly. The profile is reached often but not constantly,
        // so it is the one that moves behind More.
        { href: "/app/profile", label: "Profile", icon: "user" },
      ],
    },
  ],
};
