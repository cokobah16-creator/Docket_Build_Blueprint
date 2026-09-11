import type { SVGProps } from "react";

// The phone app's line icons, taken from the PWA artboard (design/pwa).
//
// They replace the emoji the first cut of the client app used. Emoji render
// differently on every Android build and every iOS version, they carry a
// colour the design does not choose, and a few of them (📎 ✉ ₦) read as
// characters rather than as buttons at 21px. These are one 24px grid, one
// stroke weight, and they inherit currentColor, so a tab turns the firm's
// colour when it is active and grey when it is not without a second asset.
//
// Every icon here is decorative: each one sits beside its own text label, so
// they are aria-hidden and the label is what a screen reader announces. An
// icon used on its own needs a label on the control that holds it.

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Edge length in px. The artboard uses 21 in navigation, 13–19 inline. */
  size?: number;
}

function Icon({
  size = 21,
  strokeWidth = 1.7,
  children,
  ...props
}: IconProps & { children: React.ReactNode; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ── Navigation ──────────────────────────────────────────────────────── */

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 10.8 12 3.5l9 7.3M5.6 9.6V20.5h12.8V9.6" />
  </Icon>
);

export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.2" y="5.2" width="17.6" height="15.6" rx="2.4" />
    <path d="M8 3.2v4M16 3.2v4M3.2 10.4h17.6" />
  </Icon>
);

/** The console's Today tab: a calendar with the day marked. */
export const TodayIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.2" y="5.2" width="17.6" height="15.6" rx="2.4" />
    <path d="M8 3.2v4M16 3.2v4M3.2 10.4h17.6" />
    <path d="M8.4 14.6h3" />
  </Icon>
);

export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.2 7.2a2 2 0 0 1 2-2h3.4l2 2.6h8.2a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2z" />
  </Icon>
);

export const MailIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.8" y="5.2" width="18.4" height="13.6" rx="2.2" />
    <path d="m3.4 6.6 8.6 6.2 8.6-6.2" />
  </Icon>
);

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8.2" r="3.6" />
    <path d="M5.2 20.4c0-3.5 3-5.8 6.8-5.8s6.8 2.3 6.8 5.8" />
  </Icon>
);

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9.4" cy="8.4" r="3.2" />
    <path d="M3.6 19.8c0-3.2 2.6-5.2 5.8-5.2s5.8 2 5.8 5.2" />
    <path d="M16 6.2a3 3 0 0 1 0 5.8M17.4 14.8c2 .6 3.2 2.2 3.2 5" />
  </Icon>
);

/* ── Actions ─────────────────────────────────────────────────────────── */

export const VideoIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.8" y="6.4" width="12.4" height="11.2" rx="2.2" />
    <path d="m15.2 11.2 6-3.4v8.4l-6-3.4z" />
  </Icon>
);

export const PaperclipIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M17.5 11.3 11 17.8a4.1 4.1 0 0 1-5.8-5.8l6.9-6.9a2.7 2.7 0 0 1 3.9 3.9l-6.9 6.9a1.4 1.4 0 0 1-1.9-1.9l6.4-6.4" />
  </Icon>
);

export const CardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.6" y="5.6" width="18.8" height="12.8" rx="2.2" />
    <path d="M2.6 10h18.8" />
    <circle cx="7" cy="14.2" r="1.4" />
  </Icon>
);

/** The payment-method row's card: a magnetic stripe rather than a chip. */
export const CardStripeIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.6" y="5.6" width="18.8" height="12.8" rx="2.2" />
    <path d="M2.6 10h18.8M6.4 14.4h3.4" />
  </Icon>
);

export const TransferIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.6 8.4h15.2l-3.4-3.4M20.4 15.6H5.2l3.4 3.4" />
  </Icon>
);

export const UssdIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.4 3.6 7.8 20.4M16.2 3.6l-1.6 16.8M4.4 8.8h16M3.6 15.2h16" />
  </Icon>
);

export const UploadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 16.4V4.8M7.6 9.2 12 4.8l4.4 4.4M4.8 19.2h14.4" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon strokeWidth={1.8} {...p}>
    <circle cx="11" cy="11" r="6.4" />
    <path d="m15.8 15.8 4 4" />
  </Icon>
);

export const BellIcon = (p: IconProps) => (
  <Icon strokeWidth={1.6} {...p}>
    <path d="M6.8 10.4a5.2 5.2 0 0 1 10.4 0c0 4.4 1.6 5.6 1.6 5.6H5.2s1.6-1.2 1.6-5.6M10.2 19a2 2 0 0 0 3.6 0" />
  </Icon>
);

export const BuildingIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 20.4V5.2h9v15.2M14 10h5v10.4M8 8.6h3M8 12h3M8 15.4h3" />
  </Icon>
);

export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.2 3.6h3.1l1.5 3.6-2.1 1.6a11.4 11.4 0 0 0 5.4 5.4l1.6-2.1 3.6 1.5v3.1a1.9 1.9 0 0 1-2 1.9C10 18.5 5.5 14 4.3 5.6a1.9 1.9 0 0 1 1.9-2z" />
  </Icon>
);

export const PhoneOffIcon = (p: IconProps) => (
  <Icon strokeWidth={1.8} {...p}>
    <path d="M6.2 3.4h3l1.4 3.4-2 1.6a11 11 0 0 0 5 5l1.6-2 3.4 1.4v3c0 1-.8 1.8-1.8 1.7C10.4 17 7 13.6 4.5 5.2a1.8 1.8 0 0 1 1.7-1.8z" />
    <path d="m3 21 18-18" />
  </Icon>
);

export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9.4" y="3.4" width="5.2" height="10" rx="2.6" />
    <path d="M6.4 11.6a5.6 5.6 0 0 0 11.2 0M12 17.2v3.4" />
  </Icon>
);

export const CameraIcon = (p: IconProps) => (
  <Icon strokeWidth={1.4} {...p}>
    <rect x="3" y="6.6" width="18" height="12.8" rx="2.4" />
    <circle cx="12" cy="13" r="3.4" />
    <path d="M8.6 6.6l1.4-2.2h4l1.4 2.2" />
  </Icon>
);

export const DocumentIcon = (p: IconProps) => (
  <Icon strokeWidth={1.6} {...p}>
    <path d="M6.4 3.4h7l4.2 4.2v13H6.4z" />
    <path d="M13.4 3.4v4.2h4.2" />
  </Icon>
);

/* ── State ───────────────────────────────────────────────────────────── */

export const CheckIcon = (p: IconProps) => (
  <Icon strokeWidth={2.6} {...p}>
    <path d="m5 12.8 4.4 4.4L19 7.6" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon strokeWidth={1.5} {...p}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.2V12l3.4 2" />
  </Icon>
);

export const WarningIcon = (p: IconProps) => (
  <Icon strokeWidth={1.8} {...p}>
    <path d="M12 4.4 21 19.6H3z" />
    <path d="M12 9.6v4.6M12 16.8v.1" />
  </Icon>
);

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.4 5.2 6v6c0 4.2 3 7.4 6.8 8.6 3.8-1.2 6.8-4.4 6.8-8.6V6z" />
  </Icon>
);

export const OfflineIcon = (p: IconProps) => (
  <Icon strokeWidth={1.6} {...p}>
    <path d="m3 3 18 18M5 9.6a12 12 0 0 1 3.6-2.2M15.4 7.4A12 12 0 0 1 19 9.6M8 13a7.4 7.4 0 0 1 2-1.1M16 13a7.4 7.4 0 0 0-1.2-.8M10.4 16.4a3.6 3.6 0 0 1 3.2 0M12 19.6h.01" />
  </Icon>
);

/** Dismiss: the pending-attachment chip in a message thread. Not on the artboard. */
export const CloseIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

/* ── Chevrons ────────────────────────────────────────────────────────── */

export const ChevronLeftIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="m14.5 5.5-7 6.5 7 6.5" />
  </Icon>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="m9.5 5.5 7 6.5-7 6.5" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="m7 10 5 5 5-5" />
  </Icon>
);
