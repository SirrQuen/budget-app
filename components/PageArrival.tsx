"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { useReducedMotion } from "@/components/ui/useReducedMotion";

// Page changes: a fade and an 8px rise over --motion-fast. It runs only
// after a client navigation -- the first render, a reload and a deep link
// show the page still (docs/Motion-and-Delight.md, rule 6). The pathname
// is compared during render, so the new page arrives already carrying its
// class; two keyframe names alternate so back-to-back navigations restart
// the animation without remounting the page.
export function PageArrival({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const [seen, setSeen] = useState(pathname);
  const [arrivals, setArrivals] = useState(0);
  if (pathname !== seen) {
    setSeen(pathname);
    setArrivals(arrivals + 1);
  }
  const animation = reduced || arrivals === 0 ? "" : arrivals % 2 === 0 ? "page-arrive-a" : "page-arrive-b";
  return <div className={animation}>{children}</div>;
}
