import { SorrelLoader } from "@/components/SorrelLoader";

// The one route-level load with no content shape: this boundary wraps the
// (app) and (auth) layouts themselves, so it shows while the app shell is
// still being built (entering the app from sign-in, a cold load) -- before
// there's a header, nav or page frame for a skeleton to sit in. Every page
// under (app) has its own skeleton loading.tsx, and those take over once
// the shell exists.
export default function RootLoading() {
  return <SorrelLoader className="min-h-dvh flex-1" />;
}
