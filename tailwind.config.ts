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
