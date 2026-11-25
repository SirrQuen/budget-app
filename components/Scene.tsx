import { useId } from "react";
import { sceneCss, skyOffsets } from "@/lib/scenes";
import type { TimeBand } from "@/lib/timeOfDay";

// The dashboard's painted landscape (docs/Scenes.md): the drawings of
// docs/design/scenes-reference.html, shape for shape. Decorative, still, no
// text. Colours are the layer's custom properties (lib/scenes.ts), so one
// drawing serves both themes.
//
// preserveAspectRatio is "xMaxYMax slice", not the board's "none": the sun and
// moon stay round, the right-hand detail is always kept, narrow banners crop
// from the left and wide ones crop sky from the top. The board's scrim is a
// CSS layer instead of an SVG rect, so it stays behind the words when the
// drawing's left side is cropped away (app/globals.css, "DASHBOARD SCENE").

/** Where each daytime band's three birds fly. */
const BIRDS: Partial<Record<TimeBand, readonly string[]>> = {
  morning: ["M420 38 l6 4 l6 -4", "M442 30 l5 3 l5 -3", "M462 44 l4 3 l4 -3"],
  afternoon: ["M560 38 l6 4 l6 -4", "M582 30 l5 3 l5 -3", "M602 44 l4 3 l4 -3"],
};

const MOUNTAINS =
  "M0 132 C40 120 60 104 90 106 C120 108 140 92 175 86 C210 80 230 104 265 100 C300 96 320 78 360 74 C400 70 420 96 455 92 C490 88 515 70 555 68 C595 66 615 90 650 88 C690 86 710 72 750 70 C790 68 820 84 860 82 L860 200 L0 200 Z";
const MID_HILL = "M0 150 C120 120 220 135 330 118 C450 100 560 130 680 112 C760 100 820 110 860 104 L860 200 L0 200 Z";
const NEAR_HILL =
  "M0 172 C140 150 260 168 400 150 C520 136 640 160 760 146 C810 140 840 144 860 142 L860 200 L0 200 Z";

const SUN: Partial<Record<TimeBand, { cx: number; glowCy: number; glowR: number; cy: number; r: number }>> = {
  morning: { cx: 600, glowCy: 58, glowR: 80, cy: 58, r: 20 },
  afternoon: { cx: 690, glowCy: 40, glowR: 70, cy: 40, r: 17 },
  evening: { cx: 470, glowCy: 86, glowR: 100, cy: 86, r: 24 },
};

/** [cx, cy, r, opacity] */
type Star = readonly [number, number, number, number];
const LOW_STARS: readonly Star[] = [
  [380, 30, 1.2, 0.8],
  [450, 62, 1, 0.6],
  [520, 22, 1.4, 0.7],
  [600, 70, 1, 0.5],
  [760, 96, 1.1, 0.6],
  [820, 30, 1, 0.6],
];
const HIGH_STARS: readonly Star[] = [
  [330, -40, 1.1, 0.7],
  [410, -62, 1.3, 0.8],
  [480, -20, 0.9, 0.6],
  [560, -55, 1.2, 0.7],
  [640, -30, 1, 0.6],
  [740, -66, 1.4, 0.8],
  [800, -14, 1, 0.6],
  [280, -60, 0.9, 0.5],
  [690, -8, 0.8, 0.5],
];

const stars = (list: readonly Star[]) =>
  list.map(([cx, cy, r, opacity]) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} opacity={opacity} />);

const fill = (name: string) => ({ fill: `var(--scene-${name})` });
const stop = (name: string) => ({ stopColor: `var(--scene-${name})` });

export function Scene({ band }: { band: TimeBand }) {
  const uid = useId().replace(/[^\w-]/g, "");
  const sky = `scene-sky-${band}-${uid}`;
  const glow = `scene-glow-${band}-${uid}`;
  const sun = SUN[band];
  const night = band === "night";
  const birds = BIRDS[band];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: sceneCss(band) }} />
      <svg viewBox="0 -80 860 280" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
            {skyOffsets(band).map((offset, i) => (
              <stop key={offset} offset={`${offset}%`} style={stop(`sky-${i + 1}`)} />
            ))}
          </linearGradient>
          <radialGradient id={glow}>
            {night ? (
              <>
                <stop offset="0%" style={stop("moon-halo")} stopOpacity=".35" />
                <stop offset="100%" style={stop("moon-halo")} stopOpacity="0" />
              </>
            ) : (
              <>
                <stop offset="0%" style={stop("glow-1")} />
                <stop offset="40%" style={stop("glow-2")} />
                <stop offset="100%" style={stop("glow-3")} />
              </>
            )}
          </radialGradient>
        </defs>

        <rect y="-80" width="860" height="280" fill={`url(#${sky})`} />

        {sun ? (
          <g data-sun="">
            <circle cx={sun.cx} cy={sun.glowCy} r={sun.glowR} fill={`url(#${glow})`} />
            <circle cx={sun.cx} cy={sun.cy} r={sun.r} style={fill("sun")} />
          </g>
        ) : null}

        {band === "afternoon" ? (
          <g style={fill("clouds")}>
            <ellipse cx="470" cy="56" rx="60" ry="13" />
            <ellipse cx="505" cy="47" rx="34" ry="12" />
            <ellipse cx="300" cy="80" rx="48" ry="10" />
          </g>
        ) : null}

        {birds ? (
          <g style={{ stroke: "var(--scene-birds)" }} strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
            {birds.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        ) : null}

        {night ? (
          <>
            <g style={fill("stars")}>{stars(LOW_STARS)}</g>
            <circle cx="300" cy="90" r=".9" opacity=".5" style={fill("extra-star")} />
            <g data-moon="">
              <circle cx="690" cy="46" r="60" fill={`url(#${glow})`} />
              <path
                d="M690 28 A18 18 0 1 0 708 50 A14 14 0 1 1 690 28 Z"
                style={{ fill: "var(--scene-moon)", stroke: "var(--scene-moon-edge)" }}
                strokeWidth="1"
              />
            </g>
            <g style={fill("stars")}>{stars(HIGH_STARS)}</g>
          </>
        ) : null}

        <path d={MOUNTAINS} style={fill("mountains")} />
        <path d={MID_HILL} style={fill("mid-hill")} />
        {band === "morning" ? <ellipse cx="430" cy="160" rx="460" ry="18" style={fill("mist")} /> : null}
        <path d={NEAR_HILL} style={fill("near-hill")} />
        <g style={fill("trees")}>
          <rect x="612" y="138" width="3" height="12" />
          <circle cx="613.5" cy="131" r="10" />
          <path d="M646 150 L656 116 L666 150 Z" />
          <path d="M664 152 L672 126 L680 152 Z" />
          <rect x="520" y="146" width="2.5" height="9" />
          <circle cx="521" cy="141" r="7" />
          <path d="M770 146 L779 112 L788 146 Z" />
          <rect x="808" y="128" width="3" height="14" />
          <circle cx="809.5" cy="119" r="13" />
          <rect x="360" y="152" width="2.5" height="8" />
          <circle cx="361" cy="148" r="6" />
          <circle cx="34" cy="166" r="9" />
          <circle cx="50" cy="168" r="7" />
        </g>
      </svg>
    </>
  );
}
