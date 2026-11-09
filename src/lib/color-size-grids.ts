import { z } from "zod";
import { normalizeSize, type SizeExample } from "@/lib/sizes";
import type { SizeAiResult, SizeCustomer } from "@/lib/size-profile";

const value = z.number().finite().positive().max(400);
export const spreadSchema = z.union([
  value,
  z.object({ min: value, max: value }).strict().refine(v => v.min <= v.max, "Начало диапазона должно быть не больше конца."),
  z.object({ samples: z.array(value).min(2).max(20) }).strict().refine(v => new Set(v.samples).size === v.samples.length, "Замеры не должны повторяться."),
]);
export type Spread = z.infer<typeof spreadSchema>;
export const colorGridRowSchema = z.object({
  size: z.string().trim().min(1).max(16).transform(normalizeSize),
  shoulders: spreadSchema, chest: spreadSchema, length: spreadSchema, sleeve: spreadSchema,
  source: z.enum(["measured", "calculated"]), note: z.string().max(300).optional(),
}).strict();
export const colorGridSchema = z.object({
    key: z.string().regex(/^[a-z0-9_-]{1,30}$/), name: z.string().trim().min(1).max(80),
    prefix: z.string().trim().min(1).max(60), rows: z.array(colorGridRowSchema).min(1).max(30),
}).strict();
export const colorGridsSchema = z.object({
  title: z.string().trim().min(1).max(60), chestDefinition: z.string().max(300),
  colors: z.array(colorGridSchema).min(2).max(6),
}).strict().superRefine((grids, ctx) => {
  if (new Set(grids.colors.map(c => c.key)).size !== grids.colors.length) ctx.addIssue({code:"custom",message:"Ключи цветов не должны повторяться."});
  for (const color of grids.colors) if (new Set(color.rows.map(r => r.size)).size !== color.rows.length)
    ctx.addIssue({code:"custom",message:`${color.name}: размеры не должны повторяться.`});
});
export type ColorGrids = z.infer<typeof colorGridsSchema>;
export type ColorSizeResult = SizeAiResult & { key: string; name: string; prefix: string; source: "measured" | "calculated" | null; requiresWarehouseCheck: boolean; lengthText: string; shortNote?: string; comparisons: ColorComparison[] };
export type ColorComparison = { size: string; source: "measured" | "calculated"; distanceCm: number; shoulders: Spread; chest: Spread };
export const spreadBounds = (spread: Spread): [number, number] => typeof spread === "number" ? [spread, spread]
  : "samples" in spread ? [Math.min(...spread.samples),Math.max(...spread.samples)] : [spread.min,spread.max];
const cm = (number: number) => String(number).replace(".",",");
export function spreadText(spread: Spread): string {
  return typeof spread === "number" ? cm(spread) : "samples" in spread ? spread.samples.map(cm).join("/") : `${cm(spread.min)}–${cm(spread.max)}`;
}
export function parseSpread(text: string): Spread {
  const parts = text.trim().replace(/,/g,".").split(/\s*[–—-]\s*/);
  const candidate = text.includes("/") ? {samples:text.split("/").map(v=>Number(v.trim().replace(",",".")))}
    : parts.length === 2 ? {min:Number(parts[0]),max:Number(parts[1])} : Number(parts[0]);
  return spreadSchema.parse(candidate);
}
/** Samples remain discrete; 42/43/44 never silently becomes every value between 42 and 44. */
export function spreadDistance(spread: Spread, client: number): number {
  if (typeof spread === "number") return Math.abs(spread-client);
  if ("samples" in spread) return Math.min(...spread.samples.map(v=>Math.abs(v-client)));
  return client < spread.min ? spread.min-client : client > spread.max ? client-spread.max : 0;
}

export function recommendColorGrids(grids: ColorGrids, input: SizeCustomer, examples: SizeExample[] = []): SizeAiResult & { summary: string; colorResults: ColorSizeResult[] } {
  const colors = input.colorKey ? grids.colors.filter(color => color.key === input.colorKey) : grids.colors;
  if (!colors.length) throw new Error("SIZE_COLOR_NOT_FOUND");
  const colorResults = colors.map(color => {
    const base = {key:color.key,name:color.name,prefix:color.prefix,source:null,lengthText:"Длину и рукав нужно сравнить отдельно с любимой вещью; по росту точную длину не определить.",requiresWarehouseCheck:false,comparisons:[] as ColorComparison[]};
    const comparisons = color.rows.map(row => ({size:row.size,source:row.source,shoulders:row.shoulders,chest:row.chest,
      distanceCm:Math.round(((input.shouldersCm === undefined ? 0 : spreadDistance(row.shoulders,input.shouldersCm))
        +(input.chestWidthCm === undefined ? 0 : spreadDistance(row.chest,input.chestWidthCm)))*1000)/1000}));
    if (input.shouldersCm === undefined || input.chestWidthCm === undefined) return {...base,comparisons,size:null,
      explanation:"Старые примеры не привязаны к цвету. Для раздельного подбора нужна прямая мерка любимой вещи.",
      clarification:input.chestWidthCm === undefined ? "Какая ширина по груди любимой вещи от подмышки до подмышки?" : "Какое расстояние между плечевыми швами любимой вещи?"};
    const min = Math.min(...comparisons.map(row=>row.distanceCm));
    const closest = comparisons.filter(row=>Math.abs(row.distanceCm-min)<0.000001);
    const measured = closest.filter(row=>row.source === "measured");
    if (!measured.length) return {...base,comparisons,size:null,source:"calculated" as const,requiresWarehouseCheck:true,
      explanation:`Ближайшие строки ${closest.map(row=>row.size).join(" / ")} — расчётные, не измерены. Они не подтверждают размер к отправке.`,
      clarification:"Уточните плечи и ширину по груди этой вещи на складе."};
    let selected = measured.length === 1 ? color.rows.find(row=>row.size===measured[0].size) : undefined;
    let ownerHint = false;
    if (min === 0 && measured.length > 1) {
      const hints = [...new Set(examples.filter(e=>e.height===input.height&&e.weight===input.weight&&e.fit===input.fit&&measured.some(row=>row.size===e.size)).map(e=>e.size))];
      if (hints.length === 1) { selected=color.rows.find(row=>row.size===hints[0]);ownerHint=true; }
    }
    if (!selected) return {...base,comparisons,size:null,requiresWarehouseCheck:true,
      explanation:min === 0 ? `Разброс плеч и груди перекрывается у ${measured.map(row=>row.size).join(" / ")}. Большая бирка не означает большую ширину.`
        : `Нет совпадения по обеим меркам. Ближайшие измеренные строки: ${measured.map(row=>row.size).join(" / ")}; растяжимость не задаёт известный запас в сантиметрах.`,
      clarification:"Уточните на складе фактическую ширину по груди конкретной вещи."};
    return {...base,comparisons,size:selected.size,source:"measured" as const,
      shortNote:min > 0 ? `ближайший по замерам: плечи ${spreadText(selected.shoulders)}, грудь ${spreadText(selected.chest)} см; посадку уточнить` : ownerHint ? "по старому ориентиру владельца; замеры размеров перекрываются" : undefined,
      explanation:`Плечи ${spreadText(selected.shoulders)} см, грудь ${spreadText(selected.chest)} см: ${min > 0 ? "ближайший измеренный вариант, точного совпадения по обеим меркам нет; растяжимость не гарантирует посадку" : "обе мерки входят в измеренные значения этого цвета"}. ${ownerHint ? "При перекрытии использован старый ориентир владельца, не подтверждённая примерка. " : ""}Маломерность не прибавляет размер поверх сетки.`,
      clarification:null,lengthText:`Длина ${spreadText(selected.length)} см, рукав ${spreadText(selected.sleeve)} см. Сравните отдельно с любимой вещью; по росту точную длину не определить.`};
  });
  const primary=colorResults[0];
  const summary=colorResults.map(colorSizeLine).join("\n");
  return {size:primary.size,explanation:primary.explanation,clarification:primary.clarification,summary,colorResults};
}

export function colorSizeLine(result: ColorSizeResult): string {
  if (result.size) return `${result.name} — ${result.size}${result.shortNote ? ` (${result.shortNote})` : ""}`;
  return `${result.name} — ${result.requiresWarehouseCheck ? "уточнить замеры на складе" : result.clarification ?? "уточнить мерку"}`;
}
