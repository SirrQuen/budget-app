import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AuthBrandPanel />
      <div className="flex flex-1 items-center justify-center bg-surface px-4 py-12 md:px-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
