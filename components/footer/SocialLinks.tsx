import { SOCIAL_LINKS, socialLabel } from "@/lib/social";

// The social icon row, shared by the public footer and Settings. Plain
// anchors around inline SVG glyphs: no embeds, no widgets, no scripts and no
// images from those sites, so nothing is requested from them until a person
// follows a link. No cookies, no localStorage. Muted ink at rest, the app's
// accent on hover and focus; 44px targets; the ring shows on keyboard focus.
//
// `ring` is the surface the row sits on, so the focus ring's offset matches.

function Glyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

export function SocialLinks({ ring = "page", className = "" }: { ring?: "page" | "surface"; className?: string }) {
  const offset = ring === "page" ? "focus-visible:ring-offset-page" : "focus-visible:ring-offset-surface";
  return (
    <ul aria-label="Sorrel on social media" className={`flex items-center gap-1 ${className}`}>
      {SOCIAL_LINKS.map((link) => (
        <li key={link.id}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={socialLabel(link)}
            className={`flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:text-action focus-visible:text-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 ${offset}`}
          >
            <Glyph path={link.glyph} />
          </a>
        </li>
      ))}
    </ul>
  );
}
