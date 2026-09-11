import type { Config } from "tailwindcss";

// Semantic colors resolve to CSS variables set per tenant from firms.brand
// (see src/lib/brand.ts). Nothing Klinique-specific lives in code.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
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
        // Docket's OWN colours, for Docket's own surfaces only. Deliberately
        // literal rather than CSS variables: a firm must never be able to
        // repaint the platform's pages by choosing a brand colour. The rule
        // is that green is the ink and the ground, and gold is only ever a
        // fill, a rule, or type sitting on green — never text on paper.
        // See design/home/README.md.
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
        // The phone app's semantic palette. Every value resolves to a
        // --dk-app-* variable that app/globals.css redefines per shell, so one
        // Card or Pill component renders in the firm's colours inside /app and
        // in the console's neutral greys inside /firm without branching.
        dk: {
          pri: "var(--dk-app-pri)",
          acc: "var(--dk-app-acc)",
          "acc-ink": "var(--dk-app-acc-ink)",
          "on-pri": "var(--dk-app-on-pri)",
          surface: "var(--dk-app-surface)",
          line: "var(--dk-app-line)",
          rule: "var(--dk-app-rule)",
          field: "var(--dk-app-field)",
          strong: "var(--dk-app-strong)",
          body: "var(--dk-app-body)",
          soft: "var(--dk-app-soft)",
          muted: "var(--dk-app-muted)",
          tint: "var(--dk-app-tint)",
          bar: "var(--dk-app-bar)",
        },
      },
      fontFamily: {
        heading: ["var(--dk-font-heading)", "Georgia", "serif"],
        body: ["var(--dk-font-body)", "system-ui", "sans-serif"],
        // Headings inside a phone shell: the firm's face in the client app,
        // Archivo in the console. The fallback chain lives in the variable
        // itself, per shell — appended here it ended every console heading in
        // Georgia serif, which is the one thing the console must not be.
        "app-head": ["var(--dk-app-head)"],
        mono: ["ui-monospace", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04)",
        sheet: "0 -8px 32px rgba(0, 0, 0, 0.18)",
      },
      borderRadius: {
        card: "0.75rem",
      },
    },
  },
  plugins: [],
};

export default config;
