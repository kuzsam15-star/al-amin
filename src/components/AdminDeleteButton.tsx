"use client";

import { useFormStatus } from "react-dom";

export function AdminDeleteButton({ confirmation, children = "Удалить" }: { confirmation: string; children?: string }) {
  const { pending } = useFormStatus();
  function confirmDeletion(event: React.MouseEvent<HTMLButtonElement>) {
    if (!window.confirm(confirmation)) event.preventDefault();
  }
  return <button type="submit" className="button secondary admin-delete-button" onClick={confirmDeletion} disabled={pending}>{pending ? "Удаляем…" : children}</button>;
}
