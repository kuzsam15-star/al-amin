import type { HTMLAttributes, ReactNode } from "react";

export function CivicPageContainer({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`container ${className}`.trim()} {...props}>{children}</div>;
}

export function CivicSection({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`section ${className}`.trim()} {...props}>{children}</section>;
}

export function CivicPageHeader({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: ReactNode }) {
  return <header className="civic-page-header">{eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}<h1 className="page-title">{title}</h1>{description ? <div className="lead">{description}</div> : null}</header>;
}

export function CivicNotice({ children, tone = "info", className = "" }: { children: ReactNode; tone?: "info" | "success" | "error"; className?: string }) {
  return <div className={`notice${tone === "success" ? " saved" : tone === "error" ? " error" : ""} ${className}`.trim()}>{children}</div>;
}

export function CivicState({ title, description, kind = "empty" }: { title: string; description?: ReactNode; kind?: "empty" | "loading" | "error" }) {
  return <div className={`civic-state civic-state-${kind}`} role={kind === "error" ? "alert" : "status"}><h2>{title}</h2>{description ? <div>{description}</div> : null}</div>;
}
