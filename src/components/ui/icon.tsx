// The line-icon language. Replaces the emoji the portal shipped with: an
// emoji renders differently on every phone, carries the vendor's own colour,
// and is read aloud by a screen reader unless it is hidden. These are one
// stroke weight on one 24-unit grid, they take the colour of their container,
// and they are decorative by default.
//
// Every path here is drawn to the prototype in design/pwa — keep them in step.

import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "alert"
  | "bell"
  | "building"
  | "calendar"
  | "calendar-today"
  | "camera"
  | "card"
  | "check"
  | "chevron-down"
  | "close"
  | "dot"
  | "half"
  | "square"
  | "chevron-left"
  | "chevron-right"
  | "clients"
  | "clock"
  | "file"
  | "folder"
  | "home"
  | "mail"
  | "mic"
  | "offline"
  | "paperclip"
  | "phone"
  | "phone-off"
  | "search"
  | "shield"
  | "transfer"
  | "upload"
  | "user"
  | "ussd"
  | "video"
  | "warning";

/** Each icon is the inner markup of a 24×24 stroked viewBox. */
const paths: Record<IconName, ReactElement> = {
  alert: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.6v5M12 16.2v.1" />
    </>
  ),
  close: <path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6" />,
  dot: <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />,
  half: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 3.6a8.4 8.4 0 0 1 0 16.8z" fill="currentColor" stroke="none" />
    </>
  ),
  square: <rect x="5.8" y="5.8" width="12.4" height="12.4" rx="2" />,
  bell: (
    <path d="M6.8 10.4a5.2 5.2 0 0 1 10.4 0c0 4.4 1.6 5.6 1.6 5.6H5.2s1.6-1.2 1.6-5.6M10.2 19a2 2 0 0 0 3.6 0" />
  ),
  building: <path d="M5 20.4V5.2h9v15.2M14 10h5v10.4M8 8.6h3M8 12h3M8 15.4h3" />,
  calendar: (
    <>
      <rect x="3.2" y="5.2" width="17.6" height="15.6" rx="2.4" />
      <path d="M8 3.2v4M16 3.2v4M3.2 10.4h17.6" />
    </>
  ),
  "calendar-today": (
    <>
      <rect x="3.2" y="5.2" width="17.6" height="15.6" rx="2.4" />
      <path d="M8 3.2v4M16 3.2v4M3.2 10.4h17.6M8.4 14.6h3" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="6.6" width="18" height="12.8" rx="2.4" />
      <circle cx="12" cy="13" r="3.4" />
      <path d="M8.6 6.6l1.4-2.2h4l1.4 2.2" />
    </>
  ),
  card: (
    <>
      <rect x="2.6" y="5.6" width="18.8" height="12.8" rx="2.2" />
      <path d="M2.6 10h18.8M6.4 14.4h3.4" />
    </>
  ),
  check: <path d="m5 12.8 4.4 4.4L19 7.6" />,
  "chevron-down": <path d="m7 10 5 5 5-5" />,
  "chevron-left": <path d="m14.5 5.5-7 6.5 7 6.5" />,
  "chevron-right": <path d="m9.5 5.5 7 6.5-7 6.5" />,
  clients: (
    <>
      <circle cx="9.4" cy="8.4" r="3.2" />
      <path d="M3.6 19.8c0-3.2 2.6-5.2 5.8-5.2s5.8 2 5.8 5.2" />
      <path d="M16 6.2a3 3 0 0 1 0 5.8M17.4 14.8c2 .6 3.2 2.2 3.2 5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.2V12l3.4 2" />
    </>
  ),
  file: (
    <>
      <path d="M6.4 3.4h7l4.2 4.2v13H6.4z" />
      <path d="M13.4 3.4v4.2h4.2" />
    </>
  ),
  folder: (
    <path d="M3.2 7.2a2 2 0 0 1 2-2h3.4l2 2.6h8.2a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2z" />
  ),
  home: <path d="M3 10.8 12 3.5l9 7.3M5.6 9.6V20.5h12.8V9.6" />,
  mail: (
    <>
      <rect x="2.8" y="5.2" width="18.4" height="13.6" rx="2.2" />
      <path d="m3.4 6.6 8.6 6.2 8.6-6.2" />
    </>
  ),
  mic: (
    <>
      <rect x="9.4" y="3.4" width="5.2" height="10" rx="2.6" />
      <path d="M6.4 11.6a5.6 5.6 0 0 0 11.2 0M12 17.2v3.4" />
    </>
  ),
  offline: (
    <path d="m3 3 18 18M5 9.6a12 12 0 0 1 3.6-2.2M15.4 7.4A12 12 0 0 1 19 9.6M8 13a7.4 7.4 0 0 1 2-1.1M16 13a7.4 7.4 0 0 0-1.2-.8M10.4 16.4a3.6 3.6 0 0 1 3.2 0M12 19.6h.01" />
  ),
  paperclip: (
    <path d="M17.5 11.3 11 17.8a4.1 4.1 0 0 1-5.8-5.8l6.9-6.9a2.7 2.7 0 0 1 3.9 3.9l-6.9 6.9a1.4 1.4 0 0 1-1.9-1.9l6.4-6.4" />
  ),
  phone: (
    <path d="M6.2 3.6h3.1l1.5 3.6-2.1 1.6a11.4 11.4 0 0 0 5.4 5.4l1.6-2.1 3.6 1.5v3.1a1.9 1.9 0 0 1-2 1.9C10 18.5 5.5 14 4.3 5.6a1.9 1.9 0 0 1 1.9-2z" />
  ),
  "phone-off": (
    <>
      <path d="M6.2 3.4h3l1.4 3.4-2 1.6a11 11 0 0 0 5 5l1.6-2 3.4 1.4v3c0 1-.8 1.8-1.8 1.7C10.4 17 7 13.6 4.5 5.2a1.8 1.8 0 0 1 1.7-1.8z" />
      <path d="m3 21 18-18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m15.8 15.8 4 4" />
    </>
  ),
  shield: <path d="M12 3.4 5.2 6v6c0 4.2 3 7.4 6.8 8.6 3.8-1.2 6.8-4.4 6.8-8.6V6z" />,
  transfer: <path d="M3.6 8.4h15.2l-3.4-3.4M20.4 15.6H5.2l3.4 3.4" />,
  upload: <path d="M12 16.4V4.8M7.6 9.2 12 4.8l4.4 4.4M4.8 19.2h14.4" />,
  user: (
    <>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5.2 20.4c0-3.5 3-5.8 6.8-5.8s6.8 2.3 6.8 5.8" />
    </>
  ),
  ussd: <path d="M9.4 3.6 7.8 20.4M16.2 3.6l-1.6 16.8M4.4 8.8h16M3.6 15.2h16" />,
  video: (
    <>
      <rect x="2.8" y="6.4" width="12.4" height="11.2" rx="2.2" />
      <path d="m15.2 11.2 6-3.4v8.4l-6-3.4z" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4.4 21 19.6H3z" />
      <path d="M12 9.6v4.6M12 16.8v.1" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Square size in px. 21 is the navigation and quick-action default. */
  size?: number;
  /** Heavier for the small confirmation ticks, lighter for large outlines. */
  strokeWidth?: number;
  /**
   * Given a label the icon becomes an image with that name. Left off, it is
   * decorative and hidden — which is right wherever adjacent text already
   * says what it means.
   */
  label?: string;
}

export function Icon({
  name,
  size = 21,
  strokeWidth = 1.7,
  label,
  ...props
}: IconProps) {
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
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
