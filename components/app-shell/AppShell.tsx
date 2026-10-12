"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/lib/auth/actions";
import { HomeIcon, ListIcon, WalletIcon, TagIcon, PieIcon, TargetIcon, RepeatIcon, SettingsIcon, MenuIcon, CloseIcon, type IconProps } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { QuickAddBar } from "@/components/quick-add/QuickAddBar";
import { OptimisticTransactionsProvider } from "@/components/quick-add/OptimisticTransactionsContext";
import { ConfirmPulseProvider } from "@/components/ui/ConfirmPulse";
import { SorrelMark } from "@/components/SorrelMark";
import type { TransactionAccountOption } from "@/app/(app)/transactions/AddTransactionForm";
import type { CategoryWithGroup } from "@/lib/db/categories";

export type QuickAddData = {
  accounts: TransactionAccountOption[];
  incomeCategories: CategoryWithGroup[];
  expenseCategories: CategoryWithGroup[];
  defaultAccountId: string | null;
};

type NavItem = {
  href: string;
  label: string;
  icon: (props: IconProps) => React.ReactNode;
  /** The .nav-icon--{verb} animation in globals.css ("NAV ICON VERBS").
   * "respond" is the shared fallback for a shape that can't carry a verb. */
  verb: string;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon, verb: "dashboard" },
  { href: "/transactions", label: "Transactions", icon: ListIcon, verb: "transactions" },
  { href: "/accounts", label: "Accounts", icon: WalletIcon, verb: "accounts" },
  // The fallback: a tag with one hole has no dots to sort.
  { href: "/categories", label: "Categories", icon: TagIcon, verb: "respond" },
  // The fallback: a two-stroke pie has no fill to fill.
  { href: "/budgets", label: "Budgets", icon: PieIcon, verb: "respond" },
  { href: "/goals", label: "Goals", icon: TargetIcon, verb: "goals" },
  { href: "/recurring", label: "Recurring", icon: RepeatIcon, verb: "recurring" },
  { href: "/settings", label: "Settings", icon: SettingsIcon, verb: "settings" },
];

export function AppShell({
  accountName,
  quickAdd,
  children,
}: {
  /** Resolved by identityName() -- never the full email address. */
  accountName: string;
  /** null if any of its data failed to load -- the page still renders without it. */
  quickAdd: QuickAddData | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <ConfirmPulseProvider>
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
          <Wordmark />
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
            <div className="hidden px-2 md:block">
              <Wordmark />
            </div>
            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </nav>
          </div>

          <div className="mt-auto flex flex-col gap-1 border-t border-hairline pt-4">
            {/* Same provider as the settings page, so the two controls never
                disagree. Icon-only here -- the rail is 15rem wide and three
                labelled segments would crowd the account block. */}
            <div className="px-3 pb-3">
              <ThemeToggle variant="compact" />
            </div>
            <p className="truncate px-3 text-sm text-ink-secondary">{accountName}</p>
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

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none md:px-8 md:py-8">
          {/* The one content width for every authenticated screen: 72rem,
              centred, so on a wide monitor the extra width becomes margin
              instead of stretching row grids and panels apart. Pages, their
              loading skeletons and error states all inherit it -- no page
              sets its own max-width. The quick-add bar sits inside it
              so its desktop sticky form lines up with the page below. */}
          <div className="mx-auto w-full max-w-6xl">
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
          </div>
        </main>
      </div>
    </ConfirmPulseProvider>
  );
}

// One sidebar link. The click navigates and the icon performs its verb in
// parallel -- never in sequence. Link starts the route change itself, right
// after this handler returns; nothing here awaits, delays or can cancel it.
// The flag only adds a class, so the cost on the click path is one
// re-render of this link, and the sidebar lives in the layout, so the
// animation simply plays out over whatever the transition takes.
function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const [animating, setAnimating] = useState(false);
  // Bumped on every click, so the effect below re-runs even when the flag is
  // already true. See the race it closes, below.
  const [clicks, setClicks] = useState(0);
  const iconRef = useRef<HTMLSpanElement>(null);
  const Icon = item.icon;

  // Clears the flag when the verb has played, never by remounting or
  // re-keying. Driven by the animations themselves (Web Animations API), not
  // animationend events, because of a race rapid clicking hit: the verb
  // ends and queues setAnimating(false), a click lands before that commits
  // and queues true, React batches them into "no change" -- so the class
  // never leaves the DOM, the CSS animation never restarts, no event ever
  // fires, and the flag stuck true for good, silencing that icon.
  //   running  -> mid-verb; leave it, a click doesn't restart it
  //   finished -> the class never left; replay it in place
  //   none     -> nothing to play (reduced motion); clear now
  // `finished` rejects when an animation is cancelled -- the mobile drawer
  // hides on click -- so that clears the flag too, and the verb doesn't
  // replay the next time the drawer opens.
  useEffect(() => {
    const el = iconRef.current;
    if (!el || !animating) return;
    let live = true;
    const animations = el.getAnimations({ subtree: true });
    if (animations.length === 0) {
      setAnimating(false);
      return;
    }
    for (const animation of animations) {
      if (animation.playState === "finished") animation.play();
    }
    const settle = () => {
      if (live) setAnimating(false);
    };
    Promise.all(animations.map((animation) => animation.finished)).then(settle, settle);
    return () => {
      live = false;
    };
  }, [animating, clicks]);

  return (
    <Link
      href={item.href}
      onClick={(event) => {
        onNavigate();
        // A new-tab / new-window click leaves this page where it is.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        // The page you're already on: no navigation, no verb. Only the bare
        // URL counts -- from /transactions?page=3 the link still goes back
        // to page one, as it always has.
        if (window.location.pathname === item.href && !window.location.search) {
          event.preventDefault();
          return;
        }
        // Measured cost of a state flag here: the route request starts ~2.7ms
        // later (32 interleaved trials, 95% CI 0.05-4.85ms), from React
        // rendering this update before the router's transition. No effect on
        // time to first paint. Chosen over adding the class imperatively with
        // classList, which costs nothing but leaves React not owning this
        // element's class -- the first conditional class added to it later
        // would clobber or strand the animation. docs/phase-7-findings.md.
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setAnimating(true);
          setClicks((n) => n + 1);
        }
      }}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-page ${
        active ? "bg-surface text-ink" : "text-ink-secondary hover:bg-surface hover:text-ink"
      }`}
    >
      <span ref={iconRef} className="contents">
        <Icon
          className={`nav-icon nav-icon--${item.verb} h-5 w-5${animating ? " is-animating" : ""}`}
          aria-hidden="true"
        />
      </span>
      {item.label}
    </Link>
  );
}

// The identity anchor: always open, never animated. The mark is hidden from
// assistive tech because the word beside it already says "Sorrel".
function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-lg font-semibold text-ink">
      <span aria-hidden="true">
        <SorrelMark size={24} />
      </span>
      Sorrel
    </span>
  );
}
