import type { Config } from "tailwindcss";

/* -------------------------------------------------------------------------- */
/*  CARNIVAL DESIGN SYSTEM — TOKENS                                            */
/*  Bright, friendly, high-contrast. Navy ink on bright "ticket" colors.       */
/* -------------------------------------------------------------------------- */

/** Raw palette. Single source of truth for brand color. */
const palette = {
  /** Deep navy — all body text, headings and dark surfaces. */
  navy: {
    50: "#F3F5FA",
    100: "#E6EAF3",
    200: "#CBD3E6",
    300: "#A3AECB",
    400: "#6E7CA1",
    500: "#47567C",
    600: "#31415F",
    700: "#22345C",
    800: "#1F3054",
    900: "#1B2A49", // brand navy — primary ink
    950: "#101A2E",
  },
  /** Warm yellow — the main accent / primary action color. */
  accent: {
    50: "#FFFAEB",
    100: "#FFF3D0",
    200: "#FFE7A1",
    300: "#FFDC72",
    400: "#FFD45C",
    500: "#FFC93C", // brand yellow
    600: "#F0B41E",
    700: "#C28C10",
    800: "#9A6E0F",
    900: "#7C580E",
  },
  /** Coral — alerts, destructive actions, "needs attention". */
  coral: {
    50: "#FFF1F1",
    100: "#FFE1E1",
    200: "#FFC7C7",
    300: "#FFA8A8",
    400: "#FF8A8A",
    500: "#FF6B6B", // brand coral
    600: "#EE5252",
    700: "#C93A3A", // solid danger fill — passes AA with white/cream text
    800: "#A32C2C",
    900: "#7F2222",
  },
  /** Mint — success, confirmations, "everything is fine". */
  mint: {
    50: "#EAFBFA",
    100: "#D0F5F1",
    200: "#A3EBE3",
    300: "#6FDFD4",
    400: "#4AD2C5",
    500: "#2EC4B6", // brand mint
    600: "#1F9E93",
    700: "#1A7F77",
    800: "#17635D",
    900: "#13504B",
  },
  /** Soft off-white — page and card backgrounds. */
  cream: {
    50: "#FFFFFF",
    100: "#FDFCF9",
    200: "#FAF8F3", // brand off-white — page background
    300: "#F2EEE4",
    400: "#E7E1D3",
  },
} as const;

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx,mdx}",
    "./src/components/**/*.{ts,tsx,mdx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: palette.navy[900], ...palette.navy },
        accent: { DEFAULT: palette.accent[500], ...palette.accent },
        coral: { DEFAULT: palette.coral[500], ...palette.coral },
        mint: { DEFAULT: palette.mint[500], ...palette.mint },
        cream: { DEFAULT: palette.cream[200], ...palette.cream },

        /* Semantic aliases — prefer these in components. */
        background: palette.cream[200],
        surface: {
          DEFAULT: "#FFFFFF",
          muted: palette.cream[100],
          sunken: palette.cream[300],
          inverse: palette.navy[900],
        },
        ink: {
          DEFAULT: palette.navy[900],
          muted: palette.navy[600],
          subtle: palette.navy[400],
          inverse: palette.cream[200],
        },
        success: palette.mint[500],
        warning: palette.accent[500],
        danger: palette.coral[500],
        info: palette.navy[500],

        /** Focus ring color — navy on light surfaces, accent on dark ones. */
        focus: {
          DEFAULT: palette.navy[900],
          inverse: palette.accent[500],
        },
      },

      borderColor: {
        DEFAULT: palette.navy[100],
      },
      ringOffsetColor: {
        DEFAULT: palette.cream[200],
      },

      fontFamily: {
        // Wired to next/font CSS variables (see src/app/layout.tsx)
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
      },
      fontSize: {
        "display-lg": ["2.75rem", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        "display": ["2.25rem", { lineHeight: "1.08", letterSpacing: "-0.02em" }],
        "display-sm": ["1.875rem", { lineHeight: "1.15", letterSpacing: "-0.01em" }],
      },

      borderRadius: {
        // Friendly, rounded, carnival-ticket shapes.
        xl: "0.875rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
        blob: "2.5rem",
      },

      boxShadow: {
        // Soft navy-tinted elevation (never pure black).
        xs: "0 1px 2px 0 rgb(27 42 73 / 0.05)",
        sm: "0 2px 4px -1px rgb(27 42 73 / 0.06), 0 1px 2px -1px rgb(27 42 73 / 0.04)",
        md: "0 6px 16px -4px rgb(27 42 73 / 0.12), 0 2px 6px -2px rgb(27 42 73 / 0.06)",
        lg: "0 16px 32px -12px rgb(27 42 73 / 0.18), 0 4px 10px -4px rgb(27 42 73 / 0.08)",
        pop: "0 4px 0 0 rgb(27 42 73 / 0.9)", // chunky "pressable" shadow
        focus: "0 0 0 3px rgb(27 42 73 / 0.35)",
        "focus-inverse": "0 0 0 3px rgb(255 201 60 / 0.55)",
        none: "none",
      },

      spacing: {
        4.5: "1.125rem",
        13: "3.25rem",
        18: "4.5rem",
        22: "5.5rem",
      },

      transitionTimingFunction: {
        bounce: "cubic-bezier(0.68, -0.55, 0.27, 1.55)",
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
      },

      keyframes: {
        bob: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-3px)" },
        },
        wiggle: {
          "0%, 100%": { transform: "rotate(-2deg)" },
          "50%": { transform: "rotate(2deg)" },
        },
        pop: {
          "0%": { transform: "scale(0.94)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        "fade-up": {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        spin: {
          to: { transform: "rotate(360deg)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        bob: "bob 1.6s ease-in-out infinite",
        wiggle: "wiggle 300ms ease-in-out infinite",
        pop: "pop 180ms cubic-bezier(0.68, -0.55, 0.27, 1.55)",
        "fade-up": "fade-up 240ms cubic-bezier(0.4, 0, 0.2, 1)",
        "spin-slow": "spin 1.4s linear infinite",
        shimmer: "shimmer 1.6s infinite",
      },

      outlineOffset: {
        3: "3px",
      },
      // 44px is the smallest comfortable tap target. `min-*` is the reliable
      // way to apply it: `size-tap` needs its own width/height entry, so these
      // two are what components actually use.
      minHeight: {
        tap: "44px",
      },
      minWidth: {
        tap: "44px",
      },
      width: {
        tap: "44px",
      },
      height: {
        tap: "44px",
      },
    },
  },
  plugins: [],
};

export default config;
