import snapshot from "./detailed-size-data.json";
import { recommendSize, type Fit, type SizeExample } from "./sizes";
import type {
  DetailedFit, DetailedSizeDefinition, DetailedSizeInput, DetailedSizeProduct,
  GarmentMeasures, MeasureRow, ReviewedSizeRule, SizeCalibration, SizeVariant, VariantSizeResult,
} from "./detailed-size-types";

export const reviewedSizeData = snapshot as unknown as SizeCalibration;
const definitions = new Map(reviewedSizeData.products.map(p => [p.id, p]));
export const getDetailedSizeDefinition = (id: string) => definitions.get(id);
export const isPantsProduct = (product: DetailedSizeProduct) =>
  definitions.get(product.id)?.kind === "pants" || /брюк|джинс/i.test(product.name);
const legacyFit: Record<DetailedFit, Fit> = { closer: "tight", regular: "regular", relaxed: "loose" };
const measureKeys: (keyof GarmentMeasures)[] = ["shoulders", "chest", "halfWaist", "length", "sleeve"];
const normalizeColor = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[^а-яa-z0-9]/g, "");
const hasMeasures = (r: GarmentMeasures) => measureKeys.some(k => r[k] !== undefined);
const measureCount = (r: GarmentMeasures) => measureKeys.filter(k => r[k] !== undefined).length;
const sameProfile = (r: ReviewedSizeRule, input: DetailedSizeInput) => r.height === input.height && r.weight === input.weight;
const colorApplies = (r: ReviewedSizeRule, color: string) => !r.colors.length || r.colors.includes(color);
const referenceMatches = (required: GarmentMeasures, actual: GarmentMeasures) =>
  measureKeys.every(k => required[k] === undefined || (actual[k] !== undefined && Math.abs(required[k]! - actual[k]!) <= 0.1));
const sameMeasures = (a: GarmentMeasures, b: GarmentMeasures) => referenceMatches(a, b) && referenceMatches(b, a);

type ResolvedVariant = SizeVariant & { supported: boolean; stockSizes?: string[] | null };
function variantsFor(product: DetailedSizeProduct, def?: DetailedSizeDefinition): ResolvedVariant[] {
  if (def?.sharedSizeAcrossColors) return [{ id: "all", name: "Размер", supported: true }];
  const colors = product.stock_details?.colors ?? [];
  if (!def || def.variants.every(v => v.id === "all")) {
    return colors.length ? colors.map(c => ({ id: normalizeColor(c.name), name: c.name, supported: true, stockSizes: c.sizes }))
      : [{ ...(def?.variants[0] ?? { id: "all", name: "Размер" }), supported: true }];
  }
  const used = new Set<string>();
  const variants: ResolvedVariant[] = def.variants.map(v => {
    const names = [v.name, ...(v.aliases ?? [])].map(normalizeColor);
    const stock = colors.find(c => names.includes(normalizeColor(c.name)));
    if (stock) used.add(stock.name);
    return { ...v, supported: true, ...(stock ? { stockSizes: stock.sizes } : {}) };
  });
  for (const color of colors) {
    if (!used.has(color.name) && !["единый", "всецвета"].includes(normalizeColor(color.name)))
      variants.push({ id: `unreviewed-${normalizeColor(color.name)}`, name: color.name, supported: false, stockSizes: color.sizes });
  }
  return variants;
}

function invalidInput(input: DetailedSizeInput): string | null {
  if (!Number.isFinite(input.height) || input.height < 100 || input.height > 230 || !Number.isFinite(input.weight) || input.weight < 25 || input.weight > 250)
    return "Проверьте рост (100–230 см) и вес (25–250 кг).";
  if (!["closer", "regular", "relaxed"].includes(input.fit) || !["standard", "cropped"].includes(input.lengthPreference)) return "Укажите желаемую посадку.";
  if (input.measurementSubject === "body" && hasMeasures(input.reference ?? {})) return "Здесь нужны замеры любимой вещи в разложенном виде, а не обхваты тела.";
  const limits: Record<keyof GarmentMeasures, [number, number]> = { shoulders: [15, 90], chest: [20, 120], halfWaist: [15, 100], length: [25, 160], sleeve: [10, 110] };
  for (const k of measureKeys) {
    const value = input.reference?.[k];
    if (value !== undefined && (!Number.isFinite(value) || value < limits[k][0] || value > limits[k][1])) return "Проверьте дополнительные замеры в сантиметрах.";
  }
  return null;
}

function rangeDistance(value: number, range: [number, number]) {
  return value < range[0] ? range[0] - value : value > range[1] ? value - range[1] : 0;
}
function closestRow(def: DetailedSizeDefinition, ref: GarmentMeasures, tieSize: string | null): MeasureRow | undefined {
  const relevant = def.kind === "pants" ? ["halfWaist", "length"] as const : ["shoulders", "chest", "length", "sleeve"] as const;
  const weights: Partial<Record<keyof GarmentMeasures, number>> = def.kind === "pants" ? { halfWaist: 1.5, length: 0.5 } : { shoulders: 1, chest: 1.4, length: 0.5, sleeve: 0.7 };
  const scored = def.rows.filter(row => !def.unavailableSizes.includes(row.tag)).map(row => {
    let score = 0, fields = 0;
    for (const k of relevant) if (ref[k] !== undefined && row.measures[k]) {
      score += rangeDistance(ref[k]!, row.measures[k]!) * weights[k]!; fields++;
    }
    return { row, score, fields };
  }).filter(r => r.fields);
  scored.sort((a, b) => a.score - b.score || (a.row.tag === tieSize ? -1 : b.row.tag === tieSize ? 1 : 0) || def.sizes.indexOf(a.row.tag) - def.sizes.indexOf(b.row.tag));
  return scored[0]?.row;
}

function modelSize(def: DetailedSizeDefinition, rules: ReviewedSizeRule[], input: DetailedSizeInput): { size: string | null; fitKnown: boolean } {
  const usable = rules.filter(r => r.size && !r.manual && !hasMeasures(r.reference) && r.lengthPreference === "standard");
  const rowsFor = (fit: DetailedFit): SizeExample[] => usable.filter(r => r.fit === fit).map(r => ({ height: r.height, weight: r.weight, size: r.size!, fit: legacyFit[fit] }));
  const exactFit = rowsFor(input.fit);
  const fitKnown = exactFit.length > 0;
  const rows = fitKnown ? exactFit : rowsFor("regular");
  const fit = fitKnown ? legacyFit[input.fit] : "regular";
  if (!rows.length) return { size: null, fitKnown: false };
  const result = recommendSize({ sizes: def.sizes.filter(s => !def.unavailableSizes.includes(s)), examples: rows }, input.height, input.weight, fit);
  return { size: result.size, fitKnown };
}

function compareMeasures(def: DetailedSizeDefinition, row: MeasureRow | undefined, ref: GarmentMeasures): string[] {
  if (!row) return hasMeasures(ref) ? ["Для сравнения с любимой вещью нужен фактический замер выбранного размера."] : [];
  const checks: string[] = [];
  if (ref.shoulders !== undefined && row.measures.shoulders && ref.shoulders > row.measures.shoulders[1] + 2 && def.key !== "muzhik-longsleeve")
    checks.push("Плечи по сетке уже любимой вещи. Уточните посадку и перемерьте выбранный экземпляр.");
  const chest = row.measures.chest;
  if (ref.chest !== undefined && chest && ref.chest > chest[1] + (def.stretch === "moderate" && !def.buttoned ? 2 : 1))
    checks.push(`Грудь вещи ${chest[0] === chest[1] ? chest[0] : chest.join("–")} см, любимой — ${ref.chest} см. Проверьте посадку${def.buttoned ? " с застёгнутыми пуговицами" : ""}.`);
  const waist = row.measures.halfWaist;
  if (ref.halfWaist !== undefined && waist && Math.abs(ref.halfWaist - Math.min(waist[1], Math.max(waist[0], ref.halfWaist))) > 1)
    checks.push(`Сравните спокойный полупояс выбранной пары с любимыми брюками (${ref.halfWaist} см). Растянутый максимум не означает комфортную посадку.`);
  if (ref.sleeve !== undefined && row.measures.sleeve && row.measures.sleeve[1] < ref.sleeve - 1)
    checks.push("Рукав по сетке короче любимой вещи. Перемерьте конкретный экземпляр.");
  if (ref.length !== undefined && row.measures.length && rangeDistance(ref.length, row.measures.length) > 1)
    checks.push("Длина выбранного размера отличается от любимой вещи. Уточните, подходит ли такая длина.");
  return checks;
}

function resultFor(product: DetailedSizeProduct, def: DetailedSizeDefinition | undefined, variant: ResolvedVariant, input: DetailedSizeInput): VariantSizeResult {
  const base = { colorId: variant.id, colorName: variant.name };
  const clarification = (message: string): VariantSizeResult => ({ ...base, size: null, basis: "clarification", message, checks: [], requiresCheck: true });
  if (!variant.supported) return clarification("Для этого цвета рекомендации ещё не проверены. Уточните размер у владельца.");
  const ref = input.reference ?? {};
  if (!def) {
    const result = recommendSize(product, input.height, input.weight, legacyFit[input.fit]);
    const checks = hasMeasures(ref) ? ["Для этой модели ещё нет проверенной сетки: дополнительные мерки нужно сверить с конкретной вещью."] : [];
    if (input.lengthPreference === "cropped") checks.push("Уточните длину укороченной посадки перед отправкой.");
    return { ...base, size: result.size, basis: "legacy", message: result.message, checks, requiresCheck: result.kind === "uncertain" || checks.length > 0 };
  }
  const rules = def.rules.filter(r => colorApplies(r, variant.id));
  const qualified = rules.filter(r => sameProfile(r, input) && r.fit === input.fit && r.lengthPreference === input.lengthPreference &&
    (hasMeasures(ref) ? hasMeasures(r.reference) && referenceMatches(r.reference, ref) : !hasMeasures(r.reference)));
  qualified.sort((a, b) => measureCount(b.reference) - measureCount(a.reference) || (b.colors.length ? 1 : 0) - (a.colors.length ? 1 : 0));
  // These two weight/height choices were explicitly kept even when reference waist was supplied.
  const waistOverride = input.fit === "regular" && input.lengthPreference === "standard" && ref.halfWaist !== undefined && (
    (def.key === "dense-new-stripe-pants" && input.height === 183 && input.weight === 88) ||
    (def.key === "margiela-striped-pants" && input.height === 180 && input.weight === 60)
  );
  const ownerRule = qualified[0] ?? (waistOverride ? rules.find(r => sameProfile(r, input) && r.fit === "regular" && !hasMeasures(r.reference)) : undefined);
  let size: string | null = null;
  let basis: VariantSizeResult["basis"] = "estimate";
  let message = "Предварительный размер по согласованным рекомендациям магазина.";
  let manual = false;
  const checks: string[] = [];
  if (ownerRule) {
    size = ownerRule.size; basis = "owner"; manual = ownerRule.manual;
    message = ownerRule.reason ?? "По согласованному примеру магазина для этих параметров и посадки.";
    if (!size) return clarification(message);
  } else {
    const model = modelSize(def, rules, input);
    if (hasMeasures(ref)) {
      const hasVolumeMeasure = def.kind === "pants" ? ref.halfWaist !== undefined : ref.shoulders !== undefined || ref.chest !== undefined;
      if (input.lengthPreference === "cropped" && !hasVolumeMeasure) {
        if (!model.size) return clarification("Уточните плечи и грудь любимой вещи либо полупояс брюк. Одна длина не определяет размер по объёму.");
        size = model.size;
        message = "Размер по объёму; желаемую укороченную длину проверьте отдельно.";
      } else {
      const row = closestRow(def, ref, model.size);
      if (!row) return clarification("Для этих мерок нужна проверка конкретной вещи: проверенной сетки пока нет.");
      size = row.tag; basis = "measurements"; message = "Ближе к замерам любимой вещи по размерной сетке.";
      if (ref.chest !== undefined && row.measures.chest && ref.chest > row.measures.chest[1] + (def.stretch === "moderate" && !def.buttoned ? 2 : 1))
        return clarification("По груди подходящий размер не подтверждён. Проверьте конкретную вещь; растяжение не заменяет нужную ширину.");
      if (ref.halfWaist !== undefined && row.measures.halfWaist && rangeDistance(ref.halfWaist, row.measures.halfWaist) > 3)
        return clarification("Спокойный полупояс не совпадает с любимыми брюками. Нужен фактический замер подходящей пары.");
      }
    } else {
      size = def.key === "huge-pants" && input.weight < 50 ? "L" : model.size;
      if (!size) return clarification("Для этих параметров недостаточно проверенных рекомендаций. Уточните мерки любимой вещи.");
      if (!model.fitKnown && input.fit !== "regular") checks.push("Это ориентир по обычной посадке. Для выбранной посадки уточните мерки любимой вещи.");
    }
  }
  if (!def.sizes.includes(size) || def.unavailableSizes.includes(size)) return clarification("Этот размер не входит в проверенный ряд модели.");
  const row = def.rows.find(r => r.tag === size);
  checks.push(...compareMeasures(def, row, ref));
  if (row?.estimated && !def.acceptedEstimatedGrading) checks.push("Замеры этого размера расчётные. Перемерьте вещь перед отправкой.");
  if (def.checkWaistBeforeShipping) checks.push("Перед отправкой перемерьте полупояс этой пары: экземпляры с одинаковой биркой отличаются.");
  if (input.lengthPreference === "cropped" && ref.length === undefined)
    checks.push(`Уточните желаемую длину${row?.measures.length ? `: у этого размера ${row.measures.length[0] === row.measures.length[1] ? row.measures.length[0] : row.measures.length.join("–")} см` : ""}. Укороченность сама по себе не меняет размер по объёму.`);
  const available = variant.stockSizes ?? product.sizes;
  if (!available.includes(size)) checks.push(`Проверьте наличие ${size} для этого цвета. Подходящий размер автоматически не заменяется соседним.`);
  if (input.fit === "closer") checks.push("Посадка ближе к телу; облегание без примерки не гарантировано.");
  return { ...base, size, basis, message, checks: [...new Set(checks)], requiresCheck: manual || checks.length > 0 };
}

export function recommendAllColors(product: DetailedSizeProduct, input: DetailedSizeInput): VariantSizeResult[] {
  const definition = definitions.get(product.id);
  const invalid = invalidInput(input);
  return variantsFor(product, definition).map(variant => invalid ? {
    colorId: variant.id, colorName: variant.name, size: null, basis: "clarification", message: invalid, checks: [], requiresCheck: true,
  } : resultFor(product, definition, variant, input));
}

// Used by the regression report to distinguish a tested owner anchor from a new estimate.
export function isReviewedInput(rule: ReviewedSizeRule, input: DetailedSizeInput) {
  return sameProfile(rule, input) && rule.fit === input.fit && rule.lengthPreference === input.lengthPreference && sameMeasures(rule.reference, input.reference ?? {});
}
