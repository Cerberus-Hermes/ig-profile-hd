import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0a0a0a",
        foreground: "#f5f5f5",
        card: "#171717",
        border: "#262626",
        primary: {
          DEFAULT: "#e11d48",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "#404040",
          foreground: "#a3a3a3",
        },
      },
    },
  },
  plugins: [],
};

export default config;
