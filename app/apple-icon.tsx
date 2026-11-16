import { renderAppIcon } from "@/lib/appIcon";

// iOS home screen: the primary icon at 180. (iOS applies its own corner
// mask, so no rounding here.)
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon("primary", 180);
}
