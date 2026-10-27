"use client";

import { useEffect, useRef } from "react";

/**
 * A hidden `tz` field carrying the browser's IANA zone, so an action that
 * signs someone in can work out their calendar day before their settings
 * row has a zone (a brand-new user's does not). Filled after mount -- the
 * server can't know it -- and empty without JS, which falls back to UTC.
 */
export function BrowserTimeZoneField() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  }, []);
  return <input ref={ref} type="hidden" name="tz" defaultValue="" />;
}
