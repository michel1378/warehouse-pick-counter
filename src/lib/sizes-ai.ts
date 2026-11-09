import { z } from "zod";
import { FITS, FIT_LABELS } from "@/lib/sizes";
import { STRETCH_LABELS, isTrousers, type SizeCustomer, type SizeProfile, type SizeAiResult } from "@/lib/size-profile";
import { cm, compareSizeMeasurements, sizeAllowedCandidates, sizeOwnerGuidance, type SizeProductFacts } from "@/lib/size-evidence";
import { recommendContextualSize } from "@/lib/size-context";

// This module is imported only by the server route. No images, credentials or client IDs enter the prompt.
export const sizeAiInputSchema = z.object({
  productId: z.string().uuid(), revision: z.number().int().positive(),
  height: z.number().finite().min(40).max(230), weight: z.number().finite().min(2).max(250),
  ageYears: z.number().finite().min(0).max(110).optional(),
  fit: z.enum(FITS), halfWaistCm: z.number().finite().min(10).max(100).optional(),
  shouldersCm: z.number().finite().min(10).max(100).optional(),
  chestWidthCm: z.number().finite().min(10).max(150).optional(),
  beltFit: z.enum(["unknown", "snug", "roomy"]).optional(),
  colorKey: z.string().regex(/^[a-z0-9_-]{1,30}$/).optional(),
}).strict();
export type SizeAiInput = z.infer<typeof sizeAiInputSchema>;
export const SIZE_AI_MODEL = "gpt-5.4-mini-2026-03-17";

export function sizeAiPayload(product: SizeProductFacts, profile: SizeProfile, customer: SizeCustomer) {
  const comparison = compareSizeMeasurements(profile, customer);
  const ownerGuidance = sizeOwnerGuidance(product, profile, customer);
  const allowedSizes = comparison.rows.length ? sizeAllowedCandidates(comparison, profile) : ownerGuidance.usable ? [ownerGuidance.suggestedSize!] : [];
  return {
    product: { name: product.name, note: product.note, garment: profile.garment, fabric: profile.fabric,
      stretch: STRETCH_LABELS[profile.stretch], cut: profile.cut, units: "cm", columns: profile.columns, rows: profile.rows,
      comparison, ownerGuidance, allowedSizes },
    customer: { heightCm: customer.height, weightKg: customer.weight, fit: FIT_LABELS[customer.fit], halfWaistCm: isTrousers(profile) ? customer.halfWaistCm ?? null : null,
      shouldersCm: !isTrousers(profile) ? customer.shouldersCm ?? null : null, chestWidthCm: !isTrousers(profile) ? customer.chestWidthCm ?? null : null,
      beltFit: isTrousers(profile) ? customer.beltFit ?? "unknown" : "unknown" },
  };
}

// Exact supplied waist is resolved by the selected chart, independently of an LLM guess or height.
export function sizeMeasurementDecision(profile: SizeProfile, input: SizeAiInput): SizeAiResult | null {
  if (profile.colorGrids) return null;
  const comparison = compareSizeMeasurements(profile, input);
  if (!comparison.rows.length) {
    const supplied = isTrousers(profile) ? input.halfWaistCm !== undefined : input.shouldersCm !== undefined || input.chestWidthCm !== undefined;
    return supplied ? { size: null, explanation: "Для введённых мерок в сетке этой вещи пока нет сопоставимых столбцов.", clarification: "Попросите администратора заполнить соответствующие мерки по размерам и указать их тип в сетке." } : null;
  }
  const measurements = comparison.rows[0].measurements;
  for (const measurement of measurements) {
    const values = comparison.rows.map(row => row.measurements.find(m => m.key === measurement.key)!.itemCm);
    if (measurement.clientCm < Math.min(...values) || measurement.clientCm > Math.max(...values)) return {
      size: null, explanation: `Мерка «${measurement.label}» ${cm(measurement.clientCm)} см выходит за диапазон размерной таблицы этой вещи.`,
      clarification: `Перепроверьте мерку «${measurement.label}» любимой вещи без растяжения. Если она верна, уточните подходящую модель у владельца: по этой сетке размер не подтверждён.`,
    };
  }
  const exact = comparison.rows.filter(row => row.distanceCm < 0.000001);
  if (exact.length === 1) return {
    size: exact[0].size,
    explanation: `${exact[0].measurements.map(m => `${m.label} ${cm(m.clientCm)} см`).join(" и ")} совпадает с ${exact[0].size} по сетке этой вещи. Маломерность и пожелание посадки не прибавляют размер поверх замеров. Остальную посадку и длину проверьте отдельно.`,
    clarification: null,
  };
  if (isTrousers(profile) && comparison.nearest.length > 1) {
    const tied = comparison.rows.filter(row => comparison.nearest.includes(row.size));
    const reason = tied.map(row => { const delta = row.measurements[0].deltaCm; return delta === 0 ? `${row.size}: полупояс совпадает` : `${row.size} на ${cm(Math.abs(delta))} см ${delta < 0 ? "уже" : "шире"}`; }).join(", ");
    const wider = tied.find(row => row.measurements[0].deltaCm > 0), narrower = tied.find(row => row.measurements[0].deltaCm < 0);
    if (wider && input.beltFit === "snug" && input.fit !== "tight") return { size: wider.size, explanation: `${reason}. Любимый пояс сидит впритык: для запаса выбираем ${wider.size}. Это не гарантия посадки по бёдрам; длина проверяется отдельно.`, clarification: null };
    if (narrower && input.beltFit === "roomy" && input.fit !== "loose") return { size: narrower.size, explanation: `${reason}. В любимом поясе есть запас: для выбранной посадки ориентир — ${narrower.size}. Остальные мерки проверьте отдельно.`, clarification: null };
    return { size: null, explanation: `${reason}. Расстояние одинаковое, единственного ближайшего размера нет.`, clarification: "Пояс любимых брюк сидит впритык или с запасом?" };
  }
  return null;
}

export async function recommendSizeWithAi(product: SizeProductFacts, profile: SizeProfile, input: SizeAiInput): Promise<SizeAiResult> {
  return recommendContextualSize(product, profile, input);
}
