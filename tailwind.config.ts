import type { Config } from "tailwindcss";

// Three colour systems live here, and the separation is the point:
//
//   brand-*    the TENANT's colours, resolved from CSS variables set per firm
//              from firms.brand (see src/lib/brand.ts).
//   docket-*   DOCKET's own colours, for Docket's own surfaces only.
//   semantic   the THEME's neutrals and status tints (--t-* in globals.css),
//              which flip between light and dark.
//
// A firm must never be able to repaint the platform's pages, so docket-* is
// deliberately literal rather than variable. The rule is that green is the ink
// and the ground, and gold is only ever a fill, a rule, or type sitting on
// green — never text on paper. See design/home/README.md.
//
// The semantic neutrals are named for their ROLE, not their lightness: `ink` is
// the text colour in both themes, near-black on paper and near-white on a dark
// ground. That is what makes `text-ink` theme-aware with no `dark:` prefix.

/** rgb(var(--x) / <alpha-value>) so opacity modifiers still work: `text-ink/70`. */
const t = (name: string) => `rgb(var(--t-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  // `dark:` is an escape hatch for the few things a variable cannot express
  // (swapping an image, say). It matches globals.css exactly: the OS preference
  // unless the viewer explicitly chose light, or an explicit choice of dark.
  darkMode: [
    "variant",
    [
      '@media (prefers-color-scheme: dark) { &:not([data-theme="light"] *) }',
      '&:is([data-theme="dark"] *)',
    ],
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--dk-primary)",
          accent: "var(--dk-accent)",
          surface: "var(--dk-surface)",
          // Readable foregrounds, derived from the firm's own colours.
          on: "var(--dk-on-primary)",
          "on-accent": "var(--dk-on-accent)",
        },

        docket: {
          paper: "#f3f2f2",
          ink: "#201e1d",
          hunter: "#2c4a34",
          deep: "#203024",
          link: "#3f694a",
          gold: "#ffb81c",
          "gold-pale": "#ffcb71",
          muted: "#5b5959",
          "muted-dark": "#3f3d3c",
          hair: "#b4b2b2",
          edge: "#7d7a7a",
        },


        // Grounds. Warm, never white.
        paper: t("paper"),
        raised: t("raised"),
        sunken: t("sunken"),

        // Lines. `hairline` is decorative; `edge` bounds a control and clears
        // 3:1 (WCAG 1.4.11) — the border-gray-300 it replaces sat at 1.35:1.
        hairline: t("hairline"),
        edge: t("edge"),

        // Text. `ink-disabled` is for disabled controls only, which WCAG 1.4.3
        // exempts — never for placeholder or secondary text, which need 4.5:1.
        ink: {
          DEFAULT: t("ink"),
          strong: t("ink-strong"),
          muted: t("ink-muted"),
          disabled: t("ink-disabled"),
        },

        // Status. Colour never carries meaning alone — every pill and alert
        // also has an icon and a label.
        settled: { bg: t("settled-bg"), line: t("settled-line"), ink: t("settled-ink") },
        waiting: { bg: t("waiting-bg"), line: t("waiting-line"), ink: t("waiting-ink") },
        wrong: { bg: t("wrong-bg"), line: t("wrong-line"), ink: t("wrong-ink") },
        over: { bg: t("over-bg"), line: t("over-line"), ink: t("over-ink") },
        quiet: { bg: t("quiet-bg"), line: t("quiet-line"), ink: t("quiet-ink") },
        informing: { bg: t("informing-bg"), line: t("informing-line"), ink: t("informing-ink") },

        danger: { DEFAULT: t("danger"), on: t("on-danger") },

        // Interaction overlays. Expressed as ink at low alpha rather than as
        // their own variables, so they flip for free: ink is near-black on
        // paper and near-white on a dark ground, which is exactly the overlay
        // each theme wants. The 32 `hover:bg-black/5` sites in the app do NOT
        // flip — a black wash is invisible on a dark ground — so they migrate
        // to this.
        hover: "rgb(var(--t-ink) / 0.05)",
        press: "rgb(var(--t-ink) / 0.09)",
      },

      // The type ramp. Ten sizes, nothing between them — named for the pixel
      // size so a stray `text-[12.5px]` is obvious next to `text-13`.
      //
      // The landing page's own eight-step ramp (design/home/verify.mjs) is
      // 11/13/15/21/26/44/56/88 — a strict subset, so that file keeps passing.
      // The app adds 17 (card and section titles) and 32, which it does not use.
      fontSize: {
        "11": ["11px", { lineHeight: "16px" }], // micro labels, uppercase eyebrows
        "13": ["13px", { lineHeight: "19px" }], // meta and secondary
        "15": ["15px", { lineHeight: "22px" }], // body — the default
        "17": ["17px", { lineHeight: "24px" }], // card and section titles
        "21": ["21px", { lineHeight: "26px" }], // screen title, phone
        "26": ["26px", { lineHeight: "31px" }], // screen title, desktop
        "32": ["32px", { lineHeight: "37px" }],
        "44": ["44px", { lineHeight: "46px" }], // display, landing only
        "56": ["56px", { lineHeight: "57px" }],
        "88": ["88px", { lineHeight: "86px" }],
      },

      fontFamily: {
        heading: ["var(--dk-font-heading)", "Georgia", "serif"],
        body: ["var(--dk-font-body)", "system-ui", "sans-serif"],
      },

      // Named rather than sm/md/lg/xl on purpose. Overriding Tailwind's own
      // scale would silently move existing callers — `rounded-xl` has 11 uses
      // that would shift 12px -> 16px with nobody having asked for it. These
      // names collide with nothing, so adopting them is always deliberate.
      borderRadius: {
        chip: "6px", // pills, chips, small tags
        control: "9px", // buttons, inputs, selects — today's rounded-[9px]
        card: "12px", // cards, alerts, choice cards — the name already in use
        sheet: "18px", // modals, the phone More sheet — today's rounded-t-[18px]
      },

      // Elevation. In dark mode a shadow is nearly invisible, so each level
      // also steps the surface lightness — which is why this is a token rather
      // than a bare shadow class.
      boxShadow: {
        e1: "var(--t-shadow-e1)", // a card
        e2: "var(--t-shadow-e2)", // a sticky header
        e3: "var(--t-shadow-e3)", // a sheet or modal
      },

      transitionDuration: {
        fast: "120ms",
        base: "180ms",
        slow: "240ms",
      },
    },
  },
  plugins: [],
};

export default config;
