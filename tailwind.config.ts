import type { Config } from "tailwindcss";

// Design language: "the ledger" — the whole visual identity leans into the
// append-only CRDT log at the core of the app (see README "Design Notes").
// Paper-toned surfaces, ink typography, a moss-green "settled/synced" accent,
// and margin-note styling for the version timeline.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: "#F6F4EF",
          50: "#FDFCFA",
          100: "#F6F4EF",
          200: "#EEEAE1",
          300: "#E2DCCD",
        },
        ink: {
          DEFAULT: "#1F2421",
          700: "#2B322D",
          500: "#565E58",
          300: "#8C948D",
        },
        moss: {
          DEFAULT: "#2F6F5E",
          600: "#255A4C",
          100: "#E3EFEA",
        },
        amber: {
          DEFAULT: "#B8842E",
          100: "#F5EBDA",
        },
        rust: {
          DEFAULT: "#A8402F",
          100: "#F5E4E0",
        },
      },
      fontFamily: {
        serif: ["Source Serif 4", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "3px",
        DEFAULT: "6px",
        lg: "10px",
      },
    },
  },
  plugins: [],
} satisfies Config;
