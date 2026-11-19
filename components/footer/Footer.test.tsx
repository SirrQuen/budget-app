import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicFooter } from "./PublicFooter";
import { SettingsFooter } from "./SettingsFooter";
import { SocialLinks } from "./SocialLinks";

// The footers are plain server markup: links and inline SVG. What matters
// here is what they must NOT do -- load anything from the social sites -- and
// that every icon is a named, new-tab, opener-safe anchor.

test("each social icon is a named anchor that opens a new tab without an opener", () => {
  const html = renderToStaticMarkup(<SocialLinks />);
  for (const name of ["TikTok", "Instagram", "Facebook"]) {
    assert.match(html, new RegExp(`aria-label="Sorrel on ${name} \\(opens in a new tab\\)"`));
  }
  assert.equal((html.match(/target="_blank"/g) ?? []).length, 3);
  assert.equal((html.match(/rel="noopener noreferrer"/g) ?? []).length, 3);
  // 44px targets.
  assert.equal((html.match(/h-11 w-11/g) ?? []).length, 3);
});

test("the footers load nothing from the social sites: no script, iframe, img or preload", () => {
  for (const html of [renderToStaticMarkup(<PublicFooter />), renderToStaticMarkup(<SettingsFooter />)]) {
    assert.doesNotMatch(html, /<(script|iframe|img|link|embed|object)\b/i);
    // The only reference to those hosts is an <a href>.
    const refs = [...html.matchAll(/(?:src|srcset|data|action)="[^"]*(tiktok|instagram|facebook)[^"]*"/gi)];
    assert.equal(refs.length, 0);
  }
});

test("public footer: tagline, the three groups, contact, copyright", () => {
  const html = renderToStaticMarkup(<PublicFooter />);
  assert.match(html, /Know what(&#x27;|&rsquo;|’)s safe to spend/);
  for (const text of ["Join the waitlist", "Become a beta tester", "Privacy", "Terms", "hello@mysorrel.com"]) {
    assert.ok(html.includes(text), text);
  }
  for (const heading of ["Sorrel", "Legal", "Contact"]) assert.match(html, new RegExp(`<h2[^>]*>${heading}</h2>`));
  assert.match(html, /href="\/#waitlist"/);
  assert.match(html, /href="\/beta"/);
  assert.match(html, /href="mailto:hello@mysorrel\.com"/);
  assert.match(html, /© 2026 MW Cyber Architects LLC · Sorrel™/);
});

test("settings footer: the icons, Privacy and Terms, and nothing else", () => {
  const html = renderToStaticMarkup(<SettingsFooter />);
  assert.equal((html.match(/<a /g) ?? []).length, 5);
  assert.ok(html.includes("Privacy") && html.includes("Terms"));
  assert.doesNotMatch(html, /mailto:|waitlist|MW Cyber/);
});

// Content blockers hide elements by class, id and data attribute (and by a
// link's href, which only ever hides the icon anchors themselves). Nothing
// on the footer or its link groups may carry one of these words, or a filter
// list could hide the whole footer. The aria-labels on the icon links stay
// for screen readers; the list's own label is neutral.
test("no class, id or data attribute on a footer carries a word blockers hide by", () => {
  const WORDS = /social|share|follow|facebook|instagram|tiktok/i;
  for (const html of [renderToStaticMarkup(<PublicFooter />), renderToStaticMarkup(<SettingsFooter />)]) {
    const attrs = [...html.matchAll(/\s(class|id|data-[\w-]+|aria-label)="([^"]*)"/g)];
    for (const [, name, value] of attrs) {
      if (name === "aria-label" && /^Sorrel on (TikTok|Instagram|Facebook) \(opens in a new tab\)$/.test(value)) continue;
      assert.doesNotMatch(value, WORDS, `${name}="${value}"`);
    }
  }
});
