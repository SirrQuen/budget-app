import type { Inline, LegalDocument } from "@/lib/legal";

// Long-form document typography, not app-screen styling: a measured line
// (~68 characters), body at 16px/28px, and headings spaced to read as
// section breaks. Body copy is ink-secondary with bold runs lifted to ink;
// both pass AA on --page in each theme.

function slug(content: Inline[]): string {
  return content
    .map((run) => run.text)
    .join("")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function Runs({ content }: { content: Inline[] }) {
  return content.map((run, i) =>
    run.strong ? (
      <strong key={i} className="font-semibold text-ink">
        {run.text}
      </strong>
    ) : (
      run.text
    ),
  );
}

export function LegalDocumentView({ doc }: { doc: LegalDocument }) {
  return (
    <article className="mx-auto w-full max-w-[68ch] break-words">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{doc.title}</h1>
        <p className="mt-3 text-sm text-ink-muted">Last updated: {doc.lastUpdated}</p>
      </header>

      {doc.blocks.map((block, i) => {
        switch (block.type) {
          case "h2": {
            return (
              <h2
                key={i}
                id={slug(block.content)}
                className="mt-12 scroll-mt-8 text-xl font-semibold tracking-tight text-ink"
              >
                <Runs content={block.content} />
              </h2>
            );
          }
          case "p":
            return (
              <p key={i} className="mt-4 text-base leading-7 text-ink-secondary">
                <Runs content={block.content} />
              </p>
            );
          case "ul":
            return (
              <ul
                key={i}
                className="mt-4 list-disc space-y-2 pl-6 text-base leading-7 text-ink-secondary marker:text-ink-muted"
              >
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Runs content={item} />
                  </li>
                ))}
              </ul>
            );
        }
      })}
    </article>
  );
}
