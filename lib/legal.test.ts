import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseInline, parseLegalMarkdown, serialiseLegalDocument } from "./legal";

const SOURCE = readFileSync(join(process.cwd(), "docs/legal/privacy-and-terms.md"), "utf8");

// The pages must say exactly what the committed markdown says. Serialising
// the parse reproduces each document's source, so nothing was dropped,
// reordered or reworded on the way in. Paragraph-internal line breaks are
// soft in markdown, so they're compared as spaces.
test("the parse of privacy-and-terms.md is lossless", () => {
  const docs = parseLegalMarkdown(SOURCE);
  const sources = SOURCE.replace(/\r\n/g, "\n").split(/\n---\n---\n/);
  const canonical = (s: string) =>
    s
      .trim()
      .split(/\n\s*\n/)
      .map((block) =>
        block
          .split("\n")
          .map((line) => line.trim())
          .join(block.trimStart().startsWith("- ") ? "\n" : " "),
      )
      .join("\n\n");

  assert.equal(serialiseLegalDocument(docs.privacy), canonical(sources[0]));
  assert.equal(serialiseLegalDocument(docs.terms), canonical(sources[1]));
});

test("each document carries its title and last-updated date", () => {
  const { privacy, terms } = parseLegalMarkdown(SOURCE);
  assert.equal(privacy.title, "Privacy Policy");
  assert.equal(terms.title, "Terms of Service");
  assert.match(privacy.lastUpdated, /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  assert.match(terms.lastUpdated, /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
});

test("CRLF line endings parse the same as LF", () => {
  assert.deepEqual(parseLegalMarkdown(SOURCE.replace(/\r?\n/g, "\r\n")), parseLegalMarkdown(SOURCE));
});

test("bold splits into strong runs", () => {
  assert.deepEqual(parseInline("**We** can close it."), [
    { text: "We", strong: true },
    { text: " can close it.", strong: false },
  ]);
});

const doc = (body: string) =>
  `# Privacy Policy\n\n**Last updated: October 12, 2026**\n\n${body}\n\n---\n---\n\n# Terms of Service\n\n**Last updated: October 12, 2026**\n\nText.\n`;

test("control: the fixture parses with supported syntax", () => {
  assert.doesNotThrow(() => parseLegalMarkdown(doc("Plain, **bold** and\n\n- a list\n- of two")));
});

for (const [syntax, body] of [
  ["a link", "See [the terms](/terms)."],
  ["italics", "This is *important*."],
  ["underscore emphasis", "This is _important_."],
  ["inline code", "Run `this`."],
  ["inline HTML", "A <b>bold</b> claim."],
  ["an unclosed **", "**Half bold."],
  ["a ### heading", "### Too deep"],
  ["a numbered list", "1. First"],
  ["a blockquote", "> Quoted"],
  ["a list mixed with text", "- One\nNot an item"],
] as const) {
  test(`rejects ${syntax} rather than rendering it wrong`, () => {
    assert.throws(() => parseLegalMarkdown(doc(body)), /legal markdown/);
  });
}

test("rejects a document without its last-updated line", () => {
  assert.throws(
    () => parseLegalMarkdown(doc("Text.").replace("**Last updated: October 12, 2026**\n\nText.\n", "Text.\n")),
    /Last updated/,
  );
});

test("rejects a file that isn't exactly two documents", () => {
  assert.throws(() => parseLegalMarkdown("# Privacy Policy\n\n**Last updated: May 1, 2026**\n"), /expected 2 documents/);
});
