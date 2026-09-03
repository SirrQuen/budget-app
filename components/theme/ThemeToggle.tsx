"use client";

import { useTheme } from "@/components/theme/ThemeProvider";
import {
  MoonIcon,
  SunIcon,
  MonitorIcon,
  WarningIcon,
  type IconProps,
} from "@/components/ui/icons";
import { THEMES, THEME_LABELS, type Theme } from "@/lib/theme";

const THEME_ICONS: Record<Theme, (props: IconProps) => React.ReactNode> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

// A radiogroup rather than three buttons: these are three states of one
// setting, so arrow-key traversal and a single tab stop are the correct
// keyboard model. aria-checked carries the state -- the fill is decoration
// on top of it, never the only signal.
export function ThemeToggle({
  variant = "full",
  className = "",
}: {
  /** "compact" drops the labels to icons -- for the nav rail. */
  variant?: "full" | "compact";
  className?: string;
}) {
  const { theme, setTheme, saving, error } = useTheme();
  const compact = variant === "compact";

  return (
    <div className={className}>
      <div
        role="radiogroup"
        aria-label="Colour theme"
        className="inline-flex gap-1 rounded-full border border-hairline bg-surface p-1"
      >
        {THEMES.map((option) => {
          const Icon = THEME_ICONS[option];
          const selected = theme === option;

          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              // Only the selected option stays in the tab order; arrow keys
              // move within the group, which is the radiogroup contract.
              tabIndex={selected ? 0 : -1}
              onClick={() => setTheme(option)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                  return;
                }

                event.preventDefault();
                const step = event.key === "ArrowRight" ? 1 : -1;
                const next = THEMES[(THEMES.indexOf(theme) + step + THEMES.length) % THEMES.length];
                setTheme(next);
              }}
              title={compact ? THEME_LABELS[option] : undefined}
              className={`flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                compact ? "h-11 w-11" : "min-h-11 px-4 py-2"
              } ${
                selected
                  ? "bg-action text-action-ink"
                  : "text-ink-secondary hover:bg-surface-raised hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {compact ? (
                <span className="sr-only">{THEME_LABELS[option]}</span>
              ) : (
                THEME_LABELS[option]
              )}
            </button>
          );
        })}
      </div>

      {/* aria-live so the failure is announced -- it arrives after the
          click, not as part of it. The icon carries the status colour and
          the message stays in ink: --critical is a 3:1 mark, not a 4.5:1
          text colour, and status never reads by colour alone. */}
      <div aria-live="polite" className="mt-2 min-h-5 text-sm">
        {error ? (
          <p className="flex items-start gap-2 text-ink-secondary">
            <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden="true" />
            {error}
          </p>
        ) : saving ? (
          <p className="text-ink-muted">Saving…</p>
        ) : null}
      </div>
    </div>
  );
}
