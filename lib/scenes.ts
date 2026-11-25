import type { TimeBand } from "@/lib/timeOfDay";

// The dashboard scene's colours (docs/Scenes.md), taken from the design board
// docs/design/scenes-reference.html. Illustration colours, local to this one
// drawing like the roselle's: not theme tokens, and nothing to do with money.
//
// One drawing per band serves both themes: every fill is a custom property, and
// sceneCss() writes each band's light values with the dark ones under the same
// two selectors the theme tokens use (app/globals.css). Switching theme swaps
// colours with no second SVG.

type Stops = readonly (readonly [offset: number, hex: string])[];

type Palette = {
  sky: Stops;
  /** The sun's radial glow, at 0 / 40 / 100%. Unused at night. */
  glow: readonly [string, string, string];
  sun: string;
  birds: string;
  clouds: string;
  mist: string;
  mountains: string;
  midHill: string;
  nearHill: string;
  trees: string;
  stars: string;
  /** The one star only the dark night has. */
  extraStar: string;
  moon: string;
  moonEdge: string;
  moonHalo: string;
  /**
   * The fade behind the words: "r g b" and its strength at the left edge.
   * Morning and afternoon dark are 0.6 (were 0.5): a greeting reaching
   * 320px into the banner crossed their brighter sky at 4.41:1 on a strict
   * per-pixel check (docs/Backdrop.md, "Rulings").
   */
  scrim: string;
  scrimAlpha: number;
  /**
   * The ground below the scene, behind the cards (docs/Backdrop.md): 0%, 45%
   * and 100% of the way from the near hill to the bottom of the screen. The
   * first stop is the near hill's own colour, so there is no seam.
   */
  ground: readonly [string, string, string];
  /** The two soft ellipses in the top of the ground. */
  meadow: string;
};

const NONE = "transparent";
const blank = {
  glow: [NONE, NONE, NONE],
  sun: NONE,
  birds: NONE,
  clouds: NONE,
  mist: NONE,
  stars: NONE,
  extraStar: NONE,
  moon: NONE,
  moonEdge: NONE,
  moonHalo: NONE,
} as const;

const DARK_SCRIM = "11 11 18";
const LIGHT_SCRIM = "255 255 255";
const DARK_MEADOW = "rgb(255 255 255 / 0.05)";
const LIGHT_MEADOW = "rgb(255 255 255 / 0.28)";

export const SCENE_PALETTES: Record<TimeBand, { light: Palette; dark: Palette }> = {
  morning: {
    dark: {
      ...blank,
      sky: [[0, "#1B1E3A"], [55, "#5B4A6B"], [100, "#E7A46B"]],
      glow: ["rgb(255 226 168 / 1)", "rgb(255 196 122 / 0.7)", "rgb(255 196 122 / 0)"],
      sun: "#FFD796",
      birds: "rgb(246 244 248 / 0.55)",
      mist: "rgb(255 236 214 / 0.14)",
      mountains: "#3A3F62",
      midHill: "#2C3550",
      nearHill: "#1E2638",
      trees: "#161D2E",
      scrim: DARK_SCRIM,
      scrimAlpha: 0.6,
      ground: ["#1E2638", "#151B2A", "#0E1119"],
      meadow: DARK_MEADOW,
    },
    light: {
      ...blank,
      sky: [[0, "#D6E4F2"], [60, "#F6E3D4"], [100, "#F7CFAE"]],
      glow: ["rgb(255 241 210 / 1)", "rgb(249 201 140 / 0.6)", "rgb(249 201 140 / 0)"],
      sun: "#F6B26B",
      birds: "#5A6478",
      mist: "rgb(255 255 255 / 0.55)",
      mountains: "#D1D9E6",
      midHill: "#C3CEDB",
      nearHill: "#A9B9C9",
      trees: "#8FA2B5",
      scrim: LIGHT_SCRIM,
      scrimAlpha: 0.5,
      ground: ["#A9B9C9", "#C3CFDB", "#E2E8EF"],
      meadow: LIGHT_MEADOW,
    },
  },
  afternoon: {
    dark: {
      ...blank,
      sky: [[0, "#12304A"], [60, "#2C6280"], [100, "#8FB9BE"]],
      glow: ["rgb(255 242 200 / 1)", "rgb(255 227 160 / 0.55)", "rgb(255 227 160 / 0)"],
      sun: "#FFE9B0",
      birds: "rgb(246 244 248 / 0.55)",
      clouds: "rgb(255 255 255 / 0.2)",
      mountains: "#2F5A6F",
      midHill: "#24485A",
      nearHill: "#173342",
      trees: "#10283A",
      scrim: DARK_SCRIM,
      scrimAlpha: 0.6,
      ground: ["#173342", "#10232F", "#0B141B"],
      meadow: DARK_MEADOW,
    },
    light: {
      ...blank,
      sky: [[0, "#BCDCF2"], [65, "#E6F2F8"], [100, "#F6F0DE"]],
      glow: ["rgb(255 246 216 / 1)", "rgb(252 226 154 / 0.6)", "rgb(252 226 154 / 0)"],
      sun: "#F7C766",
      birds: "#5A6478",
      clouds: "rgb(255 255 255 / 0.85)",
      mountains: "#C3D8E2",
      midHill: "#B5CFBE",
      nearHill: "#97BBA2",
      trees: "#7FA98C",
      scrim: LIGHT_SCRIM,
      scrimAlpha: 0.5,
      ground: ["#97BBA2", "#B7D0BE", "#DCE9DF"],
      meadow: LIGHT_MEADOW,
    },
  },
  evening: {
    dark: {
      ...blank,
      sky: [[0, "#211838"], [55, "#6A2D5C"], [100, "#DB7046"]],
      glow: ["rgb(255 192 138 / 1)", "rgb(255 143 90 / 0.6)", "rgb(255 143 90 / 0)"],
      sun: "#FF9E5E",
      mountains: "#4A2C55",
      midHill: "#3A2445",
      nearHill: "#22152C",
      trees: "#1A1022",
      scrim: DARK_SCRIM,
      scrimAlpha: 0.5,
      ground: ["#22152C", "#181020", "#0F0A15"],
      meadow: DARK_MEADOW,
    },
    light: {
      ...blank,
      sky: [[0, "#D7C8EA"], [60, "#F2CDC4"], [100, "#F8D6B2"]],
      glow: ["rgb(255 224 194 / 1)", "rgb(244 165 122 / 0.55)", "rgb(244 165 122 / 0)"],
      sun: "#F29A6B",
      mountains: "#D9C3DC",
      midHill: "#CBB4D0",
      nearHill: "#B49CBD",
      trees: "#9C84A8",
      scrim: LIGHT_SCRIM,
      scrimAlpha: 0.5,
      ground: ["#B49CBD", "#CBB8D2", "#E6DCE9"],
      meadow: LIGHT_MEADOW,
    },
  },
  night: {
    // The board's one shape difference between themes: the dark night has a
    // halo round the moon, one more star and no scrim; the light night has an
    // edge on its white moon.
    dark: {
      ...blank,
      sky: [[0, "#070A1A"], [60, "#121B3A"], [100, "#1E2A52"]],
      stars: "#D9DCEB",
      extraStar: "#D9DCEB",
      moon: "#E9ECF7",
      moonHalo: "#E9ECF7",
      mountains: "#1A2342",
      midHill: "#141B33",
      nearHill: "#0B1022",
      trees: "#070B18",
      scrim: DARK_SCRIM,
      scrimAlpha: 0,
      ground: ["#0B1022", "#080B17", "#06080F"],
      meadow: DARK_MEADOW,
    },
    light: {
      ...blank,
      sky: [[0, "#C5CCEC"], [60, "#DADFF5"], [100, "#E9EBF8"]],
      stars: "#7F89BD",
      moon: "#FFFFFF",
      moonEdge: "rgb(90 100 160 / 0.35)",
      mountains: "#C2C9E8",
      midHill: "#B3BBE0",
      nearHill: "#9EA8D4",
      trees: "#8C97C9",
      scrim: LIGHT_SCRIM,
      scrimAlpha: 0.45,
      ground: ["#9EA8D4", "#BAC2E2", "#DDE1F2"],
      meadow: LIGHT_MEADOW,
    },
  },
};

/** The colour a linear gradient shows at `offset` (sRGB, as SVG blends it). */
export function sampleStops(stops: Stops, offset: number): string {
  const after = stops.findIndex(([o]) => o >= offset);
  if (after <= 0) return stops[after === 0 ? 0 : stops.length - 1][1];
  const [o0, c0] = stops[after - 1];
  const [o1, c1] = stops[after];
  const t = (offset - o0) / (o1 - o0);
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mixed = [0, 1, 2].map((i) =>
    Math.round(channel(c0, i) + (channel(c1, i) - channel(c0, i)) * t)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${mixed.join("")}`.toUpperCase();
}

/**
 * The sky's stop positions for one band. The board's two themes put the middle
 * stop at different heights, and CSS can't move a stop, so the one gradient has
 * both positions; each theme's extra stop is the colour it already shows there.
 */
export function skyOffsets(band: TimeBand): number[] {
  const { light, dark } = SCENE_PALETTES[band];
  return [...new Set([...light.sky, ...dark.sky].map(([o]) => o))].sort((a, b) => a - b);
}

function declarations(band: TimeBand, p: Palette): string {
  const vars: [string, string | number][] = [
    ...skyOffsets(band).map((o, i): [string, string] => [`sky-${i + 1}`, sampleStops(p.sky, o)]),
    ["glow-1", p.glow[0]],
    ["glow-2", p.glow[1]],
    ["glow-3", p.glow[2]],
    ["sun", p.sun],
    ["birds", p.birds],
    ["clouds", p.clouds],
    ["mist", p.mist],
    ["mountains", p.mountains],
    ["mid-hill", p.midHill],
    ["near-hill", p.nearHill],
    ["trees", p.trees],
    ["stars", p.stars],
    ["extra-star", p.extraStar],
    ["moon", p.moon],
    ["moon-edge", p.moonEdge],
    ["moon-halo", p.moonHalo],
    ["scrim", p.scrim],
    ["scrim-alpha", p.scrimAlpha],
    ["ground-1", p.ground[0]],
    ["ground-2", p.ground[1]],
    ["ground-3", p.ground[2]],
    ["meadow", p.meadow],
  ];
  return vars.map(([name, value]) => `--scene-${name}:${value}`).join(";");
}

/** One band's custom properties for both themes, scoped to its layer. */
export function sceneCss(band: TimeBand): string {
  const { light, dark } = SCENE_PALETTES[band];
  const layer = `.scene--${band}`;
  const darkVars = declarations(band, dark);
  return [
    `${layer}{${declarations(band, light)}}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) ${layer}{${darkVars}}}`,
    `:root[data-theme="dark"] ${layer}{${darkVars}}`,
  ].join("\n");
}
