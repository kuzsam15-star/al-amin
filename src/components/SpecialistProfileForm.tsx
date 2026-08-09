"use client";

import { type FormEvent, useState } from "react";
import { updateOwnProfile } from "@/app/cabinet/actions";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { CategoryMultiSelect, type SelectCategory } from "@/components/CategoryMultiSelect";
import { HelpTopicsEditor } from "@/components/HelpTopicsEditor";
import { OwnerMediaFields } from "@/components/OwnerMediaFields";
import { WorkOffersEditor } from "@/components/WorkOffersEditor";
import { validateProfileRevision } from "@/lib/application-validation.mjs";
import { MAX_FULL_DESCRIPTION, MAX_PROFILE_SUMMARY, codePointLength, type HelpTopic, type WorkOffer, type WorkMode } from "@/lib/specialist-contract.mjs";
import { russianCount } from "@/lib/russian-count.mjs";

type ProfileValues = Record<string, unknown>;
type Props = { profileId: string; categories: SelectCategory[]; values: ProfileValues };
const string = (values: ProfileValues, name: string, fallback = "") => typeof values[name] === "string" ? values[name] as string : typeof values[name] === "number" ? String(values[name]) : fallback;
const strings = (values: ProfileValues, name: string, fallback: string[] = []) => Array.isArray(values[name]) ? values[name]!.filter((value): value is string => typeof value === "string") : fallback;
const topics = (values: ProfileValues): HelpTopic[] => Array.isArray(values.help_topics) ? values.help_topics.filter((item): item is HelpTopic => Boolean(item) && typeof item === "object" && typeof (item as HelpTopic).title === "string") : [];
const offers = (values: ProfileValues): WorkOffer[] => {
  if (Array.isArray(values.work_offers) && values.work_offers.length) return values.work_offers.filter((item): item is WorkOffer => Boolean(item) && typeof item === "object" && typeof (item as WorkOffer).title === "string");
  const mode = (["online", "offline", "both"].includes(string(values, "service_mode")) ? string(values, "service_mode") : "both") as WorkMode;
  return strings(values, "services").map((title) => ({ title, duration_minutes: null, mode, price: null, currency: null }));
};
const characterForms = { one: "символ", few: "символа", many: "символов" };
const root = (key: string) => key.split(".")[0];

export function SpecialistProfileForm({ profileId, categories, values }: Props) {
  const [categoryId, setCategoryId] = useState(string(values, "category_id"));
  const [profileSummary, setProfileSummary] = useState(string(values, "profile_summary", string(values, "short_description")));
  const [description, setDescription] = useState(string(values, "full_description", string(values, "short_description")));
  const [helpTopics, setHelpTopics] = useState<HelpTopic[]>(topics(values).length ? topics(values) : [{ title: "", description: null }]);
  const [workOffers, setWorkOffers] = useState<WorkOffer[]>(offers(values).length ? offers(values) : [{ title: "", duration_minutes: null, mode: "both", price: null, currency: null }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fieldError = (field: string) => Object.entries(errors).find(([key]) => root(key) === field)?.[1];
  const clear = (field: string) => setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => root(key) !== field)));
  const errorNode = (field: string) => fieldError(field) ? <p id={`cabinet-${field}-error`} className="field-error" role="alert">{fieldError(field)}</p> : null;

  function validate(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const result = validateProfileRevision({
      fullName: data.get("fullName"), country: data.get("country"), city: data.get("city"), categoryId: data.get("categoryId"),
      additionalCategoryIds: data.getAll("additionalCategoryIds"), specialization: data.get("specialization"), experienceYears: data.get("experienceYears"),
      profileSummary, description, helpTopics, workOffers, mainImagePath: data.get("mainImagePath"),
    }, { activeCategories: categories, allowedExistingMediaPaths: [string(values, "avatar_path")].filter(Boolean) });
    if (!result.error) return;
    event.preventDefault();
    setErrors(result.errors);
    const first = root(Object.keys(result.errors)[0]);
    requestAnimationFrame(() => {
      const node = document.getElementById(`cabinet-${first}`);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      node?.querySelector<HTMLElement>("input:not([type=hidden]),textarea,select,button")?.focus({ preventScroll: true });
    });
  }

  const errorRoots = [...new Set(Object.keys(errors).map(root))];
  return <form action={updateOwnProfile} onSubmit={validate} onChange={(event) => { const target = event.target as unknown as HTMLInputElement; if (target.name) clear(target.name); }} className="card form-grid cabinet-profile-form" noValidate>
    <div className="cabinet-form-heading"><h2>Редактировать профиль</h2><p>Публичный профиль обновится только после одобрения изменений.</p></div>
    {errorRoots.length > 0 && <section className="form-error-summary full" role="alert"><h3>Проверьте данные профиля</h3><p>Исправьте отмеченные поля и отправьте изменения ещё раз.</p></section>}
    <input type="hidden" name="id" value={profileId} />
    <div id="cabinet-main" className={fieldError("main") ? "form-field full is-error" : "form-field full"}><OwnerMediaFields main={string(values, "avatar_path") || null} gallery={strings(values, "gallery_paths")} allowGallery={false} required />{errorNode("main")}</div>

    <section className="form-section">
      <h3 className="form-section-title">Основные сведения</h3>
      <div id="cabinet-fullName" className={`form-field${fieldError("fullName") ? " is-error" : ""}`}><label htmlFor="cabinet-fullName-input">Имя и фамилия<input id="cabinet-fullName-input" name="fullName" autoComplete="name" defaultValue={string(values, "full_name")} aria-invalid={Boolean(fieldError("fullName"))} /></label>{errorNode("fullName")}</div>
      <div id="cabinet-country" className={`form-field${fieldError("country") ? " is-error" : ""}`}><label htmlFor="cabinet-country-input">Страна<input id="cabinet-country-input" name="country" autoComplete="country-name" defaultValue={string(values, "country")} aria-invalid={Boolean(fieldError("country"))} /></label>{errorNode("country")}</div>
      <div id="cabinet-city" className={`form-field${fieldError("city") ? " is-error" : ""}`}><label htmlFor="cabinet-city-input">Город<input id="cabinet-city-input" name="city" autoComplete="address-level2" defaultValue={string(values, "city")} aria-invalid={Boolean(fieldError("city"))} /></label>{errorNode("city")}</div>
      <div id="cabinet-experienceYears" className={`form-field${fieldError("experienceYears") ? " is-error" : ""}`}><label htmlFor="cabinet-experienceYears-input">Опыт работы, лет<input id="cabinet-experienceYears-input" name="experienceYears" type="number" min="0" max="80" step="1" inputMode="numeric" defaultValue={string(values, "experience_years")} aria-invalid={Boolean(fieldError("experienceYears"))} /></label><p className="form-hint">Начинающий специалист может указать 0.</p>{errorNode("experienceYears")}</div>
      <div id="cabinet-categoryId" className={`form-field${fieldError("categoryId") ? " is-error" : ""}`}><label htmlFor="cabinet-categoryId-input">Основная категория<select id="cabinet-categoryId-input" name="categoryId" value={categoryId} aria-invalid={Boolean(fieldError("categoryId"))} onChange={(event) => { setCategoryId(event.target.value); clear("categoryId"); }}><option value="">Выберите категорию</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{errorNode("categoryId")}</div>
      <div id="cabinet-additionalCategoryIds" className={`form-field full${fieldError("additionalCategoryIds") ? " is-error" : ""}`}><label>Дополнительные категории</label><CategoryMultiSelect name="additionalCategoryIds" categories={categories} initial={strings(values, "additional_category_ids")} primaryId={categoryId} error={fieldError("additionalCategoryIds")} /></div>
      <div id="cabinet-specialization" className={`form-field${fieldError("specialization") ? " is-error" : ""}`}><label htmlFor="cabinet-specialization-input">Специализация<input id="cabinet-specialization-input" name="specialization" defaultValue={string(values, "specialization")} aria-invalid={Boolean(fieldError("specialization"))} placeholder="Например: семейный психолог" /></label>{errorNode("specialization")}</div>
    </section>

    <section className="form-section">
      <h3 className="form-section-title">Публичное описание</h3>
      <div id="cabinet-profileSummary" className={`form-field full${fieldError("profileSummary") ? " is-error" : ""}`}><label htmlFor="cabinet-profileSummary-input">Коротко о себе</label><AutoResizeTextarea id="cabinet-profileSummary-input" name="profileSummary" value={profileSummary} maxHeight={180} aria-invalid={Boolean(fieldError("profileSummary"))} placeholder="Краткое представление, которое будет показано в верхней части вашего профиля." onChange={(event) => { setProfileSummary(event.target.value); clear("profileSummary"); }} /><p className="form-hint">{codePointLength(profileSummary)} из {MAX_PROFILE_SUMMARY} символов.</p>{errorNode("profileSummary")}</div>
      <div id="cabinet-description" className={`form-field full${fieldError("description") ? " is-error" : ""}`}><label htmlFor="cabinet-description-input">О себе подробнее</label><p className="form-hint">Расскажите о себе, опыте, подходе к работе и о том, чем можете быть полезны.</p><AutoResizeTextarea id="cabinet-description-input" name="description" value={description} maxHeight={520} aria-invalid={Boolean(fieldError("description"))} onChange={(event) => { setDescription(event.target.value); clear("description"); }} /><p className="form-hint">{russianCount(codePointLength(description.trim()), characterForms)}. Минимум — 50, максимум — {MAX_FULL_DESCRIPTION}.</p>{errorNode("description")}</div>
      <div id="cabinet-helpTopics" className={`form-field full${fieldError("helpTopics") ? " is-error" : ""}`}><label>С чем вы помогаете</label><HelpTopicsEditor name="helpTopics" value={helpTopics} errors={errors} ariaInvalid={Boolean(fieldError("helpTopics"))} onChange={(next) => { setHelpTopics(next); clear("helpTopics"); }} />{errorNode("helpTopics")}</div>
      <div id="cabinet-workOffers" className={`form-field full${fieldError("workOffers") ? " is-error" : ""}`}><label>Форматы работы</label><WorkOffersEditor name="workOffers" value={workOffers} errors={errors} ariaInvalid={Boolean(fieldError("workOffers"))} onChange={(next) => { setWorkOffers(next); clear("workOffers"); }} />{errorNode("workOffers")}</div>
    </section>

    <div className="cabinet-form-actions"><button className="button">Сохранить и отправить на модерацию</button></div>
  </form>;
}
