import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { JSDOM, VirtualConsole } from "jsdom";
import { ACTIVITY_STORAGE_KEY, IDLE_CONFIG } from "@/lib/idleTimeout";

// The real component, the real listeners, a controlled clock. The Server
// Action is stubbed to count calls; fetch is stubbed to prove nothing else
// leaves the page -- activity tracking writes to localStorage only.

type Next<A, R> = (arg: A, context: unknown) => R;
type HookResult = { url?: string; format?: string; source?: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: {
    resolve(specifier: string, context: unknown, nextResolve: Next<string, HookResult>): HookResult;
    load(url: string, context: unknown, nextLoad: Next<string, HookResult>): HookResult;
  }): void;
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/auth/actions") return { url: "stub:auth-actions", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "stub:auth-actions") {
      return {
        format: "commonjs",
        source: "exports.idleSignOut = async () => { globalThis.__idleSignOuts = (globalThis.__idleSignOuts || 0) + 1; };",
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const SESSION = "session-1";
const T0 = 1_760_000_000_000;
const { warningMs, signOutMs } = IDLE_CONFIG;

let dom: JSDOM;
let navigations = 0;
let fetches = 0;
let now = T0;
const realNow = Date.now;
let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let IdleTimeout: typeof import("./IdleTimeout").IdleTimeout;
let root: { render(n: React.ReactNode): void; unmount(): void } | null = null;
const g = globalThis as Record<string, unknown>;

before(async () => {
  const virtualConsole = new VirtualConsole();
  // jsdom doesn't navigate; location.replace() reports "not implemented".
  // Counting those is how a test sees the tab leave.
  virtualConsole.on("jsdomError", (e) => {
    if (/navigation/i.test(e.message)) navigations += 1;
  });
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/dashboard",
    virtualConsole,
    // visibilityState "visible", as a tab the person returned to.
    pretendToBeVisual: true,
  });
  for (const key of ["window", "self", "document", "navigator", "HTMLElement", "Node", "Element", "StorageEvent", "PageTransitionEvent"]) {
    Object.defineProperty(g, key, {
      value: key === "window" || key === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  // jsdom has no modal dialog; open/close is what the component drives.
  const proto = dom.window.HTMLDialogElement.prototype as unknown as {
    showModal(): void;
    close(): void;
    open: boolean;
  };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  g.fetch = async () => {
    fetches += 1;
    throw new Error("no network in this test");
  };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  Date.now = () => now;

  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ IdleTimeout } = await import("./IdleTimeout"));
});

after(() => {
  Date.now = realNow;
  dom.window.close();
});

beforeEach(() => {
  now = T0;
  navigations = 0;
  fetches = 0;
  g.__idleSignOuts = 0;
  dom.window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<IdleTimeout sessionId={SESSION} />));
}

async function fire(target: EventTarget, event: Event) {
  await act(async () => {
    target.dispatchEvent(event);
  });
  // Let leave()'s awaited action settle.
  await act(async () => {});
}

const pointer = () => fire(dom.window, new dom.window.Event("pointermove"));
const returnToTab = () => fire(document, new dom.window.Event("visibilitychange"));
const signOuts = () => g.__idleSignOuts as number;
const dialog = () => document.querySelector("dialog")!;
const isOpen = () => dialog().hasAttribute("open");
const stored = () => JSON.parse(dom.window.localStorage.getItem(ACTIVITY_STORAGE_KEY) ?? "null");

// Another tab of the same session writes, and this tab hears it.
async function otherTabActivity(at: number) {
  const value = JSON.stringify({ sessionId: SESSION, at });
  dom.window.localStorage.setItem(ACTIVITY_STORAGE_KEY, value);
  await fire(dom.window, new dom.window.StorageEvent("storage", { key: ACTIVITY_STORAGE_KEY, newValue: value }));
}

test("two tabs: activity in the other tab keeps this one from warning", async () => {
  await mount();
  now = T0 + warningMs - 1_000;
  await otherTabActivity(now);
  now = T0 + warningMs + 60_000; // past this tab's own warning mark
  await returnToTab();
  assert.equal(isOpen(), false);
  assert.equal(signOuts(), 0);
});

test("two tabs: activity in the other tab closes a warning already showing here", async () => {
  await mount();
  now = T0 + warningMs + 30_000;
  await returnToTab();
  assert.equal(isOpen(), true);
  await otherTabActivity(now);
  assert.equal(isOpen(), false);
});

test("waking from sleep past the limit signs out on the first event -- it doesn't count as activity", async () => {
  await mount();
  now = T0 + 3 * 60 * 60_000;
  await pointer();
  assert.equal(signOuts(), 1);
  assert.equal(navigations, 1);
  assert.equal(stored().signedOut, "timeout");
  assert.equal(isOpen(), false);
});

test("returning to a tab backgrounded for 20 minutes signs out at once", async () => {
  await mount();
  now = T0 + 20 * 60_000;
  await returnToTab();
  assert.equal(signOuts(), 1);
});

test("window focus evaluates elapsed time before it counts as activity", async () => {
  await mount();
  now = T0 + signOutMs + 1;
  await fire(dom.window, new dom.window.Event("focus"));
  assert.equal(signOuts(), 1);
});

test("\"I'm still here\" resets without a second modal; stray activity doesn't dismiss the warning", async () => {
  await mount();
  now = T0 + warningMs + 1_000;
  await returnToTab();
  assert.equal(isOpen(), true);

  await pointer();
  assert.equal(isOpen(), true, "mouse movement alone doesn't answer the warning");

  const stillHere = [...dialog().querySelectorAll("button")].find((b) => b.textContent === "I'm still here")!;
  await act(async () => stillHere.click());
  assert.equal(isOpen(), false);
  assert.equal(stored().at, now);
  assert.equal(navigations, 0, "no reload");

  now += 5_000;
  await returnToTab();
  assert.equal(isOpen(), false);
  assert.equal(signOuts(), 0);
});

test("Escape answers the warning the same way as \"I'm still here\"", async () => {
  await mount();
  now = T0 + warningMs + 1_000;
  await returnToTab();
  await fire(dialog(), new dom.window.Event("cancel", { cancelable: true }));
  assert.equal(isOpen(), false);
  assert.equal(signOuts(), 0);
});

test("the warning is calm and has exactly two actions, the primary focused first", async () => {
  await mount();
  now = T0 + signOutMs - 298_000;
  await returnToTab();
  const d = dialog();
  assert.match(d.textContent ?? "", /Still there\?We'll sign you out in 4:58 to keep your account safe\./);
  const buttons = [...d.querySelectorAll("button")];
  assert.deepEqual(buttons.map((b) => b.textContent), ["Sign out now", "I'm still here"]);
  assert.equal(document.activeElement, buttons[1], "focus starts on the primary action");
  assert.equal(d.querySelector("svg"), null, "no warning iconography");
  assert.ok(d.getAttribute("aria-labelledby") && d.getAttribute("aria-describedby"));
  assert.equal(d.querySelector("[aria-live]")?.getAttribute("aria-live"), "polite");
});

test("\"Sign out now\" tells the other tabs it was a choice, not a timeout", async () => {
  await mount();
  now = T0 + warningMs + 1_000;
  await returnToTab();
  const signOutNow = [...dialog().querySelectorAll("button")].find((b) => b.textContent === "Sign out now")!;
  await act(async () => signOutNow.click());
  await act(async () => {});
  assert.equal(signOuts(), 1);
  assert.equal(stored().signedOut, "manual");
});

test("a tab follows another tab of its session out", async () => {
  await mount();
  const value = JSON.stringify({ sessionId: SESSION, at: T0, signedOut: "timeout" });
  dom.window.localStorage.setItem(ACTIVITY_STORAGE_KEY, value);
  await fire(dom.window, new dom.window.StorageEvent("storage", { key: ACTIVITY_STORAGE_KEY, newValue: value }));
  assert.equal(navigations, 1);
});

test("a timestamp left by an earlier session doesn't sign out a new one", async () => {
  dom.window.localStorage.setItem(
    ACTIVITY_STORAGE_KEY,
    JSON.stringify({ sessionId: "old-session", at: T0 - 3 * 60 * 60_000, signedOut: "timeout" }),
  );
  await mount();
  await returnToTab();
  assert.equal(signOuts(), 0);
  assert.equal(navigations, 0);
  assert.equal(stored().sessionId, SESSION);
});

test("a page restored from the back/forward cache reloads instead of showing stale data", async () => {
  await mount();
  await fire(dom.window, new dom.window.PageTransitionEvent("pageshow", { persisted: true }));
  assert.equal(navigations, 1);
});

test("activity tracking never touches the network", async () => {
  await mount();
  for (let i = 0; i < 20; i++) {
    now += 30_000;
    await pointer();
  }
  assert.equal(fetches, 0);
  assert.equal(signOuts(), 0);
});
