// The Your Sorrel panel (docs/Decide-and-Grow.md, J). It is one panel, opened
// from three places that don't share a parent -- the dashboard greeting, the
// milestone toast, the account block in the sidebar -- so they ask for it the
// way "Log it" asks for the add form (lib/quickAdd/openAddForm.ts): an event
// on window, answered by the one host AppShell mounts. Asking opens the panel;
// the panel's own read of the dates happens then, not before.

export const OPEN_YOUR_SORREL_EVENT = "sorrel:open-your-sorrel";

export const YOUR_SORREL_URL = "/dashboard/your-sorrel";

/** Opens the panel. `from` is the element to give focus back to when it closes. */
export function requestYourSorrel(from?: HTMLElement | null): void {
  window.dispatchEvent(new CustomEvent<{ from: HTMLElement | null }>(OPEN_YOUR_SORREL_EVENT, { detail: { from: from ?? null } }));
}

/** The dashboard greeting's link, where focus returns when the panel was opened from the toast. */
export const YOUR_SORREL_LINK_ID = "your-sorrel-link";
