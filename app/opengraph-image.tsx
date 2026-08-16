import { ImageResponse } from "next/og";

export const alt = "EverNest Finance";
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
        <svg width="120" height="120" viewBox="0 0 64 64" fill="none">
          <path d="M6 38 Q32 64 58 38" stroke="#E9B949" strokeWidth={5} strokeLinecap="round" />
          <path
            d="M14 32 Q32 50 50 32"
            stroke="#E9B949"
            strokeWidth={4}
            strokeLinecap="round"
            opacity={0.55}
          />
          <circle cx="32" cy="18" r="9" fill="#E9B949" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 64, fontWeight: 700, color: "#ffffff" }}>EverNest Finance</div>
          <div style={{ fontSize: 28, color: "#c3c2b7" }}>Your wealth, your legacy.</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
