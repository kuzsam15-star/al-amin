"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CivicFooter } from "./CivicFooter";
import { CivicHeader } from "./CivicHeader";

export function AdaptiveSiteShell({ children, brandName }: { children: ReactNode; brandName: string }) {
  const pathname = usePathname();
  const standaloneHome = pathname === "/";

  return <div className="civic-site">
    {standaloneHome ? children : <><CivicHeader brandName={brandName} /><main className="civic-main">{children}</main><CivicFooter brandName={brandName} /></>}
  </div>;
}
