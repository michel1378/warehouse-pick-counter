import { z } from "zod";
import { normalizeSize } from "@/lib/sizes";
import type { Fit } from "@/lib/sizes";
import { colorGridsSchema } from "@/lib/color-size-grids";
import type { ColorSizeResult } from "@/lib/color-size-grids";

export const MEASUREMENT_LABELS = { halfWaistCm: "Полупояс", shouldersCm: "Плечи", chestWidthCm: "Ширина по груди", lengthCm: "Длина", other: "Другая мерка" } as const;
export type MeasurementKey = keyof typeof MEASUREMENT_LABELS;
export type SizeCustomer = { height: number; weight: number; fit: Fit; halfWaistCm?: number; shouldersCm?: number; chestWidthCm?: number; beltFit?: "unknown" | "snug" | "roomy"; colorKey?: string };

export const STRETCH_LABELS = {
  unknown: "Не указано", none: "Не тянется", slight: "Почти не тянется", stretch: "Тянется",
} as const;

export const sizeProfileSchema = z.object({
  garment: z.enum(["trousers", "jeans", "top", "other"]),
  fabric: z.string().trim().max(1000),
  stretch: z.enum(["unknown", "none", "slight", "stretch"]),
  cut: z.string().trim().max(500),
  fitNote: z.string().trim().max(1000).optional(),
  colorGrids: colorGridsSchema.optional(),
  columns: z.array(z.string().trim().min(1).max(60)).min(1).max(6),
  columnKeys: z.array(z.enum(["halfWaistCm", "shouldersCm", "chestWidthCm", "lengthCm", "other"])).min(1).max(6).optional(),
  rows: z.array(z.object({
    size: z.string().trim().min(1).max(16).transform(normalizeSize),
    values: z.array(z.number().finite().positive().max(400)).min(1).max(6),
  }).strict()).min(1).max(30),
}).strict().superRefine((profile, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (profile.colorGrids && profile.garment !== "top") issue("Цветные сетки плеч и груди предназначены для верха.");
  if (new Set(profile.rows.map(row => row.size)).size !== profile.rows.length) issue("Размеры в числовой таблице не должны повторяться.");
  if (new Set(profile.columns.map(column => column.toLocaleLowerCase("ru"))).size !== profile.columns.length) issue("Названия мерок не должны повторяться.");
  if (profile.rows.some(row => row.values.length !== profile.columns.length)) issue("Заполните каждую мерку во всех строках размерной таблицы.");
  if (["trousers", "jeans"].includes(profile.garment) && profile.columns[0] !== "Полупояс") issue("Для брюк и джинсов первая мерка — Полупояс, в сантиметрах.");
  if (profile.columnKeys && profile.columnKeys.length !== profile.columns.length) issue("Укажите тип каждой мерки.");
  if (profile.columnKeys) {
    const known = profile.columnKeys.filter(key => key !== "other");
    if (new Set(known).size !== known.length) issue("Один тип мерки не должен повторяться.");
    if (["trousers", "jeans"].includes(profile.garment) && profile.columnKeys[0] !== "halfWaistCm") issue("Первая мерка брюк — полупояс.");
  }
});

export type SizeProfile = z.infer<typeof sizeProfileSchema>;
export type SizeAiResult = { size: string | null; explanation: string; clarification: string | null; approximate?: boolean; summary?: string; colorResults?: ColorSizeResult[] };
export type SizeComparison = { nearest: string[]; rows: { size: string; distanceCm: number; measurements: { key: string; label: string; clientCm: number; itemCm: number; deltaCm: number }[] }[] };

export const isTrousers = (profile: SizeProfile) => profile.garment === "trousers" || profile.garment === "jeans";
export function columnKey(profile: Pick<SizeProfile, "columns" | "columnKeys">, index: number): MeasurementKey {
  if (profile.columnKeys) return profile.columnKeys[index] ?? "other";
  const label = profile.columns[index]?.trim().toLocaleLowerCase("ru") ?? "";
  if (/полупояс|ширина пояса/.test(label)) return "halfWaistCm";
  if (/плеч/.test(label)) return "shouldersCm";
  if (/груд/.test(label)) return "chestWidthCm";
  if (label === "длина") return "lengthCm";
  return "other";
}

export function sizeLengthAssessment(profile: SizeProfile, size: string | null): string {
  if (profile.colorGrids) return "Длину и рукав смотрите отдельно для каждого цвета в его полной сетке. По росту точную длину не определить.";
  const index = profile.columns.findIndex((_, i) => columnKey(profile, i) === "lengthCm");
  const row = profile.rows.find(row => row.size === size);
  const length = index >= 0 ? row?.values[index] : undefined;
  return (length !== undefined ? `Длина ${size} по таблице — ${length} см. ` : "Длина для выбранного варианта пока не определена. ")
    + (isTrousers(profile) ? "По одному росту нельзя определить нужную длину брюк. Сравните с длиной подходящих брюк, измеренной тем же способом, что и размерная таблица." : "По одному росту нужную длину не определить. Сравните с длиной любимой вещи, снятой тем же способом, что и таблица.");
}

export function hugeTrousersProfile(): SizeProfile {
  return {
    garment: "trousers", fabric: "Состав ткани не указан", stretch: "slight", cut: "Широкий",
    columns: ["Полупояс", "Длина", "Выход"],
    rows: [
      { size: "S", values: [38, 104, 27] }, { size: "M", values: [39, 106, 28] },
      { size: "L", values: [42, 107, 29] }, { size: "XL", values: [44, 108, 30] },
      { size: "2XL", values: [45, 109, 30] }, { size: "3XL", values: [46, 110, 30] },
    ],
  };
}
