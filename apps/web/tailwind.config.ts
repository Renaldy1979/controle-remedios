import type { Config } from "tailwindcss";

const v = (name: string) => `var(--${name})`;

/** Tokens de design.md seção 2. Os valores vivem em src/styles/tokens.css (claro e escuro). */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    screens: { sm: "640px", desk: "900px", wide: "1080px" },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "#FFFFFF",
      bg: v("bg"),
      sf: v("sf"),
      sf2: v("sf2"),
      bd: v("bd"),
      bd2: v("bd2"),
      ink: v("ink"),
      ink2: v("ink2"),
      ink3: v("ink3"),
      br: v("br"),
      br2: v("br2"),
      brt: v("brt"),
      onbr: v("onbr"),
      neub: v("neub"),
      neuf: v("neuf"),
      trk: v("trk"),
      scrim: v("scrim"),
      ok: { DEFAULT: v("okf"), bg: v("okb"), bar: v("okbar") },
      pn: { DEFAULT: v("pnf"), bg: v("pnb") },
      lt: { DEFAULT: v("ltf"), bg: v("ltb"), bar: v("ltbar"), sf: v("ltsf"), bd: v("ltbd") },
      ms: { DEFAULT: v("msf"), bg: v("msb"), bar: v("msbar"), bd: v("msbd") },
      danger: { DEFAULT: "#B4232A", hover: "#8F1A20" },
      deco: "#3B74F6",
    },
    borderRadius: {
      none: "0",
      sm: "8px",
      DEFAULT: "8px",
      md: "12px",
      lg: "16px",
      xl: "24px",
      pill: "999px",
      full: "9999px",
    },
    boxShadow: {
      sm: "0 1px 2px rgba(16,40,100,.06)",
      md: "0 4px 16px rgba(23,66,184,.10)",
      lg: "0 16px 40px rgba(23,66,184,.18)",
      none: "none",
    },
    fontFamily: {
      display: ["var(--font-jakarta)", "system-ui", "sans-serif"],
      sans: ["var(--font-atkinson)", "Atkinson Hyperlegible", "system-ui", "sans-serif"],
      mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
    },
    fontSize: {
      // [tamanho, { lineHeight, letterSpacing }] conforme design.md 2.4
      display: ["40px", { lineHeight: "44px", letterSpacing: "-0.025em" }],
      t1: ["28px", { lineHeight: "36px", letterSpacing: "-0.02em" }],
      t2: ["22px", { lineHeight: "30px", letterSpacing: "-0.01em" }],
      time: ["24px", { lineHeight: "28px", letterSpacing: "-0.02em" }],
      "time-lg": ["32px", { lineHeight: "36px", letterSpacing: "-0.02em" }],
      t3: ["18px", { lineHeight: "26px" }],
      "body-lg": ["18px", { lineHeight: "28px" }],
      body: ["16px", { lineHeight: "24px" }],
      cap: ["14px", { lineHeight: "20px" }],
    },
    extend: {
      minHeight: { touch: "44px" },
      minWidth: { touch: "44px" },
      spacing: { 18: "72px", 22: "88px" },
    },
  },
  plugins: [],
};

export default config;
