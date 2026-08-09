"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CivicFooter } from "./CivicFooter";
import { CivicHeader } from "./CivicHeader";

export function AdaptiveSiteShell({ children, brandName }: { children: ReactNode; brandName: string }) {
  const pathname = usePathname();
  const standaloneCivicHome = pathname === "/" || pathname === "/design-preview";

  return (
    <div className="civic-preview-mode">
      {standaloneCivicHome
        ? children
        : <><CivicHeader brandName={brandName} /><main className="civic-main">{children}</main><CivicFooter brandName={brandName} /></>}
    </div>
  );
}
