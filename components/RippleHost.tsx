"use client";

import { useEffect } from "react";
import { prefersReducedMotion } from "@/components/ui/useReducedMotion";

// The ripple on primary buttons: white at 35%, spreading from the tap
// point and fading in 400ms. One listener for the whole app, mounted once
// by the shell: a button opts in with `data-ripple` (buttonClass does it),
// so Server Components keep using <Button> unchanged. The ripple is a
// plain DOM node appended to the button and removed when its animation
// ends -- React never sees it. Not under reduced motion, and not on a
// disabled button.
export function RippleHost() {
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 || prefersReducedMotion()) return;
      const target = event.target as Element | null;
      const button = target?.closest<HTMLElement>("[data-ripple]");
      if (!button || button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true") return;
      const rect = button.getBoundingClientRect();
      // Big enough to reach the farthest corner from the tap.
      const size =
        2 * Math.hypot(Math.max(event.clientX - rect.left, rect.right - event.clientX), Math.max(event.clientY - rect.top, rect.bottom - event.clientY));
      const ripple = document.createElement("span");
      ripple.className = "button-ripple";
      ripple.setAttribute("aria-hidden", "true");
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
      button.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
      // If the animation never runs (display:none ancestor), don't leak.
      setTimeout(() => ripple.remove(), 600);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);
  return null;
}
