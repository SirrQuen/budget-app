// Page-lifetime signal: is the dashboard's roselle about to play, or playing?
// The visitor waits on it (components/Visitor.tsx), so the order is the
// welcome bloom, then the roselle opening or closing, then the visitor --
// never two at once. Module state like lib/welcomeSignals.ts, for the same
// reason: the plant and the visitor are siblings in streamed page content.

let busy = false;
const idleListeners = new Set<() => void>();

/** Set by the plant the moment it knows it will play; cleared when it's done (or unmounts). */
export function setPlantBusy(next: boolean) {
  busy = next;
  if (!next) for (const listener of [...idleListeners]) listener();
}

export function isPlantBusy(): boolean {
  return busy;
}

/** Calls `listener` once the plant is not playing (now, if it isn't). */
export function afterPlant(listener: () => void): () => void {
  if (!busy) {
    listener();
    return () => {};
  }
  const once = () => {
    idleListeners.delete(once);
    listener();
  };
  idleListeners.add(once);
  return () => {
    idleListeners.delete(once);
  };
}
