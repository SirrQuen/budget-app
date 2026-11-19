import { SOCIAL_LINKS, socialLabel } from "@/lib/social";

// The social icon row, shared by the public footer, Settings and the
// sidebar. Plain anchors around inline SVG glyphs: no embeds, no widgets, no
// scripts and no images from those sites, so nothing is requested from them
// until a person follows a link. No cookies, no localStorage.
//
// Each glyph sits in a solid round badge: 36px circle inside a 44px target.
// At rest the circle is the ink token with the glyph cut out in the page
// token (both swap with the theme); on hover and keyboard focus the circle
// takes the accent and the glyph the accent's own ink. Those pairs are
// already contrast-checked in globals.css (gold/#0b0b0b, navy/white); the
// rest pair is ink on page. The ring sits outside the circle, on the badge,
// and nothing moves.
//
// `ring` is the surface the row sits on, so the focus ring's offset matches.

function Glyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

export function SocialLinks({ ring = "page", className = "" }: { ring?: "page" | "surface"; className?: string }) {
  const offset = ring === "page" ? "group-focus-visible:ring-offset-page" : "group-focus-visible:ring-offset-surface";
  return (
    <ul aria-label="Sorrel elsewhere" className={`flex items-center gap-1 ${className}`}>
      {SOCIAL_LINKS.map((link) => (
        <li key={link.id}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={socialLabel(link)}
            className="group flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none"
          >
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full bg-ink text-page transition-colors duration-150 group-hover:bg-action group-hover:text-action-ink group-focus-visible:bg-action group-focus-visible:text-action-ink group-focus-visible:ring-2 group-focus-visible:ring-action group-focus-visible:ring-offset-2 ${offset}`}
            >
              <Glyph path={link.glyph} />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
