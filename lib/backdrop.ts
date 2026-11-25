// The dashboard backdrop (docs/Backdrop.md): the scene as a fixed layer
// behind the whole dashboard. This is the pure half -- where the fixed layer
// puts the scene so that, at scroll 0, it sits exactly where the in-flow
// banner left room for it, and how far the page scrolls before the scene has
// fully softened. Display only: nothing here is stored.

/** Document positions read from the page, in CSS pixels. */
export type BackdropMeasure = {
  /** The banner's scene slot (the in-flow spacer), relative to the viewport. */
  stageTop: number;
  stageHeight: number;
  /** The first card below the banner, relative to the viewport; null if none. */
  firstCardTop: number | null;
  /** window.scrollY when the rects were read. */
  scrollY: number;
};

export type BackdropGeometry = {
  /** Where the scene band starts in the fixed layer: its document position. */
  sceneTop: number;
  sceneHeight: number;
  /**
   * The scroll over which the scene softens, 0 -> 1: until the first card's
   * top reaches the top of the scene, so the cards have covered the hills.
   */
  softenDistance: number;
};

/** Below this the softening would be a flicker, not a fade. */
export const MIN_SOFTEN_DISTANCE = 120;

/**
 * The fixed layer is positioned in viewport coordinates, which at scroll 0
 * are document coordinates: so the scene goes at the slot's document
 * position, whatever the scroll was when it was read.
 */
export function backdropGeometry(m: BackdropMeasure): BackdropGeometry {
  const sceneTop = Math.round(m.stageTop + m.scrollY);
  const sceneHeight = Math.round(m.stageHeight);
  const cardTop = m.firstCardTop === null ? sceneTop + sceneHeight : Math.round(m.firstCardTop + m.scrollY);
  return {
    sceneTop,
    sceneHeight,
    softenDistance: Math.max(MIN_SOFTEN_DISTANCE, cardTop - sceneTop),
  };
}

/**
 * The tiles that turn to glass: the dashboard's cards (a bordered surface),
 * never one inside another, never a dialog or anything in one, never the card
 * being dragged. app/globals.css ("DASHBOARD BACKDROP") holds the same list.
 */
export const GLASS_TILE =
  ".bg-surface.border-hairline:not(dialog, dialog *, [data-lifted] *, .bg-surface.border-hairline *)";
