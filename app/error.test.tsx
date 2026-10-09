import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { UNREACHABLE, UnreachableError } from "@/lib/unreachable";

// "Check your connection" belongs ONLY to the browser-offline case: every
// database call runs on the server, so our failure to reach Supabase is
// never the user's connection (docs/phase-7-findings.md, "Copy: whose
// connection failed").

let dom: JSDOM;
let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let ErrorPage: typeof import("./error").default;
let online = true;

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  Object.defineProperty(dom.window.navigator, "onLine", { get: () => online, configurable: true });
  const g = globalThis as Record<string, unknown>;
  for (const key of ["window", "self", "document", "navigator", "HTMLElement", "Node", "Element"]) {
    Object.defineProperty(g, key, {
      value: key === "window" || key === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  }
  g.IS_REACT_ACT_ENVIRONMENT = true;

  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ default: ErrorPage } = await import("./error"));
});

const roots: { unmount(): void }[] = [];

after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

async function render(error: Error & { digest?: string }): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  // The boundary echoes the error to the console; keep test output clean.
  const consoleError = console.error;
  console.error = () => {};
  try {
    await act(async () => root.render(<ErrorPage error={error} reset={() => {}} />));
  } finally {
    console.error = consoleError;
  }
  return container;
}

// What reaches the boundary in production: a redacted Error plus the digest.
function redacted(digest: string): Error & { digest: string } {
  return Object.assign(new Error("An error occurred in the Server Components render."), { digest });
}

test("server can't reach Supabase: our outage, not the user's connection", async () => {
  online = true;
  const thrown = new UnreachableError("Auth server unreachable");
  const text = (await render(redacted(thrown.digest))).textContent ?? "";
  assert.ok(text.includes(UNREACHABLE));
  assert.doesNotMatch(text, /connection|offline/i);
  // The reference is the occurrence id, without the internal marker.
  assert.doesNotMatch(text, /UNREACHABLE/);
  assert.ok(text.includes(thrown.digest.split(";")[1]));
});

test("browser offline: the one case that says check your connection", async () => {
  online = false;
  const text = (await render(redacted("1234567890"))).textContent ?? "";
  assert.match(text, /You appear to be offline/);
  assert.match(text, /Check your connection/);
  assert.ok(!text.includes(UNREACHABLE));
});

test("anything else: the generic text", async () => {
  online = true;
  const text = (await render(redacted("1234567890"))).textContent ?? "";
  assert.match(text, /Something on our end broke/);
  assert.doesNotMatch(text, /connection|offline|can't reach/i);
  assert.match(text, /Reference: 1234567890/);
});

test("going offline while the boundary is showing switches the copy", async () => {
  online = true;
  const container = await render(redacted("1234567890"));
  assert.match(container.textContent ?? "", /Something on our end broke/);
  online = false;
  await act(async () => window.dispatchEvent(new dom.window.Event("offline")));
  assert.match(container.textContent ?? "", /You appear to be offline/);
});
