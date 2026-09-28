"use client";

import { Check, Download, ImagePlus, Mail, Plus, Share2, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  alaminSubmissionFileLimits,
  createAlaminSubmissionPackage,
  safeAlaminFileName,
  validateAlaminSubmissionPackage,
} from "@/lib/alamin-submission-file.mjs";
import { catalogSubmissionConsent, catalogSubmissionContractVersion, catalogSubmissionLimits } from "@/lib/catalog-submission-contract.mjs";
import { categoryTaxonomyVersion, getCategoryLabels } from "@/lib/category-registry.mjs";
import {
  catalogSubmissionDraftStorageKey,
  createEmptyCatalogSubmissionDraft,
  hasMeaningfulCatalogSubmissionDraft,
  parseCatalogSubmissionDraft,
  serializeCatalogSubmissionDraft,
} from "@/lib/catalog-submission-draft.mjs";
import type { CatalogSubmissionDraft, CatalogSubmissionDraftFields } from "@/lib/catalog-submission-draft.mjs";
import { PhotoCropSurface } from "./PhotoCropSurface";
import { CategorySelectorDialog } from "./CategorySelectorDialog";
import styles from "./catalog-submission-form.module.css";

type WorkMode = "online" | "offline" | "both";
type HelpTopic = { title: string; description: string };
type WorkOffer = { title: string; mode: WorkMode; durationMinutes: string; price: string; currency: string };
type PortfolioItem = { title: string; description: string; url: string };

const currencies = ["RUB", "USD", "EUR", "KZT", "AED", "TRY", "UZS"];

type OwnerContacts = { email?: string; telegram?: string; phone?: string; website?: string };
type GeneratedPackage = { blob: Blob; fileName: string; compatibleFileName: string; size: number; revision: string };

function normalizeWebsite(value: string) {
  if (!value.trim()) return "";
  return /^https:\/\//iu.test(value.trim()) ? value.trim() : `https://${value.trim().replace(/^\/+|\/+$/gu, "")}`;
}

function fileToBase64(file: File) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    return window.btoa(binary);
  });
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function telegramHref(value?: string) {
  if (!value) return "";
  const username = value.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//iu, "").replace(/^@/u, "").split(/[?/#]/u)[0].trim();
  return /^[A-Za-z0-9_]{5,32}$/u.test(username) ? `https://t.me/${username}` : "";
}

function RepeaterHeader({ title, onRemove }: { title: string; onRemove: () => void }) {
  return <div className={styles.repeaterHead}><h3>{title}</h3><button type="button" onClick={onRemove}><Trash2 aria-hidden="true" size={17} />Удалить</button></div>;
}

export function CatalogSubmissionForm({ ownerContacts }: { ownerContacts: OwnerContacts }) {
  const emptyDraft = useMemo(() => createEmptyCatalogSubmissionDraft(), []);
  const [fields, setFields] = useState<CatalogSubmissionDraftFields>(emptyDraft.fields);
  const [categoryIds, setCategoryIds] = useState<string[]>(emptyDraft.categoryIds);
  const [legacyCategories, setLegacyCategories] = useState<string[]>(emptyDraft.legacyCategories);
  const [missingCategoryRequest, setMissingCategoryRequest] = useState(emptyDraft.missingCategoryRequest);
  const [helpTopics, setHelpTopics] = useState<HelpTopic[]>(emptyDraft.helpTopics);
  const [workOffers, setWorkOffers] = useState<WorkOffer[]>(emptyDraft.workOffers);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>(emptyDraft.portfolio);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [profileCrop, setProfileCrop] = useState(emptyDraft.profileCrop);
  const [avatar, setAvatar] = useState(emptyDraft.avatar);
  const [cropConfirmed, setCropConfirmed] = useState(false);
  const [photoWasSelected, setPhotoWasSelected] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");
  const [generated, setGenerated] = useState<GeneratedPackage | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "working" | "success" | "error"; message: string }>({ kind: "idle", message: "" });
  const formRef = useRef<HTMLFormElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photo) { setPreview(""); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    let restored: CatalogSubmissionDraft | null = null;
    try {
      restored = parseCatalogSubmissionDraft(window.localStorage.getItem(catalogSubmissionDraftStorageKey));
    } catch {
      setDraftNotice("Браузер не разрешил прочитать локальный черновик. Не закрывайте страницу до скачивания заявки.");
    }
    if (restored && hasMeaningfulCatalogSubmissionDraft(restored)) {
      setFields(restored.fields);
      setCategoryIds(restored.categoryIds);
      setLegacyCategories(restored.legacyCategories);
      setMissingCategoryRequest(restored.missingCategoryRequest);
      setHelpTopics(restored.helpTopics);
      setWorkOffers(restored.workOffers);
      setPortfolio(restored.portfolio);
      setProfileCrop(restored.profileCrop);
      setAvatar(restored.avatar);
      setPhotoWasSelected(restored.photoWasSelected);
      const legacyNotice = restored.legacyCategories.length ? " Старые категории сохранены для уточнения — выберите подходящие пункты из нового справочника." : "";
      setDraftNotice((restored.photoWasSelected
        ? "Черновик восстановлен. Текст и настройки сохранены, фотографию выберите заново."
        : "Черновик восстановлен. Можно продолжить заполнение.") + legacyNotice);
    }
    setDraftReady(true);
  }, []);

  const draftValue = useMemo<CatalogSubmissionDraft>(() => ({
    fields,
    taxonomyVersion: categoryTaxonomyVersion,
    categoryIds,
    legacyCategories,
    missingCategoryRequest,
    helpTopics,
    workOffers,
    portfolio,
    profileCrop,
    avatar,
    photoWasSelected: Boolean(photo) || photoWasSelected,
  }), [avatar, categoryIds, fields, helpTopics, legacyCategories, missingCategoryRequest, photo, photoWasSelected, portfolio, profileCrop, workOffers]);

  const draftRevision = useMemo(() => JSON.stringify({
    draft: draftValue,
    photo: photo ? { name: photo.name, size: photo.size, type: photo.type, lastModified: photo.lastModified } : null,
  }), [draftValue, photo]);

  useEffect(() => {
    if (!draftReady) return;
    try {
      if (hasMeaningfulCatalogSubmissionDraft(draftValue)) {
        window.localStorage.setItem(catalogSubmissionDraftStorageKey, serializeCatalogSubmissionDraft(draftValue));
      } else {
        window.localStorage.removeItem(catalogSubmissionDraftStorageKey);
      }
    } catch {
      setDraftNotice("Браузер не разрешил сохранить локальный черновик. Не закрывайте страницу до скачивания заявки.");
    }
  }, [draftReady, draftValue]);

  useEffect(() => {
    if (!generated || generated.revision === draftRevision) return;
    setGenerated(null);
    setStatus({ kind: "idle", message: "Данные изменены. Скачайте новую актуальную версию заявки." });
  }, [draftRevision, generated]);

  const photoError = useMemo(() => {
    if (!photo) return "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type)) return "Разрешены только JPEG, PNG и WebP.";
    if (photo.size > catalogSubmissionLimits.photoBytes) return "Фотография должна быть не больше 8 МБ.";
    return "";
  }, [photo]);

  function updateField<Key extends keyof CatalogSubmissionDraftFields>(key: Key, value: CatalogSubmissionDraftFields[Key]) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  function startNewApplication() {
    if (!window.confirm("Очистить заполненную форму и начать новую заявку?")) return;
    const next = createEmptyCatalogSubmissionDraft();
    setFields(next.fields);
    setCategoryIds(next.categoryIds);
    setLegacyCategories(next.legacyCategories);
    setMissingCategoryRequest(next.missingCategoryRequest);
    setHelpTopics(next.helpTopics);
    setWorkOffers(next.workOffers);
    setPortfolio(next.portfolio);
    setProfileCrop(next.profileCrop);
    setAvatar(next.avatar);
    setCropConfirmed(false);
    setPhoto(null);
    setPhotoWasSelected(false);
    setGenerated(null);
    setStatus({ kind: "idle", message: "" });
    setDraftNotice("");
    window.localStorage.removeItem(catalogSubmissionDraftStorageKey);
    if (photoInputRef.current) photoInputRef.current.value = "";
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateItem<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number, patch: Partial<T>) {
    setter((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    if (!photo || photoError) {
      setStatus({ kind: "error", message: photoError || "Добавьте фотографию." });
      return;
    }
    if (!categoryIds.length && !missingCategoryRequest.trim()) {
      setStatus({ kind: "error", message: "Выберите хотя бы одну категорию или опишите, чего не хватает." });
      return;
    }
    const payload = {
      contractVersion: catalogSubmissionContractVersion,
      fullName: fields.fullName,
      specialization: fields.specialization,
      country: fields.country,
      city: fields.city,
      workMode: fields.workMode,
      experienceYears: fields.experienceYears || null,
      // Legacy-only fields remain importable in old drafts and .alamin files, but
      // the current candidate UI must never submit values the candidate cannot see.
      profileSummary: "",
      about: fields.about,
      taxonomyVersion: categoryTaxonomyVersion,
      categoryIds,
      categories: getCategoryLabels(categoryIds),
      missingCategoryRequest: missingCategoryRequest.trim(),
      helpTopics: [],
      workOffers: workOffers.filter((item) => item.title.trim()).map((item) => ({ title: item.title, mode: item.mode, durationMinutes: item.durationMinutes || null, price: item.price || null, currency: item.price ? item.currency : null })),
      contacts: {
        phone: fields.phone || undefined,
        email: fields.email || undefined,
        telegram: fields.telegram || undefined,
        whatsapp: fields.whatsapp || undefined,
        website: normalizeWebsite(fields.website) || undefined,
      },
      portfolio: [],
      profileCrop,
      avatar,
      photo: { originalName: photo.name, contentType: photo.type, size: photo.size },
      consent: fields.consent,
      consentText: catalogSubmissionConsent,
    };
    setStatus({ kind: "working", message: "Готовим безопасный файл заявки…" });
    try {
      const packageValue = createAlaminSubmissionPackage({
        packageId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        payload,
        attachment: { filename: photo.name, mediaType: photo.type, data: await fileToBase64(photo) },
      });
      const validation = validateAlaminSubmissionPackage(packageValue);
      if (validation.errors.length) throw new Error(validation.errors[0]);
      const json = `${JSON.stringify(packageValue)}\n`;
      const bytes = new TextEncoder().encode(json).byteLength;
      if (bytes > alaminSubmissionFileLimits.packageBytes) throw new Error("Файл заявки превышает 24 МиБ. Выберите фотографию меньшего размера.");
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const fileName = safeAlaminFileName(payload.fullName);
      const compatibleFileName = safeAlaminFileName(payload.fullName, ".alamin.json");
      const nextGenerated = { blob, fileName, compatibleFileName, size: bytes, revision: draftRevision };
      setGenerated(nextGenerated);
      triggerDownload(blob, fileName);
      setStatus({ kind: "success", message: "Сохраните файл и отправьте его владельцу каталога. После проверки информация может быть добавлена на сайт." });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Не удалось создать файл заявки." });
    }
  }

  async function shareGenerated() {
    if (!generated) return;
    const file = new File([generated.blob], generated.fileName, { type: "application/json" });
    if (!navigator.canShare?.({ files: [file] })) return;
    try { await navigator.share({ files: [file], title: "Заявка специалиста AL-AMIN" }); }
    catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
  }

  const ownerTelegram = telegramHref(ownerContacts.telegram);
  const canShareFiles = typeof navigator !== "undefined" && typeof navigator.canShare === "function";

  return <main className={styles.page}>
    <header className={styles.intro}>
      <p className="page-eyebrow">Заявка специалиста</p>
      <h1>Расскажите о своей работе</h1>
      <p>Заполните понятную анкету. Профиль появится в каталоге только после ручной проверки владельцем AL-AMIN.</p>
    </header>
    {draftNotice ? <section className={styles.draftNotice} role="status"><strong>Локальный черновик</strong><p>{draftNotice}</p></section> : null}
    {status.kind === "success" && generated ? <section className={styles.success} role="status"><span><Check aria-hidden="true" size={25} /></span><div><h2>Заявка готова</h2><p>{status.message}</p><div className={styles.successActions}><button type="button" onClick={() => triggerDownload(generated.blob, generated.fileName)}><Download aria-hidden="true" size={17} />Скачать заявку</button><button type="button" className={styles.secondaryAction} onClick={() => triggerDownload(generated.blob, generated.compatibleFileName)}>Скачать совместимый .alamin.json</button>{canShareFiles ? <button type="button" className={styles.secondaryAction} onClick={shareGenerated}><Share2 aria-hidden="true" size={17} />Поделиться файлом</button> : null}{ownerTelegram ? <a href={ownerTelegram} target="_blank" rel="noopener noreferrer">Открыть Telegram владельца</a> : null}{ownerContacts.email ? <a href={`mailto:${ownerContacts.email}`}><Mail aria-hidden="true" size={17} />Написать владельцу</a> : null}<button type="button" className={styles.secondaryAction} onClick={startNewApplication}>Начать новую заявку</button></div><small>Размер файла: {(generated.size / 1024 / 1024).toFixed(2)} МиБ. Черновик сохранён — при необходимости исправьте данные и скачайте новый файл.</small></div></section> : null}
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate={false}>
      <section className={styles.panel}><div className={styles.sectionTitle}><span>01</span><div><h2>О специалисте</h2><p>Основная информация, которую увидят посетители каталога.</p></div></div><div className={styles.grid}>
        <label className={styles.wide}>Имя и фамилия<input name="fullName" required maxLength={160} autoComplete="name" value={fields.fullName} onChange={(event) => updateField("fullName", event.target.value)} /></label>
        <label className={styles.wide}>Специализация<input name="specialization" required maxLength={180} placeholder="Например, семейный психолог" value={fields.specialization} onChange={(event) => updateField("specialization", event.target.value)} /></label>
        <label>Страна<input name="country" required maxLength={100} autoComplete="country-name" value={fields.country} onChange={(event) => updateField("country", event.target.value)} /></label>
        <label>Город<input name="city" required maxLength={100} autoComplete="address-level2" value={fields.city} onChange={(event) => updateField("city", event.target.value)} /></label>
        <label>Как вы работаете<select name="workMode" value={fields.workMode} onChange={(event) => updateField("workMode", event.target.value as WorkMode)}><option value="online">Онлайн</option><option value="offline">Очно</option><option value="both">Онлайн и очно</option></select></label>
        <label>Опыт, лет<input name="experienceYears" type="number" min="0" max="80" inputMode="numeric" value={fields.experienceYears} onChange={(event) => updateField("experienceYears", event.target.value)} /></label>
        <label className={styles.wide}>О себе и подходе к работе<textarea name="about" required maxLength={3000} rows={7} value={fields.about} onChange={(event) => updateField("about", event.target.value)} /></label>
      </div></section>

      <section className={styles.panel}><div className={styles.sectionTitle}><span>02</span><div><h2>Фотография</h2><p>Исходник хранится только в файле заявки. Финальные WebP‑версии создаются после одобрения владельцем.</p></div></div>
        <div className={styles.photoPicker}><label className={styles.fileButton}>Выбрать фотографию<input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => { const nextPhoto = event.target.files?.[0] ?? null; setPhoto(nextPhoto); setPhotoWasSelected(Boolean(nextPhoto)); setCropConfirmed(false); if (nextPhoto) setDraftNotice(""); }} /></label><p>JPEG, PNG или WebP, не более 8 МБ. После восстановления черновика фотографию нужно выбрать заново.</p>{photoError ? <p className={styles.fieldError}>{photoError}</p> : null}</div>
        {preview ? <div className={styles.cropEditor}>
          <PhotoCropSurface label="Фото профиля" description="Перемещайте фото пальцем. Используйте два пальца, чтобы изменить масштаб." src={preview} alt="Предпросмотр фото профиля" aspect={5 / 6} value={profileCrop} defaultValue={emptyDraft.profileCrop} onChange={(value) => { setProfileCrop(value); setCropConfirmed(false); }} />
          <PhotoCropSurface label="Аватар" description="Перемещайте фото пальцем. Используйте два пальца, чтобы изменить масштаб." src={preview} alt="Предпросмотр аватара" aspect={1} round value={avatar} defaultValue={emptyDraft.avatar} onChange={(value) => { setAvatar(value); setCropConfirmed(false); }} />
          <div className={styles.cropDone}><button type="button" onClick={() => setCropConfirmed(true)}><Check size={18} aria-hidden="true" />Готово</button>{cropConfirmed ? <span role="status">Оба кадра сохранены в черновике.</span> : null}</div>
        </div> : <div className={styles.photoPlaceholder}><ImagePlus aria-hidden="true" size={34} /><span>Выберите фотографию, чтобы настроить два кадра.</span></div>}
      </section>

      <section className={styles.panel}><div className={styles.sectionTitle}><span>03</span><div><h2>Категории</h2><p>Выберите до {catalogSubmissionLimits.categories} направлений, по которым вас смогут найти.</p></div></div>
        <div className={styles.chips}>{getCategoryLabels(categoryIds).map((item, index) => <span key={categoryIds[index]}>{item}<button type="button" aria-label={`Удалить ${item}`} onClick={() => setCategoryIds((values) => values.filter((value) => value !== categoryIds[index]))}>×</button></span>)}</div>
        <div className={styles.categoryActions}><CategorySelectorDialog selectedIds={categoryIds} onApply={(ids) => { setCategoryIds(ids); if (ids.length) setLegacyCategories([]); }} /><span>{categoryIds.length ? `Выбрано: ${categoryIds.length} из ${catalogSubmissionLimits.categories}` : "Пока ничего не выбрано"}</span></div>
        {legacyCategories.length ? <div className={styles.legacyCategories} role="status"><strong>Нужно уточнить старые категории</strong><p>{legacyCategories.join(", ")}</p><small>Они сохранены в черновике, но не будут опубликованы как новые рубрики. Выберите соответствия из справочника.</small></div> : null}
        <details className={styles.missingCategory}><summary>Не нашли подходящую категорию?</summary><label>Пояснение владельцу<textarea maxLength={500} rows={3} value={missingCategoryRequest} onChange={(event) => setMissingCategoryRequest(event.target.value)} placeholder="Коротко опишите нужное направление. Владелец рассмотрит запрос вручную." /></label><small>Этот текст сохранится только в заявке и не станет публичной категорией автоматически.</small></details>
      </section>

      <section className={styles.panel}><div className={styles.sectionTitle}><span>04</span><div><h2>Услуги</h2><p>Добавьте конкретные услуги, которые вы предлагаете. Цена и продолжительность могут оставаться пустыми.</p></div></div><div className={styles.repeater}>{workOffers.map((item, index) => <article key={index}><RepeaterHeader title={`Услуга №${index + 1}`} onRemove={() => setWorkOffers((items) => items.filter((_, i) => i !== index))} /><div className={styles.grid}><label className={styles.wide}>Название<input maxLength={160} value={item.title} onChange={(event) => updateItem(setWorkOffers, index, { title: event.target.value })} /></label><label>Формат<select value={item.mode} onChange={(event) => updateItem(setWorkOffers, index, { mode: event.target.value as WorkMode })}><option value="online">Онлайн</option><option value="offline">Очно</option><option value="both">Онлайн и очно</option></select></label><label>Продолжительность, минут<input type="number" min="1" max="1440" value={item.durationMinutes} onChange={(event) => updateItem(setWorkOffers, index, { durationMinutes: event.target.value })} /></label><label>Цена<input type="number" min="0" step="0.01" value={item.price} onChange={(event) => updateItem(setWorkOffers, index, { price: event.target.value })} /></label><label>Валюта<select value={item.currency} onChange={(event) => updateItem(setWorkOffers, index, { currency: event.target.value })}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label></div></article>)}</div><button className={styles.addButton} type="button" onClick={() => setWorkOffers((items) => [...items, { title: "", mode: "online", durationMinutes: "", price: "", currency: "RUB" }])}><Plus aria-hidden="true" size={18} />Добавить услугу</button></section>

      <section className={styles.panel}><div className={styles.sectionTitle}><span>05</span><div><h2>Контакты</h2><p>Укажите хотя бы один способ связи. Владелец проверит их перед публикацией.</p></div></div><div className={styles.grid}><label>Телефон<input name="phone" type="tel" maxLength={80} autoComplete="tel" value={fields.phone} onChange={(event) => updateField("phone", event.target.value)} /></label><label>Email<input name="email" type="email" maxLength={320} autoComplete="email" value={fields.email} onChange={(event) => updateField("email", event.target.value)} /></label><label>Telegram<input name="telegram" maxLength={120} placeholder="@username" value={fields.telegram} onChange={(event) => updateField("telegram", event.target.value)} /></label><label>WhatsApp<input name="whatsapp" maxLength={120} value={fields.whatsapp} onChange={(event) => updateField("whatsapp", event.target.value)} /></label><label className={styles.wide}>Сайт<input name="website" inputMode="url" maxLength={500} placeholder="https://example.com" value={fields.website} onChange={(event) => updateField("website", event.target.value)} /></label></div></section>

      <section className={`${styles.panel} ${styles.consentPanel}`}><p className={styles.fileNotice}>Заявка будет сохранена файлом на вашем устройстве. Чтобы передать её владельцу каталога, отправьте этот файл по указанному контакту. Сам сайт заявку автоматически не отправляет.</p><label className={styles.consent}><span>{catalogSubmissionConsent}</span><input name="consent" type="checkbox" required checked={fields.consent} onChange={(event) => updateField("consent", event.target.checked)} /></label></section>

      <div className={styles.submitBar}><div><p className={styles.limitNote}>Фото до 8 МиБ · файл заявки до 24 МиБ</p><div className={`${styles.status} ${status.kind === "error" ? styles.error : status.kind === "working" ? styles.working : ""}`} role="status" aria-live="polite">{status.kind !== "success" ? status.message : ""}</div></div><button type="submit" disabled={status.kind === "working"}><Download aria-hidden="true" size={19} />Скачать заявку</button></div>
    </form>
  </main>;
}
