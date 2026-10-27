// The input that dismisses an overlay is CONSUMED, never passed through:
// someone clicking through a dimmed overlay can't see what they're
// hitting, and firing an action they didn't intend is worse than one extra
// click. First input dismisses, second acts.
//
// Consuming the first event isn't enough: a click is pointerdown, then
// mousedown, pointerup, mouseup and click, and the overlay is gone by the
// time the rest arrive -- so the rest would land on the page. The whole
// gesture is swallowed: until its last event (click for a pointer, keyup
// for a key) or a short timeout, whichever comes first.
//
// Listening on window in the capture phase, so these run before anything
// on the page, React's root listener included.

const DISMISS_EVENTS = ["pointerdown", "mousedown", "touchstart", "keydown", "wheel"] as const;

type Gesture = { events: string[]; endsOn: string | null; timeoutMs: number };

const POINTER: Gesture = {
  events: ["pointerdown", "mousedown", "touchend", "pointerup", "mouseup", "click", "auxclick", "contextmenu"],
  endsOn: "click",
  timeoutMs: 1000,
};
const KEY: Gesture = { events: ["keydown", "keypress", "keyup"], endsOn: "keyup", timeoutMs: 1000 };
// A wheel "gesture" is a burst of events with no end event.
const WHEEL: Gesture = { events: ["wheel"], endsOn: null, timeoutMs: 300 };

function gestureFor(type: string): Gesture {
  if (type === "keydown") return KEY;
  if (type === "wheel") return WHEEL;
  return POINTER;
}

const OPTIONS = { capture: true, passive: false } as const;

function consume(event: Event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/**
 * Calls `onDismiss` on the first input, consuming it and the rest of its
 * gesture. Returns a cleanup that stops listening for that first input; a
 * gesture already being swallowed finishes on its own, so an overlay that
 * unmounts on dismiss can't let the tail of its click through.
 */
export function consumeFirstInput(target: EventTarget, onDismiss: () => void): () => void {
  let armed = true;

  const swallow = (gesture: Gesture) => {
    const handler = (event: Event) => {
      consume(event);
      if (event.type === gesture.endsOn) stop();
    };
    const stop = () => {
      clearTimeout(timer);
      for (const type of gesture.events) target.removeEventListener(type, handler, OPTIONS);
    };
    for (const type of gesture.events) target.addEventListener(type, handler, OPTIONS);
    const timer = setTimeout(stop, gesture.timeoutMs);
  };

  const first = (event: Event) => {
    if (!armed) return;
    armed = false;
    consume(event);
    disarm();
    swallow(gestureFor(event.type));
    onDismiss();
  };

  const disarm = () => {
    for (const type of DISMISS_EVENTS) target.removeEventListener(type, first, OPTIONS);
  };

  for (const type of DISMISS_EVENTS) target.addEventListener(type, first, OPTIONS);
  return () => {
    armed = false;
    disarm();
  };
}
