"use client";
import { ChangeEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { updateAvatar } from "@/app/admin/actions";

async function toWebp(file: File, maxSide: number) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const target = new Image(); target.onload = () => resolve(target); target.onerror = reject; target.src = URL.createObjectURL(file); });
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement("canvas"); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale); canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("image conversion failed")), "image/webp", 0.85));
}
export function AvatarUpload({ profileId }: { profileId: string }) {
  const [message, setMessage] = useState(""); const [pending, setPending] = useState(false);
  async function upload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setMessage("Выберите JPG, PNG или WebP до 5 МБ."); return; } setPending(true); try { const [large, thumb] = await Promise.all([toWebp(file, 640), toWebp(file, 160)]); const supabase = createSupabaseBrowserClient(); const path = `${profileId}/avatar.webp`; const uploads = await Promise.all([supabase.storage.from("avatars").upload(path, large, { contentType: "image/webp", upsert: true }), supabase.storage.from("avatars").upload(`${profileId}/avatar-thumb.webp`, thumb, { contentType: "image/webp", upsert: true })]); if (uploads.some((entry) => entry.error)) throw new Error("upload failed"); await updateAvatar(profileId, path); setMessage("Аватар обработан и сохранён."); } catch { setMessage("Не удалось загрузить аватар."); } finally { setPending(false); event.target.value = ""; } }
  return <label className="upload"><span>{pending ? "Обработка…" : "Загрузить аватар"}</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={upload} />{message && <small role="status">{message}</small>}</label>;
}
