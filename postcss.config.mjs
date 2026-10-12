import path from "node:path";

const config = {
  plugins: {
    // Before Tailwind: resolves var() easings inside @keyframes, which
    // Chrome otherwise ignores (see the plugin's header). An absolute path:
    // Turbopack evaluates this config from a compiled chunk under .next/,
    // so a "./" path would resolve from there, not from the project.
    [path.join(process.cwd(), "postcss", "inline-keyframe-easing.cjs")]: {},
    "@tailwindcss/postcss": {},
  },
};

export default config;
