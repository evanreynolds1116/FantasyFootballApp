import type { Config } from "tailwindcss";

// Exact token table from UI.md — do not adjust hues without updating the doc first.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#0F1712",
        surface: "#17221B",
        "surface-2": "#1F2D24",
        "surface-sunk": "#121C15",
        line: "#2C3D31",
        "line-dashed": "#4A5E50",
        chip: "#2A3B2F",
        text: "#EEF2EA",
        muted: "#A7B6A9",
        accent: "#F2B84B",
        "on-accent": "#1A1405",
        success: "#8FD6A8",
        "success-bg": "#13241A",
        "success-border": "#3E7A55",
        warn: "#FF9A7A",
        "warn-bg": "#2A1812",
        "warn-border": "#6B3A2C",
      },
      fontFamily: {
        display: ["'Big Shoulders Display'", "Barlow", "sans-serif"],
        body: ["Barlow", "system-ui", "sans-serif"],
      },
      borderRadius: {
        ctl: "10px",
        panel: "16px",
      },
    },
  },
  plugins: [],
} satisfies Config;
