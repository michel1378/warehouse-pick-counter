import { z } from "zod";
import { normalizeSize } from "@/lib/sizes";

export const availabilityDetailsSchema = z.object({
  composition: z.string().trim().max(2000),
  material: z.string().trim().max(4000),
  stretch: z.string().trim().max(2000),
  colors: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    sizes: z.array(z.string().trim().min(1).max(16)).max(30).nullable(),
  }).strict()).max(50),
}).strict().superRefine((value, ctx) => {
  const names = value.colors.map(color => color.name.toLocaleLowerCase("ru"));
  if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "Цвета не должны повторяться." });
  if (value.colors.some(color => color.sizes && new Set(color.sizes).size !== color.sizes.length))
    ctx.addIssue({ code: "custom", message: "Размеры не должны повторяться." });
});
const image = z.string().max(400000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).refine(value => {
  const bytes = Buffer.from(value.split(",")[1], "base64");
  return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
}, "Некорректная фотография.");
const sizeList = z.array(z.string().trim().min(1).max(16).transform(normalizeSize)).max(30)
  .refine(sizes => new Set(sizes).size === sizes.length, "Размеры не должны повторяться.");
const editableFields = {
  show_in_availability: z.boolean().optional(),
  show_in_sizes: z.boolean().optional(),
  name: z.string().trim().min(1, "Укажите название.").max(120).optional(),
  sizes: sizeList.optional(),
  photos: z.array(image).max(6).optional(),
  stock_details: availabilityDetailsSchema,
  stock_chart: image.nullable().optional(),
  stock_models: z.array(image).max(6).optional(),
};
const savedImage = z.union([image, z.object({ index: z.number().int().min(0).max(5) }).strict()]);
export const availabilitySaveSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(),
  ...editableFields,
  photos: z.array(savedImage).max(6).optional(),
  stock_models: z.array(savedImage).max(6).optional(),
}).strict();
export const availabilityCreateSchema = z.object({
  ...editableFields,
  show_in_availability: z.boolean().default(true),
  show_in_sizes: z.boolean().default(false),
  name: z.string().trim().min(1, "Укажите название.").max(120),
  sizes: sizeList.default([]),
  photos: z.array(image).max(6).default([]),
  stock_details: availabilityDetailsSchema.default({ composition: "", material: "", stretch: "", colors: [] }),
}).strict();
export type AvailabilityDetails = z.infer<typeof availabilityDetailsSchema>;
export type AvailabilityImage = string | { index: number };
export type AvailabilityProduct = {
  id: string; name: string; sizes: string[]; active: boolean; show_in_availability: boolean; show_in_sizes: boolean; revision: number;
  photo_count: number; stock_details: AvailabilityDetails;
  stock_has_chart: boolean; stock_model_count: number;
};
export const availabilityFields = "id,name,sizes,active,show_in_availability,show_in_sizes,revision,photo_count,stock_details,stock_has_chart,stock_model_count";
