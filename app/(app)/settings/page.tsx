import { PageHeader } from "@/components/ui/PageHeader";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="How EverNest looks and behaves for you." />

      <section
        aria-labelledby="appearance-heading"
        className="rounded-2xl border border-hairline bg-surface p-5"
      >
        <h2 id="appearance-heading" className="text-base font-semibold text-ink">
          Appearance
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-secondary">
          System follows your device. Pick Light or Dark to override it — your choice follows your
          account to every device you sign in on.
        </p>

        {/* The control reads and writes through ThemeProvider, mounted in
            app/(app)/layout.tsx, so this and the nav copy stay in step. */}
        <ThemeToggle className="mt-4" />
      </section>
    </div>
  );
}
