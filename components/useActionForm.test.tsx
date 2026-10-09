import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { redirect } from "next/navigation";
import { UnreachableError, UNREACHABLE } from "@/lib/unreachable";
import { GENERIC, OFFLINE } from "@/lib/thrownError";

// A form whose submission doesn't succeed keeps what the user typed: a
// returned error used to blank uncontrolled fields (React's form reset), and
// a thrown action used to replace the whole route with app/error.tsx.

let dom: JSDOM;
let React: typeof import("react");
let act: typeof import("react").act;
let createRoot: typeof import("react-dom/client").createRoot;
let hook: typeof import("./useActionForm");
let online = true;

before(async () => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  Object.defineProperty(dom.window.navigator, "onLine", { get: () => online, configurable: true });
  const g = globalThis as Record<string, unknown>;
  for (const key of [
    "window",
    "self",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLFormElement",
    "Node",
    "Element",
    "Event",
    "FormData",
  ]) {
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
  hook = await import("./useActionForm");
});

const roots: { unmount(): void }[] = [];

after(async () => {
  await act(async () => roots.forEach((r) => r.unmount()));
  dom.window.close();
});

type State = { error?: string } | undefined;
type Action = (prev: State, formData: FormData) => Promise<State>;

async function mount(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

function GuardedForm({ action }: { action: Action }) {
  const [state, formAction, pending, submit] = hook.useActionForm<State>(action, undefined);
  return (
    <form action={formAction} onSubmit={submit}>
      <input name="name" defaultValue="" />
      <button type="submit" disabled={pending}>
        Save
      </button>
      <button type="submit" name="reset" value="1">
        Use the suggestion
      </button>
      {state?.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}

function PlainForm({ action }: { action: Action }) {
  const [state, formAction] = React.useActionState<State, FormData>(action, undefined);
  return (
    <form action={formAction}>
      <input name="name" defaultValue="" />
      <button type="submit">Save</button>
      {state?.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}

async function typeAndSubmit(container: HTMLElement, value: string, button = 0) {
  const input = container.querySelector("input[name=name]") as HTMLInputElement;
  input.value = value;
  const form = container.querySelector("form") as HTMLFormElement;
  const submitter = container.querySelectorAll("button")[button] as HTMLButtonElement;
  await act(async () => form.requestSubmit(submitter));
  return input;
}

const quietConsole = (t: import("node:test").TestContext) => t.mock.method(console, "error", () => {});

test("control: React's own <form action> blanks the field on a returned error", async () => {
  const container = await mount(<PlainForm action={async () => ({ error: "That name is taken." })} />);
  const input = await typeAndSubmit(container, "Groceries");
  assert.equal(container.querySelector("[role=alert]")?.textContent, "That name is taken.");
  assert.equal(input.value, "");
});

test("a returned error keeps what was typed", async () => {
  const container = await mount(<GuardedForm action={async () => ({ error: "That name is taken." })} />);
  const input = await typeAndSubmit(container, "Groceries");
  assert.equal(container.querySelector("[role=alert]")?.textContent, "That name is taken.");
  assert.equal(input.value, "Groceries");
});

test("a thrown action shows inline and keeps the form", async (t) => {
  quietConsole(t);
  online = true;
  const container = await mount(
    <GuardedForm
      action={async () => {
        throw new TypeError("Failed to fetch");
      }}
    />,
  );
  const input = await typeAndSubmit(container, "Groceries");
  assert.equal(container.querySelector("[role=alert]")?.textContent, GENERIC);
  assert.equal(input.value, "Groceries");
});

test("a thrown action while offline says check your connection", async (t) => {
  quietConsole(t);
  online = false;
  try {
    const container = await mount(
      <GuardedForm
        action={async () => {
          throw new TypeError("Failed to fetch");
        }}
      />,
    );
    await typeAndSubmit(container, "Groceries");
    assert.equal(container.querySelector("[role=alert]")?.textContent, OFFLINE);
  } finally {
    online = true;
  }
});

test("a thrown outage keeps its own copy", async (t) => {
  quietConsole(t);
  const thrown = new UnreachableError("Auth server unreachable");
  const container = await mount(
    <GuardedForm
      action={async () => {
        throw Object.assign(new Error("redacted"), { digest: thrown.digest });
      }}
    />,
  );
  await typeAndSubmit(container, "Groceries");
  assert.equal(container.querySelector("[role=alert]")?.textContent, UNREACHABLE);
});

test("the button that submitted is in the FormData", async () => {
  let received: FormData | undefined;
  const container = await mount(
    <GuardedForm
      action={async (_prev, formData) => {
        received = formData;
        return undefined;
      }}
    />,
  );
  await typeAndSubmit(container, "250", 1);
  assert.equal(received?.get("reset"), "1");
  assert.equal(received?.get("name"), "250");
});

test("callAction: a direct call that throws returns the error", async (t) => {
  quietConsole(t);
  const result = await hook.callAction(async (): Promise<{ error?: string }> => {
    throw new TypeError("Failed to fetch");
  });
  assert.deepEqual(result, { error: GENERIC });
});

test("callAction: redirect() still propagates, so the navigation happens", async () => {
  await assert.rejects(
    hook.callAction(async () => redirect("/transactions")),
    (error: { digest?: string }) => error.digest?.startsWith("NEXT_REDIRECT") === true,
  );
});
