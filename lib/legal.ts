// Parses docs/legal/privacy-and-terms.md -- the source of truth for the
// /privacy and /terms pages -- into blocks the pages render. The file holds
// two documents separated by a `---` line pair.
//
// Deliberately a subset parser: `#`/`##` headings, paragraphs, `- ` lists,
// and **bold**. Anything else (links, italics, code, deeper headings,
// numbered lists, HTML) throws, so the build fails loudly instead of a page
// rendering a stray asterisk or dropping text the markdown still says.
// Supporting new syntax means extending this file and its tests.

// Where the two documents are served (app/(public)/).
export const PRIVACY_PATH = "/privacy";
export const TERMS_PATH = "/terms";

export type Inline = { text: string; strong: boolean };

export type LegalBlock =
  | { type: "h2"; content: Inline[] }
  | { type: "p"; content: Inline[] }
  | { type: "ul"; items: Inline[][] };

export type LegalDocument = {
  title: string;
  lastUpdated: string;
  blocks: LegalBlock[];
};

export type LegalDocumentId = "privacy" | "terms";

const TITLES: Record<LegalDocumentId, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
};

const DOCUMENT_SEPARATOR = /\n---\n---\n/;
const LAST_UPDATED = /^\*\*Last updated: ([^*]+)\*\*$/;
// Markdown syntax this parser doesn't render. `*` is checked after `**`
// pairs are split out, so a lone asterisk lands here too.
const UNSUPPORTED_INLINE = /[`*_[\]<>\\]/;

function fail(message: string, context: string): never {
  throw new Error(`legal markdown: ${message}: ${JSON.stringify(context.slice(0, 80))}`);
}

export function parseInline(source: string): Inline[] {
  const parts = source.split("**");
  if (parts.length % 2 === 0) fail("unclosed **", source);

  const inline: Inline[] = [];
  parts.forEach((text, i) => {
    if (text === "") return;
    if (UNSUPPORTED_INLINE.test(text)) fail("unsupported inline syntax", text);
    inline.push({ text, strong: i % 2 === 1 });
  });
  return inline;
}

function parseBlocks(source: string): { title: string; blocks: LegalBlock[]; rawLastUpdated: string | null } {
  const chunks = source
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "");

  let title: string | null = null;
  let rawLastUpdated: string | null = null;
  const blocks: LegalBlock[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split("\n").map((line) => line.trim());

    if (chunk.startsWith("#")) {
      if (lines.length > 1) fail("heading spans lines", chunk);
      const match = /^(#{1,6}) (.+)$/.exec(chunk);
      if (!match) fail("malformed heading", chunk);
      const [, hashes, text] = match;
      if (hashes.length === 1) {
        if (title !== null) fail("second # heading in one document", chunk);
        if (blocks.length > 0) fail("# heading after content", chunk);
        if (UNSUPPORTED_INLINE.test(text)) fail("unsupported inline syntax", text);
        title = text;
      } else if (hashes.length === 2) {
        blocks.push({ type: "h2", content: parseInline(text) });
      } else {
        fail("only # and ## headings are supported", chunk);
      }
      continue;
    }

    if (lines.every((line) => line.startsWith("- "))) {
      blocks.push({ type: "ul", items: lines.map((line) => parseInline(line.slice(2))) });
      continue;
    }

    if (lines.some((line) => /^(- |\d+[.)] |> |```|\||---)/.test(line))) {
      fail("unsupported block syntax", chunk);
    }

    const text = lines.join(" ");
    if (title !== null && blocks.length === 0 && rawLastUpdated === null) {
      const updated = LAST_UPDATED.exec(text);
      if (!updated) fail("the line after the # heading must be **Last updated: <date>**", text);
      rawLastUpdated = updated[1];
      continue;
    }
    blocks.push({ type: "p", content: parseInline(text) });
  }

  if (title === null) fail("document has no # heading", source);
  return { title, blocks, rawLastUpdated };
}

export function parseLegalMarkdown(source: string): Record<LegalDocumentId, LegalDocument> {
  const normalised = source.replace(/\r\n/g, "\n");
  const parts = normalised.split(DOCUMENT_SEPARATOR);
  if (parts.length !== 2) fail(`expected 2 documents, found ${parts.length}`, normalised);

  const byTitle = new Map<string, LegalDocument>();
  for (const part of parts) {
    const { title, blocks, rawLastUpdated } = parseBlocks(part);
    if (rawLastUpdated === null) fail("missing **Last updated: <date>**", title);
    byTitle.set(title, { title, lastUpdated: rawLastUpdated, blocks });
  }

  const pick = (id: LegalDocumentId) =>
    byTitle.get(TITLES[id]) ?? fail(`no document titled "${TITLES[id]}"`, [...byTitle.keys()].join(", "));
  return { privacy: pick("privacy"), terms: pick("terms") };
}

// Inverse of parseLegalMarkdown for one document, used by the tests to prove
// the parse is lossless: serialising it reproduces the source.
export function serialiseLegalDocument(doc: LegalDocument): string {
  const inline = (content: Inline[]) =>
    content.map(({ text, strong }) => (strong ? `**${text}**` : text)).join("");
  const blocks = doc.blocks.map((block) =>
    block.type === "h2"
      ? `## ${inline(block.content)}`
      : block.type === "p"
        ? inline(block.content)
        : block.items.map((item) => `- ${inline(item)}`).join("\n"),
  );
  return [`# ${doc.title}`, `**Last updated: ${doc.lastUpdated}**`, ...blocks].join("\n\n");
}
