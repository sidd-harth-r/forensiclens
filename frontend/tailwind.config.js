/** @type {import('tailwindcss').Config} */

/**
 * ForensicLens design tokens.
 *
 * Every color is a CSS variable holding space-separated RGB channels (see src/index.css),
 * which lets Tailwind opacity modifiers such as `bg-accent/10` resolve correctly.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        background: token("background"),
        surface: {
          DEFAULT: token("surface"),
          subtle: token("surface-subtle"),
          muted: token("surface-muted"),
          raised: token("surface-raised"),
          inverse: token("surface-inverse"),
        },
        border: {
          DEFAULT: token("border"),
          subtle: token("border-subtle"),
          strong: token("border-strong"),
        },
        text: {
          primary: token("text-primary"),
          secondary: token("text-secondary"),
          muted: token("text-muted"),
          disabled: token("text-disabled"),
          inverse: token("text-inverse"),
        },
        accent: {
          DEFAULT: token("accent"),
          solid: token("accent-solid"),
          hover: token("accent-hover"),
          active: token("accent-active"),
          subtle: token("accent-subtle"),
          text: token("accent-text"),
          on: token("accent-on"),
        },
        status: {
          success: { DEFAULT: token("status-success"), bg: token("status-success-bg") },
          warning: { DEFAULT: token("status-warning"), bg: token("status-warning-bg") },
          danger: { DEFAULT: token("status-danger"), bg: token("status-danger-bg") },
          neutral: { DEFAULT: token("status-neutral"), bg: token("status-neutral-bg") },
          human: { DEFAULT: token("status-human"), bg: token("status-human-bg") },
          info: { DEFAULT: token("status-info"), bg: token("status-info-bg") },
        },
        code: {
          bg: token("code-bg"),
          text: token("code-text"),
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "Segoe UI Variable Text",
          "Segoe UI",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Cascadia Mono",
          "SFMono-Regular",
          "Consolas",
          "Liberation Mono",
          "Menlo",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }], // 11px — meta labels only
        xs: ["0.75rem", { lineHeight: "1.125rem" }], // 12px — dense table text
        sm: ["0.8125rem", { lineHeight: "1.25rem" }], // 13px — body
        base: ["0.875rem", { lineHeight: "1.375rem" }], // 14px — emphasized body
        lg: ["1rem", { lineHeight: "1.5rem" }], // 16px — section titles
        xl: ["1.125rem", { lineHeight: "1.625rem" }], // 18px — page titles
        "2xl": ["1.375rem", { lineHeight: "1.875rem" }], // 22px — metric values
      },
      borderRadius: {
        none: "0",
        sm: "3px",
        DEFAULT: "4px",
        md: "6px",
        lg: "8px",
        full: "9999px",
      },
      boxShadow: {
        xs: "0 1px 0 0 rgb(0 0 0 / 0.04)",
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.08)",
        overlay: "0 12px 32px -8px rgb(0 0 0 / 0.45), 0 0 0 1px rgb(var(--border) / 1)",
      },
      spacing: {
        sidebar: "15rem",
        topbar: "3rem",
      },
      zIndex: {
        sticky: "20",
        sidebar: "40",
        overlay: "50",
        toast: "60",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-right": {
          from: { transform: "translateX(12px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "scale-in": {
          from: { transform: "scale(0.98)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        shimmer: { "0%": { opacity: "0.5" }, "50%": { opacity: "1" }, "100%": { opacity: "0.5" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "slide-in-right": "slide-in-right 180ms ease-out",
        "scale-in": "scale-in 150ms ease-out",
        shimmer: "shimmer 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
