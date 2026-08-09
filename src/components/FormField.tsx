import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
};

/** Shared, accessible field rhythm for every product form. */
export function FormField({ children, label, htmlFor, hint, error, required, className = "" }: Props) {
  return <div className={`form-field${error ? " is-error" : ""}${className ? ` ${className}` : ""}`}>
    {label && <label htmlFor={htmlFor}>{label}{required && <span aria-hidden="true"> *</span>}</label>}
    {children}
    {error ? <p className="form-message" role="alert">{error}</p> : hint ? <p className="form-hint">{hint}</p> : null}
  </div>;
}
