import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#f7f3ec",
        "paper-dim": "#efe9df",
        ink: "#1f1b16",
        "ink-soft": "#4a443c",
        "ink-faint": "#8a8276",
        oxblood: "#7a2b27",
        "oxblood-dim": "#9a3b36",
        line: "#e2dacd",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
