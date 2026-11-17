"use client";

import { PETAL } from "@/components/SorrelMark";

// The month recap's share image, drawn ON THE DEVICE with a canvas. No
// figure is sent anywhere to draw it, and nothing about it is logged. The
// lines come from lib/monthStory.ts (shareLines), already chosen for the
// "Show amounts" setting; this only lays them out.
//
// Colours are the theme's own tokens, read from the page -- never a hex
// literal here -- so the image looks like the screen it came from. Text
// wears ink tokens only; the mark wears --mark.

const WIDTH = 1080;
const HEIGHT = 1350;
const PAD = 96;

function token(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

/** Word-wraps `text` to `maxWidth`, in the context's current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/** Draws the image and returns it as a PNG file. */
export async function drawRecapImage(title: string, lines: string[], fileName: string): Promise<File> {
  // The page's own font, once it has loaded, so the image matches the app.
  try {
    await document.fonts.ready;
  } catch {
    // No font loading API: the fallback font draws the same words.
  }
  const root = getComputedStyle(document.documentElement);
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");

  ctx.fillStyle = token(root, "--page");
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // The card.
  const inset = 48;
  ctx.fillStyle = token(root, "--surface");
  ctx.beginPath();
  ctx.roundRect(inset, inset, WIDTH - inset * 2, HEIGHT - inset * 2, 48);
  ctx.fill();

  // The mark: three leaflets, the same path as components/SorrelMark.
  const markSize = 120;
  ctx.save();
  ctx.translate(PAD + 8, PAD + 8);
  ctx.scale(markSize / 100, markSize / 100);
  ctx.fillStyle = token(root, "--mark");
  const petal = new Path2D(PETAL);
  for (const angle of [0, 120, 240]) {
    ctx.save();
    ctx.translate(50, 50);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.translate(-50, -50);
    ctx.fill(petal);
    ctx.restore();
  }
  ctx.restore();

  const textWidth = WIDTH - PAD * 2 - 16;
  let y = PAD + markSize + 120;

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = token(root, "--ink");
  ctx.font = `700 96px ${font}`;
  for (const l of wrap(ctx, title, textWidth)) {
    ctx.fillText(l, PAD + 8, y);
    y += 110;
  }
  y += 40;

  ctx.font = `500 56px ${font}`;
  for (const line of lines) {
    ctx.fillStyle = token(root, "--ink");
    for (const l of wrap(ctx, line, textWidth)) {
      ctx.fillText(l, PAD + 8, y);
      y += 70;
    }
    y += 36;
  }

  ctx.fillStyle = token(root, "--ink-secondary");
  ctx.font = `500 40px ${font}`;
  ctx.fillText("Sorrel", PAD + 8, HEIGHT - PAD - 8);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No image");
  return new File([blob], fileName, { type: "image/png" });
}

/** Whether this browser can share an image file (Web Share API, level 2). */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** The fallback: the same file, saved as a download. */
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Released after the click has handed the file to the browser.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
