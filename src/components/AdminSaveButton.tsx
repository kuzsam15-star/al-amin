"use client";
import { useFormStatus } from "react-dom";

export function AdminSaveButton({ children = "Сохранить решение", name, value }: { children?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return <button className="button" name={name} value={value} disabled={pending}>{pending ? "Сохраняем…" : children}</button>;
}
