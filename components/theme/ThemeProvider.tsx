"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { setThemeAction } from "@/lib/actions/settings";
import { applyTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** True while the choice is being written to the account. */
  saving: boolean;
  /** Set when the write failed -- the local theme still changed. */
  error: string | null;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const value = useContext(ThemeContext);

  if (!value) {
    throw new Error("useTheme must be used inside ThemeProvider.");
  }

  return value;
}

export function ThemeProvider({
  stored,
  children,
}: {
  /** The account's theme, read from the settings row on the server. */
  stored: Theme;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(stored);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const reconciled = useRef(false);

  // The settings row is the source of truth; localStorage is only the
  // first-paint cache. On mount, push the account's value over whatever
  // the inline script read locally -- that's what makes a choice made on
  // one device show up on another, which has no localStorage for it yet.
  //
  // Mount only. After this, local state leads: re-running when `stored`
  // changes would let a revalidation land mid-click and stomp the choice
  // the user just made with the value the server hasn't caught up to.
  useEffect(() => {
    if (reconciled.current) {
      return;
    }

    reconciled.current = true;
    applyTheme(stored);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, stored);
    } catch {
      // Storage unavailable (private mode, blocked site data). The theme
      // still applies for this page; it just won't survive first paint on
      // the next load, which falls back to the account value on mount.
    }
  }, [stored]);

  const setTheme = useCallback((next: Theme) => {
    // Apply locally first: the control should feel instant, and the write
    // to the account is a background concern that can fail without
    // undoing what the user just chose.
    setThemeState(next);
    applyTheme(next);
    setError(null);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // See above -- a storage failure doesn't block the account write.
    }

    startTransition(async () => {
      const result = await setThemeAction(next);

      if (result?.error) {
        setError(result.error);
      }
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, saving, error }}>
      {children}
    </ThemeContext.Provider>
  );
}
