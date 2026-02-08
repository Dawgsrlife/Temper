import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                temper: {
                    bg: "rgb(var(--color-temper-bg) / <alpha-value>)",
                    surface: "rgb(var(--color-temper-surface) / <alpha-value>)",
                    border: "rgb(var(--color-temper-border) / <alpha-value>)",
                    text: "rgb(var(--color-temper-text) / <alpha-value>)",
                    muted: "rgb(var(--color-temper-muted) / <alpha-value>)",
                    teal: "rgb(var(--color-temper-teal) / <alpha-value>)",
                    red: "rgb(var(--color-temper-red) / <alpha-value>)",
                    blue: "rgb(var(--color-temper-blue) / <alpha-value>)",
                    orange: "rgb(var(--color-temper-orange) / <alpha-value>)",
                    purple: "rgb(var(--color-temper-purple) / <alpha-value>)",
                    gold: "rgb(var(--color-temper-gold) / <alpha-value>)",
                },
            },
            fontFamily: {
                coach: ['var(--font-baloo)', 'sans-serif'],
            },
        },
    },
    plugins: [],
};
export default config;
