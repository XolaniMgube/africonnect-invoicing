import { Suspense } from "react";
import { Shell } from "@/components/shell";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="loading">Opening workspace…</div>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
