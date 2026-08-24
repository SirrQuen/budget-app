"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "goal-pct-";
const MILESTONES = [25, 50, 75, 100] as const;
type Milestone = (typeof MILESTONES)[number];

function readStoredPct(goalId: string): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + goalId);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  } catch {
    // Private window or storage disabled -- treat as "never seen" and move on.
    return null;
  }
}

function writeStoredPct(goalId: string, pct: number) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + goalId, String(pct));
  } catch {
    // Same as above -- the meter still renders correctly, it just won't
    // remember this value for next visit.
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Highest milestone newly crossed between two readings -- a jump from 10%
// to 80% in one contribution names 75, not 25, and a drop never fires one.
function crossedMilestone(from: number, to: number): Milestone | null {
  let hit: Milestone | null = null;
  for (const m of MILESTONES) {
    if (from < m && to >= m) hit = m;
  }
  return hit;
}

function milestoneMessage(goalName: string, pct: Milestone): string {
  switch (pct) {
    case 100:
      return `${goalName} is fully funded`;
    case 75:
      return `${goalName} is three-quarters there`;
    case 50:
      return `${goalName} is halfway there`;
    default:
      return `${goalName} is a quarter there`;
  }
}

type ConfettiPiece = { x: number; r: number; delay: number; color: string };

const CONFETTI_COLORS = ["var(--gold)", "var(--good)", "var(--cat-3)", "var(--cat-7)"];
const CONFETTI_COUNT = 12;

// Randomised here, in an event/effect context, never during render --
// React Compiler forbids calling Math.random while rendering.
function makeConfettiPieces(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    x: Math.round((Math.random() - 0.5) * 70),
    r: Math.round((Math.random() - 0.5) * 320),
    delay: Math.round(Math.random() * 80),
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  }));
}

export function GoalMeter({
  goalId,
  goalName,
  value,
  onMilestone,
}: {
  goalId: string;
  goalName: string;
  /** 0-100 -- already clamped by v_goal_progress.pct_complete. */
  value: number;
  onMilestone?: (milestone: { pct: number; message: string }) => void;
}) {
  // SSR-safe defaults: the server can't read localStorage or matchMedia, so
  // the first client render has to start from the same neutral state (0%)
  // or React flags a hydration mismatch the moment this goal has a real
  // stored percentage to animate from. The effect below is the earliest
  // point either API is actually read.
  const [displayPct, setDisplayPct] = useState(0);
  const [pulse, setPulse] = useState<number | null>(null);
  const [confetti, setConfetti] = useState<{ key: number; pieces: ConfettiPiece[] } | null>(null);
  const mountTweenDone = useRef(false);

  // "On load" is literal: this compares last-seen to now once per real
  // mount. It deliberately does not re-run when `value` ticks up later in
  // the same session (e.g. after logging a contribution) -- that moment
  // already gets its own dollar-amount celebration from
  // contributeToGoalAction.
  //
  // The read of localStorage, the write back to it, and every setState call
  // all happen inside the single `begin` callback below, deferred via one
  // rAF -- never synchronously in the effect body. That's what makes
  // StrictMode's dev-only double-invoke harmless: cleanup cancels the first
  // pass's rAF before `begin` ever runs, so its read-then-write never
  // happens; only the second pass's `begin` actually fires, and it reads
  // the real last-seen value rather than a value the first pass already
  // overwrote.
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let raf3 = 0;

    const begin = () => {
      const reducedMotion = prefersReducedMotion();
      const from = reducedMotion ? value : (readStoredPct(goalId) ?? 0);
      const milestone = crossedMilestone(from, value);

      // The text banner fires regardless of motion preference -- only the
      // visual fill animation, pulse ring, and confetti are motion-gated.
      if (milestone !== null) {
        onMilestone?.({ pct: milestone, message: milestoneMessage(goalName, milestone) });
      }

      writeStoredPct(goalId, value);

      if (reducedMotion) {
        setDisplayPct(value);
        mountTweenDone.current = true;
        return;
      }

      // Commit the true from-value paint (displayPct started at 0 for
      // hydration safety, so this is the first time it reflects the real
      // last-seen percentage), then two more rAFs let that paint land
      // before flipping to `value`, so the CSS transition has something to
      // interpolate from. The pulse/confetti fire alongside the flip.
      setDisplayPct(from);
      raf2 = requestAnimationFrame(() => {
        raf3 = requestAnimationFrame(() => {
          setDisplayPct(value);
          mountTweenDone.current = true;
          if (milestone !== null) {
            setPulse(Date.now());
            if (milestone === 100) setConfetti({ key: Date.now(), pieces: makeConfettiPieces() });
          }
        });
      });
    };

    raf1 = requestAnimationFrame(begin);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cancelAnimationFrame(raf3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps the fill live for the rest of the meter's lifetime: once the
  // mount tween above has resolved, a later `value` change (e.g. a
  // revalidated page after logging a contribution) still needs to reach the
  // bar -- it just does so directly, without replaying the last-seen
  // animation or re-checking milestones, since "on load" only means once.
  useEffect(() => {
    if (!mountTweenDone.current) return;
    setDisplayPct(value);
  }, [value]);

  useEffect(() => {
    if (pulse === null) return;
    const t = setTimeout(() => setPulse(null), 900);
    return () => clearTimeout(t);
  }, [pulse]);

  useEffect(() => {
    if (confetti === null) return;
    const t = setTimeout(() => setConfetti(null), 900);
    return () => clearTimeout(t);
  }, [confetti]);

  // Continuous, not threshold-snapped -- negligible below ~30%, pronounced
  // near 100%. Cubic so the low end stays visually flat. Tracks displayPct
  // (the animating value), so the glow blooms in step with the fill instead
  // of jumping in once the animation lands.
  const t = Math.min(1, Math.max(0, displayPct / 100));
  const glow = t * t * t;
  const glowShadow = `0 0 ${(4 + glow * 20).toFixed(1)}px ${(glow * 6).toFixed(1)}px color-mix(in srgb, var(--good) ${Math.round(glow * 90)}%, transparent)`;

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-ink-secondary">{goalName}</span>
        <span className="font-semibold tabular-nums text-ink">{Math.round(value)}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={goalName}
        className="relative h-2 w-full overflow-visible rounded-full"
        style={{ backgroundColor: "color-mix(in srgb, var(--good) 22%, var(--page))" }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full transition-[width,box-shadow] duration-[600ms] ease-out motion-reduce:transition-none"
            style={{ width: `${displayPct}%`, backgroundColor: "var(--good)", boxShadow: glowShadow }}
          />
        </div>
        {pulse !== null ? (
          <div
            key={pulse}
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 rounded-full motion-safe:animate-[goal-pulse_900ms_ease-out_1]"
            style={{ width: `${displayPct}%` }}
          />
        ) : null}
        {confetti !== null ? <ConfettiBurst key={confetti.key} pieces={confetti.pieces} /> : null}
      </div>
    </div>
  );
}

// The only place confetti fires in the app -- kept local to GoalMeter (not
// exported) so nothing else can reach for it. Pieces are generated once by
// the caller (in the milestone effect, not during render) and handed down.
function ConfettiBurst({ pieces }: { pieces: ConfettiPiece[] }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute -top-1 left-1/2 h-0 w-0">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute h-1.5 w-1.5 rounded-[1px] motion-safe:animate-[goal-confetti_800ms_ease-out_1]"
          style={
            {
              backgroundColor: p.color,
              animationDelay: `${p.delay}ms`,
              "--x": `${p.x}px`,
              "--r": `${p.r}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
