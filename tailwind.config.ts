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
      },
      fontFamily: {
        heading: ["var(--dk-font-heading)", "Georgia", "serif"],
        body: ["var(--dk-font-body)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "0.75rem",
      },
    },
  },
  plugins: [],
};

export default config;
