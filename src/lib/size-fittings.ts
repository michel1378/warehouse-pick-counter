import { z } from "zod";
import { normalizeSize } from "./sizes";

export const BODY_FITS = { too_tight: "Тесно", closer: "В облипку", regular: "В размер", relaxed: "Свободно", too_loose: "Слишком велико" } as const;
export const LENGTH_FITS = { short: "Коротко", ok: "В самый раз", long: "Длинно" } as const;
export type BodySnapshot = { height: number; weight: number; shoulders: number | null; chestCircumference: number | null; waistCircumference: number | null };
export type FitPerson = { id: string; slot: number; label: string; height: number | null; weight: number | null; shoulders: number | null; chest_circumference: number | null; waist_circumference: number | null; revision: number };
export const fittingInputSchema = z.object({
  id: z.string().uuid(), personId: z.string().uuid(), size: z.string().trim().min(1).max(16).transform(normalizeSize),
  colorId: z.string().min(1).max(80), fit: z.enum(["too_tight", "closer", "regular", "relaxed", "too_loose"]),
  length: z.enum(["short", "ok", "long"]), sleeve: z.enum(["short", "ok", "long", "na"]),
  notes: z.string().trim().max(500), refreshMeasurements: z.boolean().optional(),
}).strict();
export type FittingInput = z.infer<typeof fittingInputSchema>;
export type FittingRecord = Omit<FittingInput, "refreshMeasurements"> & { personSlot: number; body: BodySnapshot; measuredAt: string };
export const personInputSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), label: z.string().trim().min(1).max(40),
  height: z.number().min(100).max(230), weight: z.number().min(25).max(250),
  shoulders: z.number().min(20).max(90).nullable(), chest_circumference: z.number().min(45).max(200).nullable(),
  waist_circumference: z.number().min(40).max(200).nullable(),
}).strict();
export const positiveFitting = (r: Pick<FittingRecord, "fit" | "length" | "sleeve">) =>
  ["closer", "regular", "relaxed"].includes(r.fit) && r.length === "ok" && ["ok", "na"].includes(r.sleeve);

// Existing observations keep their original body measurements. Changing today's
// weight must not rewrite what was tried on last month.
export function snapshotFittings(inputs: FittingInput[], old: FittingRecord[], people: FitPerson[], pants: boolean, now = new Date().toISOString()): FittingRecord[] {
  if (new Set(inputs.map(r => r.id)).size !== inputs.length) throw new Error("ID примерок не должны повторяться.");
  return inputs.map(({ refreshMeasurements, ...r }) => {
    if (pants ? r.sleeve !== "na" : r.sleeve === "na") throw new Error("Проверьте оценку рукава: для брюк выберите «Не применимо».");
    const person = people.find(p => p.id === r.personId);
    if (!person || person.height === null || person.weight === null) throw new Error("Сначала сохраните рост и вес выбранного человека.");
    const previous = old.find(x => x.id === r.id && x.personId === r.personId);
    return { ...r, personSlot: person.slot,
      body: previous && !refreshMeasurements ? previous.body : { height: person.height, weight: person.weight, shoulders: person.shoulders, chestCircumference: person.chest_circumference, waistCircumference: person.waist_circumference },
      measuredAt: previous && !refreshMeasurements ? previous.measuredAt : now };
  });
}
