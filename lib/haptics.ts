// A light tick where the platform has one (Android Chrome). iPhone Safari
// has no vibrate(), which is fine -- nothing depends on it, so it never
// throws and never says it didn't happen.
export function tick(ms = 10): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch {
    // A blocked or unsupported vibrate is not an error.
  }
}
