"use client";

/* eslint-disable @next/next/no-img-element -- local blob previews and authenticated media URLs are intentionally rendered without optimization. */

import Link from "next/link";
import { CheckCircle2, ImagePlus, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AvatarCropper, type AvatarCropSettings } from "@/components/AvatarCropper";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { CategoryMultiSelect } from "@/components/CategoryMultiSelect";
import { HelpTopicsEditor } from "@/components/HelpTopicsEditor";
import { WorkOffersEditor } from "@/components/WorkOffersEditor";
import { inferContactMethod, validateApplication, type ContactMethod } from "@/lib/application-validation.mjs";
import { profileMediaUrl } from "@/lib/media-paths";
import { MAX_FULL_DESCRIPTION, MAX_PROFILE_SUMMARY, codePointLength, type HelpTopic, type WorkOffer } from "@/lib/specialist-contract.mjs";
import { russianCount, russianPluralForm } from "@/lib/russian-count.mjs";

type Category = { id: string; name: string; slug: string; group_name?: string | null };
type Values = {
  fullName: string;
  contactMethod: ContactMethod;
  contact: string;
  country: string;
  city: string;
  categoryId: string;
  specialization: string;
  experienceYears: string;
  profileSummary: string;
  description: string;
  truthful: boolean;
  personalData: boolean;
  website: string;
};
type Draft = Partial<Values> & {
  id?: string;
  additionalCategoryIds?: string[];
  mainImagePath?: string | null;
  helpTopics?: HelpTopic[];
  workOffers?: WorkOffer[];
};

const initial: Values = { fullName: "", contactMethod: "phone", contact: "", country: "Россия", city: "", categoryId: "", specialization: "", experienceYears: "", profileSummary: "", description: "", truthful: false, personalData: false, website: "" };
const valuesFromDraft = (draft?: Draft): Values => ({
  fullName: draft?.fullName ?? initial.fullName,
  contactMethod: draft?.contactMethod ?? inferContactMethod(draft?.contact),
  contact: draft?.contact ?? initial.contact,
  country: draft?.country ?? initial.country,
  city: draft?.city ?? initial.city,
  categoryId: draft?.categoryId ?? initial.categoryId,
  specialization: draft?.specialization ?? initial.specialization,
  experienceYears: draft?.experienceYears ?? initial.experienceYears,
  profileSummary: draft?.profileSummary ?? initial.profileSummary,
  description: draft?.description ?? initial.description,
  truthful: draft?.truthful ?? initial.truthful,
  personalData: draft?.personalData ?? initial.personalData,
  website: draft?.website ?? initial.website,
});
const initialHelpTopics = (): HelpTopic[] => [{ title: "", description: null }];
const initialWorkOffers = (): WorkOffer[] => [{ title: "", duration_minutes: null, mode: "both", price: null, currency: null }];
const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const minDescriptionChars = 50;
const descriptionWarningChars = 2700;
const characterForms = { one: "символ", few: "символа", many: "символов" };
const remainingDescriptionMessage = (count: number) => `${russianPluralForm(count, { one: "Остался", few: "Осталось", many: "Осталось" })} ${russianCount(count, characterForms)}.`;
const technicalImageName = /^(?:current-avatar|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?:jpe?g|png|webp)$/i;
const visibleImageName = (file: File | null) => file && !technicalImageName.test(file.name) ? file.name : "";
const fieldLabels: Record<string, string> = {
  main: "Фотография профиля", fullName: "Имя и фамилия", contactMethod: "Способ связи", contact: "Контакт",
  country: "Страна", city: "Город", categoryId: "Основная категория", additionalCategoryIds: "Дополнительные категории",
  specialization: "Специализация", experienceYears: "Опыт работы", profileSummary: "Коротко о себе",
  description: "О себе подробнее", helpTopics: "С чем вы помогаете", workOffers: "Форматы работы",
  truthful: "Достоверность сведений", personalData: "Обработка персональных данных", request: "Форма заявки",
};
const rootField = (field: string) => field.split(".")[0];

export function ApplicationForm({ categories, draft }: { categories: Category[]; draft?: Draft }) {
  const seeded = valuesFromDraft(draft);
  const [values, setValues] = useState<Values>(seeded);
  const [extra, setExtra] = useState<string[]>(draft?.additionalCategoryIds ?? []);
  const [helpTopics, setHelpTopics] = useState<HelpTopic[]>(draft?.helpTopics?.length ? draft.helpTopics : initialHelpTopics());
  const [workOffers, setWorkOffers] = useState<WorkOffer[]>(draft?.workOffers?.length ? draft.workOffers.map((offer) => ({ ...offer, mode: offer.mode ?? "both" })) : initialWorkOffers());
  const [main, setMain] = useState<File | null>(null);
  const [mainSource, setMainSource] = useState<File | null>(null);
  const [mainCropSettings, setMainCropSettings] = useState<AvatarCropSettings | null>(null);
  const [mainPath, setMainPath] = useState(draft?.mainImagePath ?? "");
  const [cropSource, setCropSource] = useState<File | null>(null);
  const [mainPreviewUrl, setMainPreviewUrl] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"error" | "success" | "hint">("hint");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const mainInputRef = useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!main) { setMainPreviewUrl(""); return; }
    const url = URL.createObjectURL(main);
    setMainPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [main]);

  const fieldError = (name: string) => Object.entries(fieldErrors).find(([key]) => rootField(key) === name)?.[1];
  const clearField = (name: string) => setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => rootField(key) !== name)));
  const set = <K extends keyof Values>(key: K, value: Values[K]) => { setValues((current) => ({ ...current, [key]: value })); clearField(key); };
  const focusField = (field: string) => {
    const root = rootField(field);
    const node = document.getElementById(`application-${root}-field`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    const target = root === "main" ? mainInputRef.current : node?.querySelector<HTMLElement>("input:not([type=hidden]),textarea,select,button,[tabindex]");
    target?.focus({ preventScroll: true });
  };
  const applyErrors = (errors: Record<string, string>) => {
    setFieldErrors(errors);
    setMessage("");
    const first = Object.keys(errors)[0];
    if (first) requestAnimationFrame(() => focusField(first));
  };
  const mark = (name: string, extraClass = "") => ({ id: `application-${name}-field`, className: `form-field${extraClass ? ` ${extraClass}` : ""}${fieldError(name) ? " is-error" : ""}` });
  const errorNode = (name: string) => fieldError(name) ? <p id={`application-${name}-error`} className="field-error" role="alert">{fieldError(name)}</p> : null;
  const describedBy = (name: string, hint?: string) => [hint, fieldError(name) ? `application-${name}-error` : ""].filter(Boolean).join(" ") || undefined;
  const acceptable = (file: File) => imageTypes.includes(file.type) && file.size <= 12 * 1024 * 1024;

  function chooseMain(file: File | undefined) {
    if (!file) return;
    if (!acceptable(file)) return void applyErrors({ main: "Фотография профиля: JPEG, PNG или WebP до 12 МБ." });
    setMainSource(file); setMainCropSettings(null); setCropSource(file); clearField("main");
  }
  async function upload(file: File) {
    const form = new FormData(); form.set("file", file); form.set("kind", "avatar");
    const response = await fetch("/api/media", { method: "POST", body: form });
    const data = await response.json().catch(() => null) as { error?: string; path?: string } | null;
    if (!response.ok || !data?.path) throw new Error(data?.error ?? "Не удалось загрузить изображение.");
    return data.path;
  }
  async function cropCurrent() {
    if (!mainPath) return;
    setMessage("");
    try {
      const response = await fetch(`/api/media/source?path=${encodeURIComponent(mainPath)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Не удалось открыть текущую фотографию.");
      const blob = await response.blob();
      const file = new File([blob], "current-avatar.webp", { type: "image/webp" });
      setMainSource(file); setMainCropSettings(null); setCropSource(file);
    } catch { applyErrors({ main: "Не удалось открыть редактор фотографии." }); }
  }

  function requestBody(path: string) {
    return {
      applicationId: draft?.id,
      ...values,
      additionalCategoryIds: extra,
      helpTopics,
      workOffers,
      mainImagePath: path,
    };
  }

  function validate() {
    const body = requestBody(mainPath);
    const result = validateApplication(body, {
      activeCategories: categories,
      allowedExistingMediaPaths: mainPath ? [mainPath] : [],
      hasPendingMainImage: Boolean(main),
    });
    if (result.error) { applyErrors(result.errors); return false; }
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setFieldErrors({});
    if (!validate()) return;
    setPending(true);
    try {
      const uploadedMain = main ? await upload(main) : mainPath;
      const response = await fetch("/api/applications", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKeyRef.current }, body: JSON.stringify(requestBody(uploadedMain)) });
      const data = await response.json().catch(() => null) as { error?: string; field?: string; errors?: Record<string, string> } | null;
      if (!response.ok) {
        if (data?.errors && Object.keys(data.errors).length) { applyErrors(data.errors); return; }
        if (data?.field && data.error) { applyErrors({ [data.field]: data.error }); return; }
        setMessageType("error"); setMessage(data?.error ?? "Не удалось отправить заявку. Попробуйте позже."); return;
      }
      setValues(initial); setExtra([]); setHelpTopics(initialHelpTopics()); setWorkOffers(initialWorkOffers());
      setMain(null); setMainSource(null); setMainCropSettings(null); setMainPath(""); setFieldErrors({});
      idempotencyKeyRef.current = crypto.randomUUID();
      setMessageType("success"); setMessage(draft?.id ? "Заявка повторно отправлена на рассмотрение." : "Заявка отправлена. Мы сообщим о результате после проверки, иншаАллах.");
    } catch {
      setMessageType("error"); setMessage("Не удалось отправить заявку. Проверьте соединение и попробуйте ещё раз.");
    } finally { setPending(false); }
  }

  const chars = codePointLength(values.description);
  const descriptionChars = codePointLength(values.description.trim());
  const summaryChars = codePointLength(values.profileSummary);
  const errorRoots = [...new Set(Object.keys(fieldErrors).map(rootField))];

  return <form className="card form-grid application-form" onSubmit={submit} noValidate>
    {errorRoots.length > 0 && <section className="form-error-summary full" role="alert" aria-labelledby="application-error-summary-title">
      <h2 id="application-error-summary-title">Проверьте данные заявки</h2>
      <p>Исправьте отмеченные поля и отправьте форму ещё раз.</p>
      <ul>{errorRoots.map((field) => <li key={field}><a href={`#application-${field}-field`} onClick={(event) => { event.preventDefault(); focusField(field); }}>{fieldLabels[field] ?? "Поле формы"}: {fieldError(field)}</a></li>)}</ul>
    </section>}

    <div {...mark("main", "full profile-photo-field")}>
      <label className="profile-photo-label" htmlFor="application-main-photo">Фотография профиля <span aria-hidden="true">*</span></label>
      <input id="application-main-photo" name="mainPhoto" ref={mainInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" aria-invalid={Boolean(fieldError("main"))} aria-describedby={describedBy("main", "application-main-photo-hint")} onChange={(event) => { chooseMain(event.target.files?.[0]); event.target.value = ""; }} />
      {!main && !mainPath ? <label className="button secondary profile-photo-picker" htmlFor="application-main-photo"><ImagePlus aria-hidden="true" />Выбрать фотографию</label> : <div className="profile-photo-state">
        <div className="profile-photo-preview-column">
          <div className="profile-photo-preview">{main && mainPreviewUrl ? <img src={mainPreviewUrl} alt="Предпросмотр готовой фотографии профиля" /> : mainPath ? <img src={profileMediaUrl(mainPath)} alt="Текущая фотография профиля" /> : null}</div>
          <button type="button" className="button secondary profile-photo-edit" onClick={() => main && mainSource ? setCropSource(mainSource) : void cropCurrent()}><Pencil aria-hidden="true" />Изменить</button>
        </div>
        <div className="profile-photo-info">
          <p className="profile-photo-success"><CheckCircle2 aria-hidden="true" />{main ? "Новая фотография загружена" : "Фотография профиля сохранена"}</p>
          {visibleImageName(main) && <p className="profile-photo-filename" title={main?.name}>Файл: {visibleImageName(main)}</p>}
          <button type="button" className="profile-photo-delete" onClick={() => { setMain(null); setMainSource(null); setMainCropSettings(null); setMainPath(""); setCropSource(null); }}><Trash2 aria-hidden="true" />Удалить фотографию</button>
        </div>
      </div>}
      <p id="application-main-photo-hint" className="form-hint">Обязательная фотография для верхней части публичного профиля.</p>{errorNode("main")}
    </div>

    <div {...mark("fullName")}><label htmlFor="application-fullName">Имя и фамилия</label><input id="application-fullName" name="fullName" autoComplete="name" required value={values.fullName} aria-invalid={Boolean(fieldError("fullName"))} aria-describedby={describedBy("fullName")} onChange={(event) => set("fullName", event.target.value)} onBlur={() => fieldError("fullName") && validate()} />{errorNode("fullName")}</div>

    <div {...mark("contact")}>
      <fieldset id="application-contactMethod" className={`contact-method${fieldError("contactMethod") ? " is-error" : ""}`}>
        <legend>Способ связи</legend>
        <label><input type="radio" name="contactMethod" value="phone" checked={values.contactMethod === "phone"} onChange={() => set("contactMethod", "phone")} /><span>Телефон</span></label>
        <label><input type="radio" name="contactMethod" value="telegram" checked={values.contactMethod === "telegram"} onChange={() => set("contactMethod", "telegram")} /><span>Telegram</span></label>
      </fieldset>
      {errorNode("contactMethod")}
      <label htmlFor="application-contact">{values.contactMethod === "phone" ? "Номер телефона" : "Telegram username"}</label>
      <input id="application-contact" name="contact" type={values.contactMethod === "phone" ? "tel" : "text"} inputMode={values.contactMethod === "phone" ? "tel" : "text"} autoComplete={values.contactMethod === "phone" ? "tel" : "off"} required value={values.contact} placeholder={values.contactMethod === "phone" ? "+7 999 123-45-67" : "@username или t.me/username"} aria-invalid={Boolean(fieldError("contact"))} aria-describedby={describedBy("contact", "application-contact-hint")} onChange={(event) => set("contact", event.target.value)} />
      <p id="application-contact-hint" className="form-hint">Приватный контакт: доступен только команде AL-AMIN для модерации и связи.</p>{errorNode("contact")}
    </div>

    <div {...mark("country")}><label htmlFor="application-country">Страна</label><input id="application-country" name="country" autoComplete="country-name" required value={values.country} aria-invalid={Boolean(fieldError("country"))} aria-describedby={describedBy("country")} onChange={(event) => set("country", event.target.value)} />{errorNode("country")}</div>
    <div {...mark("city")}><label htmlFor="application-city">Город</label><input id="application-city" name="city" autoComplete="address-level2" required value={values.city} aria-invalid={Boolean(fieldError("city"))} aria-describedby={describedBy("city")} onChange={(event) => set("city", event.target.value)} />{errorNode("city")}</div>
    <div {...mark("categoryId")}><label htmlFor="application-categoryId">Основная категория</label><select id="application-categoryId" name="categoryId" required value={values.categoryId} aria-invalid={Boolean(fieldError("categoryId"))} aria-describedby={describedBy("categoryId")} onChange={(event) => { set("categoryId", event.target.value); clearField("additionalCategoryIds"); }}><option value="">Выберите категорию</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{errorNode("categoryId")}</div>
    <div {...mark("additionalCategoryIds")}><label>Дополнительные категории</label><CategoryMultiSelect name="applicationAdditionalCategories" categories={categories} initial={extra} value={extra} primaryId={values.categoryId} error={fieldError("additionalCategoryIds")} onChange={(next) => { setExtra(next); clearField("additionalCategoryIds"); }} /></div>
    <div {...mark("specialization")}><label htmlFor="application-specialization">Специализация</label><input id="application-specialization" name="specialization" required value={values.specialization} aria-invalid={Boolean(fieldError("specialization"))} aria-describedby={describedBy("specialization")} placeholder="Например: семейный психолог" onChange={(event) => set("specialization", event.target.value)} />{errorNode("specialization")}</div>
    <div {...mark("experienceYears")}><label htmlFor="application-experienceYears">Опыт работы, лет</label><input id="application-experienceYears" name="experienceYears" type="number" min="0" max="80" step="1" inputMode="numeric" required value={values.experienceYears} aria-invalid={Boolean(fieldError("experienceYears"))} aria-describedby={describedBy("experienceYears", "application-experience-hint")} onChange={(event) => set("experienceYears", event.target.value)} /><p id="application-experience-hint" className="form-hint">Начинающий специалист может указать 0.</p>{errorNode("experienceYears")}</div>
    <div {...mark("profileSummary", "full")}><label htmlFor="application-profileSummary">Коротко о себе</label><AutoResizeTextarea id="application-profileSummary" name="profileSummary" required value={values.profileSummary} aria-invalid={Boolean(fieldError("profileSummary"))} aria-describedby={describedBy("profileSummary", "application-profile-summary-hint")} maxHeight={180} placeholder="Краткое представление, которое будет показано в верхней части вашего профиля." onChange={(event) => set("profileSummary", event.target.value)} /><p id="application-profile-summary-hint" className={`form-hint${summaryChars > MAX_PROFILE_SUMMARY ? " description-limit-warning" : ""}`}>{summaryChars} из {MAX_PROFILE_SUMMARY} символов.</p>{errorNode("profileSummary")}</div>
    <div {...mark("description", "full")}><label htmlFor="application-description">О себе подробнее</label><p id="application-description-hint" className="form-hint">Расскажите о себе, опыте, подходе к работе и о том, чем можете быть полезны.</p><AutoResizeTextarea id="application-description" name="description" required value={values.description} aria-invalid={Boolean(fieldError("description"))} aria-describedby={describedBy("description", "application-description-hint application-description-count")} maxHeight={520} onChange={(event) => set("description", event.target.value)} /><small id="application-description-count" className={chars >= descriptionWarningChars || chars > MAX_FULL_DESCRIPTION ? "description-limit-warning" : descriptionChars >= minDescriptionChars ? "valid" : ""}>{chars} из {MAX_FULL_DESCRIPTION} символов · {chars > MAX_FULL_DESCRIPTION ? "Превышен лимит." : chars === MAX_FULL_DESCRIPTION ? "Достигнут лимит." : chars >= descriptionWarningChars ? remainingDescriptionMessage(MAX_FULL_DESCRIPTION - chars) : descriptionChars >= minDescriptionChars ? "Минимум выполнен" : "Минимум 50 символов"}</small>{errorNode("description")}</div>
    <div {...mark("helpTopics", "full")}><label>С чем вы помогаете</label><p className="form-hint">Направления помощи — не список платных услуг. Добавьте минимум одно.</p><HelpTopicsEditor value={helpTopics} errors={fieldErrors} ariaInvalid={Boolean(fieldError("helpTopics"))} onChange={(next) => { setHelpTopics(next); clearField("helpTopics"); }} />{errorNode("helpTopics")}</div>
    <div {...mark("workOffers", "full")}><label>Форматы работы</label><p className="form-hint">Конкретные варианты работы с длительностью, форматом и необязательной стоимостью.</p><WorkOffersEditor value={workOffers} errors={fieldErrors} ariaInvalid={Boolean(fieldError("workOffers"))} onChange={(next) => { setWorkOffers(next); clearField("workOffers"); }} />{errorNode("workOffers")}</div>
    <div className="honeypot" aria-hidden="true"><input name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={(event) => set("website", event.target.value)} /></div>
    <div id="application-consent" className={`form-field full consent-group${fieldError("truthful") || fieldError("personalData") ? " is-error" : ""}`}>
      <div><label className="check"><input type="checkbox" name="truthful" required checked={values.truthful} aria-invalid={Boolean(fieldError("truthful"))} aria-describedby={describedBy("truthful")} onChange={(event) => set("truthful", event.target.checked)} /><span>Подтверждаю достоверность сведений и принимаю <Link className="rules-link" href="/rules" target="_blank" rel="noreferrer">правила платформы</Link>.</span></label>{errorNode("truthful")}</div>
      <div><label className="check"><input type="checkbox" name="personalData" required checked={values.personalData} aria-invalid={Boolean(fieldError("personalData"))} aria-describedby={describedBy("personalData")} onChange={(event) => set("personalData", event.target.checked)} /><span>Согласен(на) на обработку персональных данных для рассмотрения заявки.</span></label>{errorNode("personalData")}</div>
    </div>
    <div className="form-field full"><button className="button" disabled={pending}>{pending ? draft?.id ? "Отправляем повторно…" : "Отправляем заявку…" : draft?.id ? "Отправить повторно" : "Отправить заявку"}</button>{message && <p className={`form-message ${messageType}`} role={messageType === "error" ? "alert" : "status"}>{message}</p>}</div>
    {cropSource && <AvatarCropper file={cropSource} initialSettings={cropSource === mainSource ? mainCropSettings : null} onCancel={() => setCropSource(null)} onSave={(file, settings) => { setMain(file); setMainCropSettings(settings); setMainPath(""); setCropSource(null); clearField("main"); }} onReplace={(file) => { setMainSource(file); setMainCropSettings(null); setCropSource(file); }} />}
  </form>;
}
