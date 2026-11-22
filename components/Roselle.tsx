import { useId } from "react";
import type { PlantState } from "@/lib/plant";

// The dashboard's living plant: roselle, the Jamaican sorrel. The drawing is
// docs/design/roselle-reference.html, path for path ("Round 3 · The sorrel,
// alive"); its looping keyframes became single-play (app/globals.css,
// "ROSELLE"). Open and closed are the board's day and night panels.
//
// Not the brand mark. The three-leaflet mark (SorrelMark, and the
// SorrelFlower the welcome bloom and goal completion use) is unchanged.
// These reds are a plant, never money: colours are local constants here, as
// the board has them.

export type RoselleMotion = "opening" | "closing" | null;

const VIEW_W = 240;
const VIEW_H = 280;

// The board's two palettes: day (open) and night (closed).
const PALETTE = {
  open: {
    leaf: ["#3F7A48", "#86B97E"],
    petal: ["#E49C8C", "#F1C6B3", "#F7DEC9"],
    eye: ["#5E0716", "#B0122A", "#D62A36"],
    calyx: ["#6E0A1C", "#A8132B", "#D3263A"],
    stem: "#6E1424",
    branchlet: "#8A2233",
    collar: "#8A1426",
    shine: "rgba(255,255,255,.45)",
    petalEdge: "rgba(190,140,125,.35)",
    centre: "#E8B44A",
  },
  closed: {
    leaf: ["#2F5B44", "#6A9677"],
    petal: ["#C48678", "#D9AE9D", "#E6CBB9"],
    eye: ["#6A0A1B", "#A51A2C", "#BC3D37"],
    calyx: ["#5A0817", "#8E1126", "#B42235"],
    stem: "#5A1220",
    branchlet: "#741D2C",
    collar: "#74101F",
    shine: "rgba(217,220,235,.45)",
    petalEdge: "rgba(170,130,120,.35)",
    centre: "#D9A43F",
  },
} as const;

const LEAF =
  "M0 0 C-4 -6 -6 -14 -14 -26 C-20 -34 -22 -40 -16 -40 C-10 -40 -6 -32 -3 -26 C-4 -38 -4 -48 0 -56 C4 -48 4 -38 3 -26 C6 -32 10 -40 16 -40 C22 -40 20 -34 14 -26 C6 -14 4 -6 0 0 Z";
const LEAF_VEINS = "M0 0 L0 -52 M0 -6 L-15 -37 M0 -6 L15 -37";
const TIP_LEAF = "M0 0 C-3 -10 -5 -26 0 -48 C5 -26 3 -10 0 0 Z";
const CALYX = "M0 0 C-12 -2 -16 -14 -12 -26 L-14 -40 L-7 -30 L-4 -44 L0 -32 L4 -44 L7 -30 L14 -40 L12 -26 C16 -14 12 -2 0 0 Z";
const COLLAR = "M-10 -2 L-17 4 M10 -2 L17 4 M-6 1 L-11 9 M6 1 L11 9 M0 2 L0 10";
const SEPAL = "M0 0 C-5 -10 -7 -24 -4 -34 L0 -52 L4 -34 C7 -24 5 -10 0 0 Z";
const PETAL = "M0 0 C-14 -6 -22 -22 -16 -36 C-12 -44 -4 -46 0 -42 C4 -46 12 -44 16 -36 C22 -22 14 -6 0 0 Z";
const EYE_RAYS = "M0 -16 L0 -9 M15.2 -4.9 L8.6 -2.8 M9.4 12.9 L5.3 7.3 M-9.4 12.9 L-5.3 7.3 M-15.2 -4.9 L-8.6 -2.8";

const SEPAL_ANGLES = [36, 108, 180, 252, 324];
const PETAL_ANGLES = [0, 72, 144, 216, 288];

type Props = {
  /** The pose at rest; also picks the palette. */
  pose: PlantState;
  /** A one-shot change into `pose`; null is at rest. */
  motion?: RoselleMotion;
  /** Rendered height in px. Width follows the board's 240:280. */
  height: number;
  /** Overrides the size by CSS (a responsive height); height stays the fallback. */
  className?: string;
};

function Layer({ palette, uid }: { palette: PlantState; uid: string }) {
  const c = PALETTE[palette];
  const id = (name: string) => `roselle-${palette}-${name}-${uid}`;
  const ref = (name: string) => `url(#${id(name)})`;
  return (
    <g className={`roselle__layer roselle__layer--${palette}`}>
      <defs>
          <linearGradient id={id("lf")} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={c.leaf[0]} />
            <stop offset="100%" stopColor={c.leaf[1]} />
          </linearGradient>
          <radialGradient id={id("pt")} cx="50%" cy="100%" r="100%">
            <stop offset="0%" stopColor={c.petal[0]} />
            <stop offset="45%" stopColor={c.petal[1]} />
            <stop offset="100%" stopColor={c.petal[2]} />
          </radialGradient>
          <radialGradient id={id("eye")}>
            <stop offset="0%" stopColor={c.eye[0]} />
            <stop offset="55%" stopColor={c.eye[1]} />
            <stop offset="100%" stopColor={c.eye[2]} />
          </radialGradient>
          <linearGradient id={id("cx")} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={c.calyx[0]} />
            <stop offset="55%" stopColor={c.calyx[1]} />
            <stop offset="100%" stopColor={c.calyx[2]} />
          </linearGradient>
        </defs>

        {/* Stems */}
        <path d="M120 280 C116 230 124 170 118 110 C114 80 118 50 122 30" stroke={c.stem} strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M119 122 C135 110 150 98 158 86" stroke={c.stem} strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path d="M118 152 C104 142 92 128 86 114" stroke={c.stem} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M120 194 C134 190 146 180 152 170" stroke={c.stem} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path
          d="M119 214 C104 212 86 206 74 200 M121 228 C140 228 160 222 172 216 M119 262 C104 262 82 256 66 250"
          stroke={c.branchlet}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />

        {/* Leaves: they lift on opening and relax about 14deg on closing */}
        <g transform="translate(74 200) rotate(-62)">
          <g className="roselle__lv roselle__lv--l">
            <path d={LEAF} fill={ref("lf")} />
            <path d={LEAF_VEINS} stroke={c.branchlet} strokeWidth=".9" fill="none" opacity=".75" />
          </g>
        </g>
        <g transform="translate(172 216) rotate(64)">
          <g className="roselle__lv roselle__lv--r">
            <path d={LEAF} fill={ref("lf")} />
            <path d={LEAF_VEINS} stroke={c.branchlet} strokeWidth=".9" fill="none" opacity=".75" />
          </g>
        </g>
        <g transform="translate(66 250) rotate(-78) scale(.85)">
          <g className="roselle__lv roselle__lv--l">
            <path d={LEAF} fill={ref("lf")} />
            <path d={LEAF_VEINS} stroke={c.branchlet} strokeWidth=".9" fill="none" opacity=".75" />
          </g>
        </g>
        <g transform="translate(122 34) rotate(-8) scale(.7)">
          <g className="roselle__lv roselle__lv--r">
            <path d={TIP_LEAF} fill={ref("lf")} />
          </g>
        </g>

        {/* The stem calyces: the constant. They never animate. */}
        <g data-calyx="" transform="translate(86 116) rotate(-22) scale(1.288)">
          <path d={COLLAR} stroke={c.collar} strokeWidth="1.6" strokeLinecap="round" />
          <path d={CALYX} fill={ref("cx")} />
          <path d="M-6 -8 C-8 -14 -7 -20 -4 -24" stroke={c.shine} strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
        <g data-calyx="" transform="translate(152 172) rotate(26) scale(.952)">
          <path d={COLLAR} stroke={c.collar} strokeWidth="1.6" strokeLinecap="round" />
          <path d={CALYX} fill={ref("cx")} />
          <path d="M-6 -8 C-8 -14 -7 -20 -4 -24" stroke={c.shine} strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>

        {/* The flower: its own calyx, the red pointed sepals, the pale petals
            and the crimson eye with its gold centre */}
        <g transform="translate(160 92) scale(.77)">
          <path d={CALYX} fill={ref("cx")} />
        </g>
        <g transform="translate(160 74)">
          {SEPAL_ANGLES.map((a) => (
            <path key={`s${a}`} className="roselle__pt" style={{ "--a": `${a}deg` } as React.CSSProperties} d={SEPAL} fill={ref("cx")} />
          ))}
          {PETAL_ANGLES.map((a) => (
            <path
              key={`p${a}`}
              className="roselle__pt roselle__petal"
              style={{ "--a": `${a}deg` } as React.CSSProperties}
              d={PETAL}
              fill={ref("pt")}
              stroke={c.petalEdge}
              strokeWidth=".6"
            />
          ))}
          <g className="roselle__eye">
            <circle r="16" fill={ref("eye")} />
            <path d={EYE_RAYS} stroke={c.eye[0]} strokeWidth="1.4" strokeLinecap="round" opacity=".7" />
            <circle cx="-5" cy="-6" r="3" fill="rgba(255,255,255,.28)" />
            <circle r="4.4" fill={c.centre} />
            <circle cx="-1.6" cy="-1.4" r=".9" fill="#F3CF7A" />
            <circle cx="1.8" cy="-1" r=".9" fill="#F3CF7A" />
            <circle cx="0" cy="1.8" r=".9" fill="#F3CF7A" />
          </g>
        </g>
    </g>
  );
}

/**
 * Decorative: aria-hidden, not focusable. Every calyx is drawn at every size
 * -- the plant scales as a whole (`height`), it never drops one.
 *
 * Two complete drawings are stacked, the day palette and the night palette,
 * so a change can cross-fade them (opacity) while the transforms run -- a
 * gradient can't be animated. The one for `pose` is painted last, so it
 * fades in OVER the other, which holds until the end: no mid-fade dip.
 * At rest the other layer is at opacity 0 (app/globals.css, "ROSELLE").
 */
export function Roselle({ pose, motion = null, height, className }: Props) {
  const uid = useId().replace(/[^\w-]/g, "");
  const classes = ["roselle", `roselle--${pose}`, motion && `roselle--${motion}`, className].filter(Boolean).join(" ");
  const outgoing = pose === "open" ? "closed" : "open";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={(height * VIEW_W) / VIEW_H}
      height={height}
      aria-hidden="true"
      focusable="false"
      className={classes}
      style={{ overflow: "visible" }}
    >
      <Layer palette={outgoing} uid={uid} />
      <Layer palette={pose} uid={uid} />
    </svg>
  );
}
