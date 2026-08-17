"use client";

import { ChangeEvent, useState } from "react";
import { AvatarCropper } from "@/components/AvatarCropper";
import { hasDuplicateFiles } from "@/lib/client-file-fingerprint";
import { profileMediaUrl } from "@/lib/media-paths";
import { russianCount } from "@/lib/russian-count.mjs";

const accepted = ["image/jpeg", "image/png", "image/webp"];
const maxFileSize = 12 * 1024 * 1024;
const publicUrl = profileMediaUrl;
const photoAccusativeForms = { one: "фотографию", few: "фотографии", many: "фотографий" };
const availablePhotosMessage = (count: number) => `Можно добавить ещё ${russianCount(count, photoAccusativeForms)} из 10.`;

function isAccepted(file: File) {
  return accepted.includes(file.type) && file.size <= maxFileSize;
}

export function OwnerMediaFields({ main, gallery, allowGallery = true, required = false }: { main: string | null; gallery: string[]; allowGallery?: boolean; required?: boolean }) {
  const [mainPath, setMainPath] = useState(main ?? "");
  const [galleryPaths, setGalleryPaths] = useState(gallery);
  const [selectedGalleryFiles, setSelectedGalleryFiles] = useState<File[]>([]);
  const [candidate, setCandidate] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(file: File, kind: "avatar" | "gallery") {
    const data = new FormData();
    data.set("file", file);
    data.set("kind", kind);
    const response = await fetch("/api/media", { method: "POST", body: data });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "Не удалось загрузить фотографию.");
    return json.path as string;
  }

  function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isAccepted(file)) {
      setMessage("Выберите JPEG, PNG или WebP размером до 12 МБ.");
      return;
    }
    setMessage("");
    setCandidate(file);
  }

  async function openExistingAvatar() {
    if (!mainPath || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/media/source?path=${encodeURIComponent(mainPath)}`, { cache: "no-store" });
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(error?.error ?? "Не удалось загрузить текущую фотографию.");
      }
      const blob = await response.blob();
      if (blob.type !== "image/webp") throw new Error("Сервер вернул некорректный формат фотографии.");
      setCandidate(new File([blob], "current-avatar.webp", { type: blob.type }));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось открыть редактор фотографии.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAvatar(file: File) {
    setBusy(true);
    setMessage("");
    try {
      setMainPath(await upload(file, "avatar"));
      setMessage("Кадрирование применено. Сохраните профиль, чтобы отправить изменения на модерацию.");
      setCandidate(null);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось обработать фотографию.");
    } finally {
      setBusy(false);
    }
  }

  async function selectGallery(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    if (galleryPaths.length + files.length > 10) {
      setMessage(availablePhotosMessage(Math.max(0, 10 - galleryPaths.length)));
      return;
    }
    if (files.some((file) => !isAccepted(file))) {
      setMessage("Добавляйте JPEG, PNG или WebP размером до 12 МБ.");
      return;
    }
    if (await hasDuplicateFiles(files, selectedGalleryFiles)) {
      setMessage("Одинаковые фотографии нельзя добавлять повторно.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const paths: string[] = [];
      for (const file of files) paths.push(await upload(file, "gallery"));
      setGalleryPaths((current) => [...current, ...paths]);
      setSelectedGalleryFiles((current) => [...current, ...files]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Не удалось загрузить фотографии.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="form-field full owner-media">
    <input type="hidden" name="mainImagePath" value={mainPath} />
    {allowGallery && galleryPaths.map((path) => <input key={path} type="hidden" name="galleryPaths" value={path} />)}

    <div className="owner-media-heading"><label>Основная фотография</label><span>Настройте кадрирование до отправки на модерацию.</span></div>
    <div className="owner-media-main">
      <div className="owner-avatar">{mainPath ? <img src={publicUrl(mainPath)} alt="Текущая основная фотография" /> : <span>Нет фотографии</span>}</div>
      <div className="media-actions">
        {mainPath ? <button type="button" className="button secondary" onClick={openExistingAvatar} disabled={busy}>Изменить кадрирование</button> : <label className="button secondary">Выбрать фотографию<input className="visually-hidden" type="file" accept={accepted.join(",")} disabled={busy} onChange={selectAvatar} /></label>}
        {mainPath && <label className="button secondary">Заменить<input className="visually-hidden" type="file" accept={accepted.join(",")} disabled={busy} onChange={selectAvatar} /></label>}
        {mainPath && !required && <button type="button" className="button secondary" onClick={() => setMainPath("")} disabled={busy}>Удалить</button>}
      </div>
    </div>

    {allowGallery ? <>
      <div className="owner-gallery-heading"><label>Галерея портфолио</label><p className="meta gallery-count">{availablePhotosMessage(Math.max(0, 10 - galleryPaths.length))}</p></div>
      {galleryPaths.length > 0 && <div className="owner-gallery">{galleryPaths.map((path) => <div key={path}><img src={publicUrl(path)} alt="Фотография галереи" /><button type="button" onClick={() => setGalleryPaths((current) => current.filter((item) => item !== path))}>Удалить</button></div>)}</div>}
      <label className="button secondary media-upload">Добавить фотографии<input className="visually-hidden" type="file" multiple accept={accepted.join(",")} disabled={busy || galleryPaths.length >= 10} onChange={selectGallery} /></label>
    </> : null}
    {busy && <small>Обрабатываем изображения…</small>}
    {message && <small className="form-message">{message}</small>}
    {candidate && <AvatarCropper file={candidate} onCancel={() => setCandidate(null)} onSave={saveAvatar} onReplace={setCandidate} />}
  </div>;
}
