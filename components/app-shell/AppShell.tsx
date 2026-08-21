"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/lib/auth/actions";
import { StreakBadge } from "@/components/ui/StreakBadge";
import { HomeIcon, ListIcon, WalletIcon, TagIcon, PieIcon, TargetIcon, MenuIcon, CloseIcon, type IconProps } from "@/components/ui/icons";

const NAV_ITEMS: { href: string; label: string; icon: (props: IconProps) => React.ReactNode }[] = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/transactions", label: "Transactions", icon: ListIcon },
  { href: "/accounts", label: "Accounts", icon: WalletIcon },
  { href: "/categories", label: "Categories", icon: TagIcon },
  { href: "/budgets", label: "Budgets", icon: PieIcon },
  { href: "/goals", label: "Goals", icon: TargetIcon },
];

export function AppShell({
  userEmail,
  streak,
  children,
}: {
  userEmail: string;
  /** null once a user has never logged a transaction -- nothing to show yet. */
  streak: { current: number; best: number } | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-page text-ink md:flex">
      <header className="flex items-center justify-between border-b border-hairline bg-page px-4 py-3 md:hidden">
        <span className="text-lg font-semibold">EverNest Finance</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="rounded-lg p-2 text-ink-secondary hover:bg-surface hover:text-ink"
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
            <StreakBadge days={streak.current} best={streak.best} />
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
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
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
          <p className="truncate px-3 text-sm text-ink-secondary">{userEmail}</p>
          <form action={logout}>
            <button
              type="submit"
              className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-ink-secondary hover:bg-surface hover:text-ink"
            >
              Log out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
