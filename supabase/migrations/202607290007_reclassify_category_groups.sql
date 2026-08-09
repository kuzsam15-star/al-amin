-- Move legacy umbrella categories out of the temporary fallback group.
-- Existing category IDs stay intact, so published profiles and revisions remain linked.
update public.categories
set group_name = case slug
  when 'it-software' then 'IT и разработка'
  when 'mobile-apps' then 'IT и разработка'
  when 'design' then 'Дизайн'
  when 'marketing' then 'Маркетинг'
  when 'copywriting-translation' then 'Тексты и переводы'
  when 'education' then 'Образование'
  when 'education-tutoring' then 'Образование'
  when 'legal' then 'Юридические услуги'
  when 'finance-accounting' then 'Финансы и бухгалтерия'
  when 'construction' then 'Строительство и ремонт'
  when 'construction-repair' then 'Строительство и ремонт'
  when 'electrical' then 'Инженерные услуги'
  when 'architecture-interior' then 'Архитектура и интерьер'
  when 'manufacturing' then 'Производство'
  when 'logistics' then 'Транспорт и логистика'
  when 'automotive' then 'Автомобили'
  when 'real-estate' then 'Недвижимость'
  when 'beauty-care' then 'Красота и уход'
  when 'photo-video' then 'Фото и видео'
  when 'editing-voice' then 'Музыка и звук'
  when 'events' then 'Организация мероприятий'
  when 'retail' then 'Торговля'
  when 'household-services' then 'Бытовые услуги'
  when 'food-confectionery' then 'Питание и кондитерское дело'
  when 'consulting' then 'Управление и консалтинг'
  else group_name
end
where group_name = 'Другие направления';
