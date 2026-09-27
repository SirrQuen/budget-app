import { ImageResponse } from "next/og";
import { Wordmark } from "@/components/Wordmark";

export const alt = "Sorrel";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          background: "#131322",
        }}
      >
        {/* --mark-on-dark: the ground is navy, and ImageResponse can't read CSS vars. */}
        <svg width="120" height="120" viewBox="0 0 100 100" fill="#E63946">
          <path d="M 50 50 C 44 36, 24 32, 24 18 C 24 8, 36 2, 44 8 C 47 10, 48.5 12, 50 16 C 51.5 12, 53 10, 56 8 C 64 2, 76 8, 76 18 C 76 32, 56 36, 50 50 Z" />
          <path
            transform="rotate(120 50 50)"
            d="M 50 50 C 44 36, 24 32, 24 18 C 24 8, 36 2, 44 8 C 47 10, 48.5 12, 50 16 C 51.5 12, 53 10, 56 8 C 64 2, 76 8, 76 18 C 76 32, 56 36, 50 50 Z"
          />
          <path
            transform="rotate(240 50 50)"
            d="M 50 50 C 44 36, 24 32, 24 18 C 24 8, 36 2, 44 8 C 47 10, 48.5 12, 50 16 C 51.5 12, 53 10, 56 8 C 64 2, 76 8, 76 18 C 76 32, 56 36, 50 50 Z"
          />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          {/* display: flex -- ImageResponse requires it on any element with
              more than one child, and the wordmark has two with the ™. */}
          <Wordmark tm style={{ display: "flex", fontSize: 64, fontWeight: 700, color: "#ffffff" }} />
          <div style={{ fontSize: 28, color: "#c3c2b7" }}>Grows in any soil.</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
