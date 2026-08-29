// Shared between the theme Server Action (validation), the settings page
// (rendering) and the first-paint script (inlined into the document) -- no
// "server-only" import, so the client control can pull the same source of
// truth.

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

// "System" is the default: absent an explicit choice we defer to
// prefers-color-scheme, which is what app/globals.css keys off when no
// data-theme attribute is present.
export const DEFAULT_THEME: Theme = "system";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

// The DB column is a plain text column, so a row written before the
// settings_theme_valid constraint landed (or by some future code path)
// can hold anything. Anything unrecognised reads as "system" rather than
// throwing -- a bad settings value must never be able to break a render.
export function coerceTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

export const THEME_STORAGE_KEY = "evernest-theme";

export const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

// Applies a theme to the document. "system" clears the attribute rather
// than writing a value, which is what hands control back to the
// prefers-color-scheme block in globals.css.
export function applyTheme(theme: Theme) {
  const root = document.documentElement;

  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

// Inlined verbatim into the document by app/layout.tsx and run before the
// body renders, so the correct palette is in place for the first paint
// instead of arriving a frame later as a flash of the wrong theme.
//
// localStorage is a cache, never the source of truth -- the settings row
// is. It exists only to close that first-paint gap; ThemeProvider
// reconciles it against the account's stored value on mount, which is how
// a device that has never seen this account still lands on the right
// theme (one paint later, since there is nothing local to read).
//
// Every access is wrapped: reading localStorage throws outright in some
// privacy configurations, and a throw here would leave the document blank.
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.removeAttribute("data-theme")}}catch(e){}})();`;
