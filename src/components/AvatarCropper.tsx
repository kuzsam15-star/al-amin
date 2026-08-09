"use client";

import Cropper, { Area } from "react-easy-crop";
import { ChangeEvent, useEffect, useId, useRef, useState } from "react";

const acceptedImageTypes = ["image/jpeg", "image/png", "image/webp"];

async function cropToAvatar(source: string, area: Area, original: File) {
  const image = new Image();
  image.src = source;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Не удалось открыть изображение."));
  });

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось подготовить изображение.");

  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, 512, 512);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("Не удалось сохранить изображение.");
  return new File([blob], `${original.name.replace(/\.[^.]+$/, "") || "avatar"}.webp`, { type: "image/webp" });
}

export type AvatarCropSettings = {
  crop: { x: number; y: number };
  zoom: number;
  croppedAreaPixels: Area;
};

type AvatarCropperProps = {
  file: File;
  initialSettings?: AvatarCropSettings | null;
  onSave: (file: File, settings: AvatarCropSettings) => void | Promise<void>;
  onCancel: () => void;
  onReplace?: (file: File) => void;
};

export function AvatarCropper({ file, initialSettings, onSave, onCancel, onReplace }: AvatarCropperProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState(initialSettings?.crop ?? { x: 0, y: 0 });
  const [zoom, setZoom] = useState(initialSettings?.zoom ?? 1);
  const [area, setArea] = useState<Area | null>(initialSettings?.croppedAreaPixels ?? null);
  const [saving, setSaving] = useState(false);
  const [imageState, setImageState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyOverflow = document.body.style.overflow;
    const bodyPaddingRight = document.body.style.paddingRight;
    const bodyPosition = document.body.style.position;
    const bodyTop = document.body.style.top;
    const bodyLeft = document.body.style.left;
    const bodyRight = document.body.style.right;
    const bodyWidth = document.body.style.width;
    const htmlOverflow = document.documentElement.style.overflow;
    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;
    const scrollPosition = window.scrollY;

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollPosition}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.documentElement.style.overflow = "hidden";
    if (scrollbarGap > 0) document.body.style.paddingRight = `${scrollbarGap}px`;

    const frame = requestAnimationFrame(() => dialog?.focus({ preventScroll: true }));
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = bodyOverflow;
      document.body.style.paddingRight = bodyPaddingRight;
      document.body.style.position = bodyPosition;
      document.body.style.top = bodyTop;
      document.body.style.left = bodyLeft;
      document.body.style.right = bodyRight;
      document.body.style.width = bodyWidth;
      document.documentElement.style.overflow = htmlOverflow;
      window.scrollTo({ top: scrollPosition, left: 0, behavior: "auto" });
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [onCancel, saving]);

  useEffect(() => {
    let cancelled = false;
    setImageState("loading");
    setError("");
    setCrop(initialSettings?.crop ?? { x: 0, y: 0 });
    setZoom(initialSettings?.zoom ?? 1);
    setArea(initialSettings?.croppedAreaPixels ?? null);
    setSource(null);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (cancelled || typeof result !== "string") return;
      const image = new Image();
      image.onload = () => {
        if (!cancelled) {
          setSource(result);
          setImageState("ready");
        }
      };
      image.onerror = () => {
        if (!cancelled) {
          setImageState("error");
          setError("Не удалось открыть эту фотографию. Выберите JPEG, PNG или WebP.");
        }
      };
      image.src = result;
    };
    reader.onerror = () => {
      if (!cancelled) {
        setImageState("error");
        setError("Не удалось подготовить фотографию для кадрирования.");
      }
    };
    reader.readAsDataURL(file);
    return () => { cancelled = true; reader.abort(); };
  }, [file, initialSettings]);

  function replaceImage(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    event.target.value = "";
    if (!next || !onReplace) return;
    if (!acceptedImageTypes.includes(next.type) || next.size > 12 * 1024 * 1024) {
      setError("Выберите JPEG, PNG или WebP размером до 12 МБ.");
      return;
    }
    onReplace(next);
  }

  async function save() {
    if (!area || !source || imageState !== "ready") return;
    setSaving(true);
    setError("");
    try {
      await onSave(await cropToAvatar(source, area, file), { crop, zoom, croppedAreaPixels: area });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось обработать изображение.");
      setSaving(false);
    }
  }

  return <div className="crop-modal">
    <div ref={dialogRef} className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      <header className="crop-dialog-header">
        <h2 id={titleId}>Настройте основную фотографию</h2>
        <p id={descriptionId}>Перетащите фотографию и измените масштаб. В каталоге будет видна круглая область.</p>
      </header>
      <div className="crop-dialog-body">
        <div className="crop-stage" aria-busy={imageState === "loading"}>
          {imageState === "loading" && <span className="crop-loading">Загружаем фотографию…</span>}
          {imageState === "ready" && source && <Cropper image={source} crop={crop} zoom={zoom} initialCroppedAreaPixels={initialSettings?.croppedAreaPixels} aspect={1} cropShape="round" showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setArea(pixels)} />}
        </div>
        <label className="crop-range">Масштаб
          <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} disabled={imageState !== "ready"} />
        </label>
        {onReplace && <label className="button secondary crop-replace">Заменить фотографию
          <input className="visually-hidden" type="file" accept={acceptedImageTypes.join(",")} onChange={replaceImage} disabled={saving} />
        </label>}
        {error && <p className="form-message">{error}</p>}
      </div>
      <div className="crop-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={saving}>Отмена</button>
        <button type="button" className="button" onClick={save} disabled={saving || imageState !== "ready"}>{saving ? "Сохраняем…" : "Сохранить"}</button>
      </div>
    </div>
  </div>;
}
