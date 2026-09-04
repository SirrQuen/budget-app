"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/lib/auth/actions";
import { StreakBadge } from "@/components/ui/StreakBadge";
import { HomeIcon, ListIcon, WalletIcon, TagIcon, PieIcon, TargetIcon, RepeatIcon, SettingsIcon, MenuIcon, CloseIcon, type IconProps } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { QuickAddBar } from "@/components/quick-add/QuickAddBar";
import { OptimisticTransactionsProvider } from "@/components/quick-add/OptimisticTransactionsContext";
import type { TransactionAccountOption } from "@/app/(app)/transactions/AddTransactionForm";
import type { CategoryWithGroup } from "@/lib/db/categories";

export type QuickAddData = {
  accounts: TransactionAccountOption[];
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  defaultAccountId: string | null;
};

const NAV_ITEMS: { href: string; label: string; icon: (props: IconProps) => React.ReactNode }[] = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/transactions", label: "Transactions", icon: ListIcon },
  { href: "/accounts", label: "Accounts", icon: WalletIcon },
  { href: "/categories", label: "Categories", icon: TagIcon },
  { href: "/budgets", label: "Budgets", icon: PieIcon },
  { href: "/goals", label: "Goals", icon: TargetIcon },
  { href: "/recurring", label: "Recurring", icon: RepeatIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell({
  userEmail,
  streak,
  quickAdd,
  children,
}: {
  userEmail: string;
  /** null once a user has never logged a transaction -- nothing to show yet. */
  streak: { current: number; best: number; loggedToday: boolean } | null;
  /** null if any of its data failed to load -- the page still renders without it. */
  quickAdd: QuickAddData | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-page text-ink md:flex">
      {/* First tab stop on every authenticated page -- jumps past the nav
          straight to the page content. Visually hidden until focused. */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-lg focus-visible:bg-action focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-action-ink focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
      >
        Skip to main content
      </a>
      <header className="flex items-center justify-between border-b border-hairline bg-page px-4 py-3 md:hidden">
        <span className="text-lg font-semibold">EverNest Finance</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 text-ink-secondary transition-colors duration-150 hover:bg-surface hover:text-ink active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          {open ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
        </button>
      </header>

      <aside
        className={`${open ? "flex" : "hidden"} flex-col gap-6 border-b border-hairline bg-page px-4 pb-4 md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:shrink-0 md:border-b-0 md:border-r md:py-6`}
      >
        <div className="flex flex-col gap-6">
          <span className="hidden px-2 text-lg font-semibold text-ink md:block">
            EverNest Finance
          </span>
          {streak ? (
            <StreakBadge days={streak.current} best={streak.best} loggedToday={streak.loggedToday} />
          ) : null}
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page ${
                    active
                      ? "bg-surface text-ink"
                      : "text-ink-secondary hover:bg-surface hover:text-ink"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto flex flex-col gap-1 border-t border-hairline pt-4">
          {/* Same provider as the settings page, so the two controls never
              disagree. Icon-only here -- the rail is 15rem wide and three
              labelled segments would crowd the account block. */}
          <div className="px-3 pb-3">
            <ThemeToggle variant="compact" />
          </div>
          <p className="truncate px-3 text-sm text-ink-secondary">{userEmail}</p>
          <form action={logout}>
            <button
              type="submit"
              className="min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-ink-secondary transition-colors duration-150 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page"
            >
              Log out
            </button>
          </form>
        </div>
      </aside>

      <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-8 md:py-8">
        <OptimisticTransactionsProvider>
          {quickAdd ? (
            <QuickAddBar
              accounts={quickAdd.accounts}
              incomeCategories={quickAdd.incomeCategories}
              expenseCategories={quickAdd.expenseCategories}
              defaultAccountId={quickAdd.defaultAccountId}
              navOpen={open}
            />
          ) : null}
          {children}
        </OptimisticTransactionsProvider>
      </main>
    </div>
  );
}
