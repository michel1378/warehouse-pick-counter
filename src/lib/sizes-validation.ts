import { z } from "zod";
import { FITS, normalizeSize } from "@/lib/sizes";
const label = z.string().trim().min(1).max(16).transform(normalizeSize);
export const sizeProductSchema = z.object({
  id: z.string().uuid().optional(),
  revision: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Укажите название").max(120),
  note: z.string().trim().max(200),
  sizes: z.array(label).min(1, "Укажите размеры на бирке").max(30),
  examples: z.array(z.object({
    height: z.number().min(100).max(230), weight: z.number().min(25).max(250),
    fit: z.enum(FITS), size: label,
  }).strict()).max(200),
  photo: z.string().max(400000).optional(),
  active: z.boolean(),
}).strict().superRefine((p, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (p.id && !p.revision) issue("Не указана версия карточки. Обновите страницу.");
  if (new Set(p.sizes).size !== p.sizes.length) issue("Размеры не должны повторяться.");
  if (p.active && !p.examples.length) issue("Добавьте хотя бы один пример перед публикацией.");
  const seen = new Set<string>();
  for (const [index, e] of p.examples.entries()) {
    if (!p.sizes.includes(e.size)) issue(`Строка ${index + 1}: размера ${e.size} нет в размерном ряду.`);
    const key = `${e.height}/${e.weight}/${e.fit}`;
    if (seen.has(key)) issue(`Строка ${index + 1}: рост, вес и посадка уже встречаются. Оставьте одну рекомендацию.`);
    seen.add(key);
  }
  if (p.photo !== undefined && !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(p.photo)) issue("Загрузите фотографию заново.");
});
