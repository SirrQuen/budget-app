import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";
import { LegalLinks } from "@/components/legal/LegalLinks";

// The first screen a signed-out visitor sees ("/" forwards here), so it
// carries the legal footer until there is a landing page.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AuthBrandPanel />
      <div className="flex flex-1 flex-col bg-surface px-4 md:px-12">
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <footer className="flex justify-center pb-6">
          <LegalLinks ring="surface" />
        </footer>
      </div>
    </div>
  );
}
