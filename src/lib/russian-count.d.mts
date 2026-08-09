export type RussianPluralForms = {
  one: string;
  few: string;
  many: string;
};

export function russianPluralForm(count: number, forms: RussianPluralForms): string;
export function russianCount(count: number, forms: RussianPluralForms): string;
