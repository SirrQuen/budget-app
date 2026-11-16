import type { MetadataRoute } from "next";

// The home-screen install (docs/Motion-and-Delight.md, step 7). Icons are
// the generated ones in app/icons/[name]/route.tsx. The navy is --dk-page:
// the splash an installed app shows while it starts, so it opens on the
// ground the mark was validated against. start_url is the dashboard; a
// signed-out visit lands on /login as it does anywhere else.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sorrel",
    short_name: "Sorrel",
    description: "Built to Grow Through Any Season",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#131322",
    theme_color: "#131322",
    icons: [
      { src: "/icons/primary-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/primary-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
