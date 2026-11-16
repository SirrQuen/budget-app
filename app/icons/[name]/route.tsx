import { iconNames, parseIconName, renderAppIcon } from "@/lib/appIcon";

// /icons/primary-512.png, /icons/maskable-512.png, /icons/gold-512.png, ... -- the home
// screen icons the web app manifest points at (app/manifest.ts), drawn by
// lib/appIcon.tsx. Prerendered at build time for exactly the names it
// serves; anything else is a 404. Public: the matcher in proxy.ts lets
// /icons through, since a browser fetches these with no session.
export function generateStaticParams() {
  return iconNames().map((name) => ({ name }));
}

export const dynamicParams = false;

export async function GET(_request: Request, ctx: RouteContext<"/icons/[name]">) {
  const { name } = await ctx.params;
  const icon = parseIconName(name);
  if (!icon) return new Response(null, { status: 404 });
  return renderAppIcon(icon.variant, icon.size);
}
