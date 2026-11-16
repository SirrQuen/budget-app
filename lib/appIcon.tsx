import { ImageResponse } from "next/og";
import { PETAL } from "@/components/SorrelMark";

// The app icons (docs/Motion-and-Delight.md, step 7), drawn on the server
// with ImageResponse (bundled with Next -- no dependency). ImageResponse
// can't read CSS variables, so the brand values are written out here, each
// taken from app/globals.css:
//   --mark-on-dark #e63946, --dk-page #131322, --gold / hover / pressed.
//
// Variants:
//   primary   a gradient mark on the navy ground, a faint warm glow BEHIND it
//   gold      a white mark on the gold gradient
//   light     an ink mark on #F4F1F5
//   flat      the flat coral mark on navy -- for small sizes (below 24px the
//             mark is flat, never a gradient)
//   maskable  primary, with the mark inside the 80% safe zone so an OS mask
//             never clips a leaflet
// The glow sits behind the mark, never on it; the mark is coral, white or
// ink only.

export const ICON_VARIANTS = ["primary", "gold", "light", "flat", "maskable"] as const;
export type IconVariant = (typeof ICON_VARIANTS)[number];

/** Pixel sizes served per variant: 180 (Apple), 192 and 512 (the manifest). */
export const ICON_SIZES = [180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

const NAVY = "#131322";
const CORAL = "#e63946";
const GOLD_LIGHT = "#f2c866";
const GOLD = "#e9b949";
const GOLD_DEEP = "#d4a32f";
const PAPER = "#f4f1f5";

/** "primary-512.png" -> { variant, size }; null for anything else. */
export function parseIconName(name: string): { variant: IconVariant; size: IconSize } | null {
  const match = /^([a-z]+)-(\d+)\.png$/.exec(name);
  if (!match) return null;
  const variant = ICON_VARIANTS.find((v) => v === match[1]);
  const size = ICON_SIZES.find((s) => String(s) === match[2]);
  return variant && size ? { variant, size } : null;
}

/** Every name the icons route serves: variant-size.png. */
export function iconNames(): string[] {
  return ICON_VARIANTS.flatMap((v) => ICON_SIZES.map((s) => `${v}-${s}.png`));
}

function ground(variant: IconVariant): string {
  if (variant === "gold") return `linear-gradient(145deg, ${GOLD_LIGHT}, ${GOLD} 55%, ${GOLD_DEEP})`;
  if (variant === "light") return PAPER;
  return NAVY;
}

// The mark's share of the canvas. Maskable keeps to the 80% safe zone.
function markShare(variant: IconVariant): number {
  return variant === "maskable" ? 0.5 : 0.62;
}

export function renderAppIcon(variant: IconVariant, size: number): ImageResponse {
  const mark = Math.round(size * markShare(variant));
  const gradient = variant === "primary" || variant === "maskable";
  const fill = gradient ? "url(#mark-gradient)" : variant === "gold" ? "#ffffff" : variant === "light" ? NAVY : CORAL;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: ground(variant),
        }}
      >
        {gradient ? (
          // Behind the mark: a faint warm glow, never on it.
          <div
            style={{
              position: "absolute",
              width: size * 0.9,
              height: size * 0.9,
              borderRadius: size,
              background: "radial-gradient(circle, rgba(233,185,73,0.16) 0%, rgba(233,185,73,0) 70%)",
            }}
          />
        ) : null}
        <svg width={mark} height={mark} viewBox="0 0 100 100" fill={fill}>
          {gradient ? (
            <defs>
              <linearGradient id="mark-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ff6a75" />
                <stop offset="1" stopColor={CORAL} />
              </linearGradient>
            </defs>
          ) : null}
          <path d={PETAL} />
          <path d={PETAL} transform="rotate(120 50 50)" />
          <path d={PETAL} transform="rotate(240 50 50)" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
