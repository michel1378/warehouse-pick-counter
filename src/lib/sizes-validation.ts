import { z } from "zod";
import { FITS, normalizeSize } from "@/lib/sizes";
import { fittingInputSchema, positiveFitting } from "./size-fittings";
const label = z.string().trim().min(1).max(16).transform(normalizeSize);
export const sizeProductSchema = z.object({
  id: z.string().uuid().optional(),
  revision: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Укажите название").max(120),
  note: z.string().trim().max(200),
  sizes: z.array(label).max(30),
  examples: z.array(z.object({
    height: z.number().min(100).max(230), weight: z.number().min(25).max(250),
    fit: z.enum(FITS), size: label, colorId: z.string().min(1).max(100).optional(),
  }).strict()).max(200),
  fittings: z.array(fittingInputSchema).max(200).optional(),
  photos: z.array(z.string().max(400000)).min(1).max(6).optional(),
  photo: z.string().max(400000).optional(),
  active: z.boolean(),
  show_in_availability: z.boolean().optional(),
  show_in_sizes: z.boolean().optional(),
}).strict().superRefine((p, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (p.id && !p.revision) issue("Не указана версия карточки. Обновите страницу.");
  if (new Set(p.sizes).size !== p.sizes.length) issue("Размеры не должны повторяться.");
  if (p.active && p.show_in_sizes !== false && !p.examples.length && !p.fittings?.some(positiveFitting)) issue("Добавьте рекомендацию или удачную примерку перед публикацией.");
  if (p.active && p.show_in_sizes !== false && !p.sizes.length) issue("Укажите размеры на бирке.");
  const seen = new Set<string>();
  for (const r of p.fittings ?? []) if (!p.sizes.includes(r.size)) issue(`Примерка: размера ${r.size} нет в размерном ряду.`);
  for (const [index, e] of p.examples.entries()) {
    if (!p.sizes.includes(e.size)) issue(`Строка ${index + 1}: размера ${e.size} нет в размерном ряду.`);
    const key = `${e.height}/${e.weight}/${e.fit}/${e.colorId && e.colorId !== "all" ? e.colorId : ""}`;
    if (seen.has(key)) issue(`Строка ${index + 1}: рост, вес и посадка уже встречаются. Оставьте одну рекомендацию.`);
    seen.add(key);
  }
  const photos = p.photos ?? (p.photo ? [p.photo] : []);
  if (photos.reduce((sum, photo) => sum + photo.length, 0) > 2400000) issue("Фотографии слишком большие. Уменьшите их количество или размер.");
  for (const photo of photos) if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo)) issue("Загрузите фотографию заново.");
});
