import snapshot from "./detailed-size-data.json";
import { recommendSize } from "./sizes";
import { profileDistance, profileWithFit } from "./detailed-size-model";
import { positiveFitting } from "./size-fittings";
import { combineSizeExamples, rulePriority } from "./size-examples";
import type {
  DetailedSizeDefinition, DetailedSizeInput, DetailedSizeProduct,
  GarmentMeasures, MeasureRow, ReviewedSizeRule, SizeCalibration, SizeVariant, VariantSizeResult,
} from "./detailed-size-types";

export const reviewedSizeData = snapshot as unknown as SizeCalibration;
const definitions = new Map(reviewedSizeData.products.map(p => [p.id, p]));
export const getDetailedSizeDefinition = (id: string) => definitions.get(id);
export const isPantsProduct = (product: DetailedSizeProduct) =>
  definitions.get(product.id)?.kind === "pants" || /брюк|джинс/i.test(product.name);
const measureKeys: (keyof GarmentMeasures)[] = ["shoulders", "chest", "halfWaist", "length", "sleeve"];
const normalizeColor = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[^а-яa-z0-9]/g, "");
const hasMeasures = (r: GarmentMeasures) => measureKeys.some(k => r[k] !== undefined);
const measureCount = (r: GarmentMeasures) => measureKeys.filter(k => r[k] !== undefined).length;
const sameProfile = (r: ReviewedSizeRule, input: DetailedSizeInput) => r.height === input.height && r.weight === input.weight;
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
export const getSizeVariants = (product: DetailedSizeProduct) => variantsFor(product, definitions.get(product.id)).map(({ id, name }) => ({ id, name }));

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
const midpoint = (r: [number, number]) => (r[0] + r[1]) / 2;
const reliable = (row: MeasureRow, key: keyof GarmentMeasures) => row.measures[key] && !row.unreliableMeasures?.includes(key);
const chestTolerance = (def: DetailedSizeDefinition) => def.stretch === "moderate" && !def.buttoned ? 2 : 0.5;

function closestRow(def: DetailedSizeDefinition, ref: GarmentMeasures, tieSize: string | null, input: DetailedSizeInput): MeasureRow | undefined {
  const relevant = def.kind === "pants" ? ["halfWaist", "length"] as const : ["shoulders", "chest", "length", "sleeve"] as const;
  const weights: Partial<Record<keyof GarmentMeasures, number>> = def.kind === "pants" ? { halfWaist: 2, length: 0.4 } : { shoulders: def.fitPolicy?.shouldersWeight ?? 0.8, chest: 1.5, length: 0.4, sleeve: 0.6 };
  const shift = input.fit === "relaxed" ? 1 : input.fit === "closer" ? -1 : 0;
  const target = { ...ref };
  if (target.chest !== undefined) target.chest += shift * 2;
  if (target.shoulders !== undefined) target.shoulders += shift;
  if (target.halfWaist !== undefined) target.halfWaist += shift;
  const scored = def.rows.filter(row => !def.unavailableSizes.includes(row.tag)).map(row => {
    let score = 0, fields = 0;
    const volumeKey = def.kind === "pants" ? "halfWaist" : "chest";
    if (ref[volumeKey] !== undefined && !reliable(row,volumeKey)) return {row,score:Infinity,fields:0};
    for (const k of relevant) if (target[k] !== undefined && reliable(row, k)) {
      score += rangeDistance(target[k]!, row.measures[k]!) ** 2 * weights[k]!; fields++;
    }
    // A shoulder measurement alone is not evidence that a much smaller chest fits.
    if (def.kind === "top" && ref.shoulders !== undefined && ref.chest === undefined && tieSize)
      score += Math.max(0, def.sizes.indexOf(tieSize) - def.sizes.indexOf(row.tag) - 1) ** 2 * 8;
    if (ref.chest !== undefined && reliable(row, "chest") && row.measures.chest![1] < target.chest! - chestTolerance(def)) score += 100;
    return { row, score, fields };
  }).filter(r => r.fields);
  const profileIndex = tieSize ? def.sizes.indexOf(tieSize) : -1;
  const profileGap = (row: MeasureRow) => profileIndex < 0 ? 0 : Math.abs(def.sizes.indexOf(row.tag) - profileIndex);
  // Equal measurements cannot distinguish overlapping labels (Cold S/M).
  // Use proximity to the height/weight choice, not the first/smallest tag.
  scored.sort((a, b) => a.score - b.score || profileGap(a.row) - profileGap(b.row) || def.sizes.indexOf(a.row.tag) - def.sizes.indexOf(b.row.tag));
  return scored[0]?.row;
}

// November warehouse review, regular fit at 165 cm (50 through 75 kg).
// These are estimates; live confirmed corrections and fitting records take precedence.
const reviewed165: Record<string,string[]> = {
 "alpaca-striped-buttons": [
  "M",
  "M",
  "M",
  "M/L",
  "L",
  "L"
 ],
 "alpaca-striped-no-buttons": [
  "M",
  "M",
  "M",
  "M",
  "L",
  "L"
 ],
 "wooden-buttons-longsleeve": [
  "S",
  "S",
  "S",
  "S",
  "M",
  "M"
 ],
 "black-cold-gray-longsleeve": [
  "S",
  "S",
  "S",
  "S",
  "M",
  "M"
 ],
 "black-cold-tshirt": [
  "M",
  "M",
  "M",
  "M",
  "M",
  "M"
 ],
 "muzhik-longsleeve": [
  "M",
  "M",
  "M",
  "M",
  "M",
  "M"
 ],
 "old-textured-longsleeve": [
  "M",
  "M",
  "M",
  "M",
  "M",
  "L"
 ],
 "asym-shirt": [
  "M",
  "M",
  "L",
  "L",
  "L",
  "XL"
 ],
 "best-distress-shirt": [
  "M",
  "M",
  "L",
  "L",
  "L",
  "XL"
 ],
 "flowers-shirt": [
  "M",
  "M",
  "L",
  "L",
  "L",
  "L"
 ],
 "old-textured-collar-shirt": [
  "M",
  "L",
  "L",
  "L",
  "XL",
  "XL"
 ],
 "samurai-shirt": [
  "2XL",
  "2XL",
  "2XL",
  "2XL",
  "3XL",
  "4XL"
 ],
 "margiela-striped-pants": [
  "M",
  "M",
  "L",
  "L",
  "XL",
  "2XL"
 ],
 "huge-pants": [
  "XL",
  "XL",
  "XL",
  "XL",
  "2XL",
  "3XL"
 ],
 "dense-new-stripe-pants": [
  "M",
  "M",
  "M",
  "L",
  "XL",
  "XL"
 ]
};

const reviewed160: Record<string,string[]> = {"alpaca-striped-buttons":["M","M/L","M/L","L"],"alpaca-striped-no-buttons":["M","M","L","L"],"wooden-buttons-longsleeve":["S","S","M","M"],"black-cold-gray-longsleeve":["S","S","M","M"],"black-cold-tshirt":["M","M","M","M"],"muzhik-longsleeve":["M","M","M","M"],"old-textured-longsleeve":["M","M","M","L"],"asym-shirt":["L","L","L","XL"],"best-distress-shirt":["L","L","L","XL"],"flowers-shirt":["L","L","L","L"],"old-textured-collar-shirt":["M","L","XL","XL"],"samurai-shirt":["2XL","2XL","3XL","4XL"],"margiela-striped-pants":["L","L","XL","XL"],"huge-pants":["XL","2XL","2XL","2XL"],"dense-new-stripe-pants":["M","L","XL","XL"]};
function modelSize(def: DetailedSizeDefinition, rules: ReviewedSizeRule[], input: DetailedSizeInput) {
  const sizes = def.sizes.filter(s => !def.unavailableSizes.includes(s));
  const policy = def.fitPolicy ?? { closerStep: -0.7, relaxedStep: 0.8 };
  const prior = input.fit === "closer" ? policy.closerStep : policy.relaxedStep;
  const profile = profileWithFit(rules, sizes, input, prior);
  if (!profile) return null;
  let index = Math.max(0, Math.min(sizes.length - 1, Math.round(profile.score)));
  const near = rules.filter(r => r.fit === "regular" && r.size && sizes.includes(r.size) && !r.manual && !hasMeasures(r.reference) && r.lengthPreference === "standard")
    .map(r=>({r,d:profileDistance(r,input)})).sort((a,b)=>a.d-b.d);
  // Estimate garment dimensions from known good labels, never from invented body measurements.
  if (reviewed165[def.key] && input.fit === "regular" && near.length && near[0].d <= 1.6) {
    const key = def.kind === "pants" ? "halfWaist" : "chest";
    const samples = near.slice(0,5).flatMap(({r,d})=>{
      const row = def.rows.find(x=>x.tag===r.size);
      return row && !row.estimated && reliable(row,key) && reliable(row,"length") ? [{row,w:(r.source==="fitting"?3:r.source==="editor"?2:1)/Math.max(0.02,d*d)}] : [];
    });
    if (samples.length >= 2) {
      const w = samples.reduce((n,x)=>n+x.w,0);
      const mean = (k: typeof key | "length") => samples.reduce((n,x)=>n+x.w*midpoint(x.row.measures[k]!),0)/w;
      const volume=mean(key),length=mean("length");
      const options = def.rows.filter(r=>sizes.includes(r.tag) && Math.abs(sizes.indexOf(r.tag)-profile.score)<=0.85 && !r.estimated && reliable(r,key) && reliable(r,"length"));
      const score = (r:MeasureRow) => 2*rangeDistance(volume,r.measures[key]!)**2 + 0.4*rangeDistance(length,r.measures.length!)**2 + (sizes.indexOf(r.tag)-profile.score)**2;
      options.sort((a,b)=>score(a)-score(b)||sizes.indexOf(a.tag)-sizes.indexOf(b.tag));
      if(options.length>1) index=sizes.indexOf(options[0].tag);
    }
  }
  return { size: sizes[index], outside: profile.outside || (!!reviewed165[def.key] && (!near.length || near[0].d>2.8)) };
}

// A larger label is useful for a looser fit only if it adds actual volume.
function addsVolume(def: DetailedSizeDefinition, regular: string, candidate: string) {
  const a = def.rows.find(r => r.tag === regular), b = def.rows.find(r => r.tag === candidate);
  if (!a || !b) return true; // No invented dimensions for Huge or buttoned Alpaca.
  const key = def.kind === "pants" ? "halfWaist" : "chest";
  if (!reliable(a, key) || !reliable(b, key)) return false;
  const difference = midpoint(b.measures[key]!) - midpoint(a.measures[key]!);
  if (difference > 0.25) return true;
  return difference >= 0 && def.kind === "top" && reliable(a, "shoulders") && reliable(b, "shoulders") && midpoint(b.measures.shoulders!) > midpoint(a.measures.shoulders!) + 0.5;
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

function resultFor(product: DetailedSizeProduct, def: DetailedSizeDefinition | undefined, variant: ResolvedVariant, input: DetailedSizeInput, directRequest = false): VariantSizeResult {
  const base = { colorId: variant.id, colorName: variant.name };
  const ref = input.reference ?? {};
  let estimate = () => recommendSize(product, input.height, input.weight, "regular").size;
  const clarification = (message: string, incompatible = false, preferred?: string | null): VariantSizeResult => {
    const sizes = def ? def.sizes.filter(s => !def!.unavailableSizes.includes(s)) : product.sizes;
    const predicted = preferred ?? estimate();
    const measured = def && hasMeasures(ref) ? closestRow(def, ref, predicted, input)?.tag : undefined;
    const size = [measured, predicted, ...sizes].find(s => s != null && sizes.includes(s)) ?? null;
    return { ...base, size, basis: "estimate", message: incompatible ? "Ближайший размер по сетке; по указанным меркам посадка не подходит." : "Ориентировочный размер.", checks: [message], requiresCheck: true };
  };
  if (!variant.supported && !product.fittings?.some(r => r.colorId === variant.id && positiveFitting(r))) return clarification("Для этого цвета пока нет отдельной сетки. Проверьте замеры экземпляра.");
  if (!def && (product.examples.length || product.fittings?.length)) def = {
    id: product.id, key: product.id, name: product.name, kind: isPantsProduct(product) ? "pants" : "top",
    variants: [], sizes: product.sizes, unavailableSizes: [], stretch: "unknown", buttoned: false,
    rows: [], checkWaistBeforeShipping: false, catalogAnchors: true, rules: [],
  };
  if (!def) {
    const result = recommendSize(product, input.height, input.weight, "regular");
    if (!result.size) return clarification("Нет примеров для этой модели.");
    return { ...base, size: result.size, basis: "legacy", message: result.message,
      checks: ["Для новой модели пока нет размерной сетки и правил посадки."], requiresCheck: true };
  }
  const observations = (product.fittings ?? []).filter(r => r.colorId === variant.id && def.sizes.includes(r.size));
  const good = observations.filter(positiveFitting);
  // Owner's regular-fit floor for the narrow Samurai cut, in either reviewed colour.
  // A supplied garment measurement or an exact fitting still takes precedence.
  if (def.key === "samurai-shirt" && ["black", "white"].includes(variant.id) &&
      input.height >= 180 && input.weight >= 75 && input.fit !== "closer" &&
      input.lengthPreference === "standard" && !hasMeasures(ref) &&
      !good.some(r => r.body.height === input.height && r.body.weight === input.weight && r.fit === input.fit)) {
    const checks = ["Сверьте длину рукава: у Самурайки прибавка по ширине не гарантирует прибавку по длине."];
    if (!(variant.stockSizes ?? product.sizes).includes("5XL")) checks.push("Проверьте наличие 5XL для этого цвета.");
    return { ...base, size: "5XL", basis: "owner", message: "По ширине этой модели магазин рекомендует 5XL.", checks, requiresCheck: true };
  }
  // Owner tried 2XL at 185/80; nearby regular-fit profiles are estimates.
  if (def.key === "dense-new-stripe-pants" && input.height >= 184 && input.height < 188 &&
      input.weight >= 79 && input.weight <= 82 && input.fit === "regular" &&
      input.lengthPreference === "standard" && !hasMeasures(ref)) {
    const exact = input.height === 185 && input.weight === 80;
    const checks = (variant.stockSizes ?? product.sizes).includes("2XL") ? [] : ["Проверьте наличие 2XL."];
    return { ...base, size: "2XL", basis: exact ? "owner" : "estimate",
      message: exact ? "По личной примерке: 2XL." : "По близкой примерке 185 см / 80 кг.",
      checks, requiresCheck: checks.length > 0 };
  }
  // Stable regular-fit band around the warehouse review (190 cm / 80–85 kg).
  if (def.key === "dense-new-stripe-pants" && input.height >= 188 &&
      input.weight >= 79 && input.fit !== "closer" && input.lengthPreference === "standard" &&
      !hasMeasures(ref)) {
    const size = "3XL";
    const checks = ["Сетка 3XL: полупояс без растяжения 43 см, длина 112 см. Пояс тянется."];
    if (!(variant.stockSizes ?? product.sizes).includes(size)) checks.push("Проверьте наличие 3XL.");
    return { ...base, size, basis: "owner", message: "По рекомендации магазина для высоких покупателей.", checks, requiresCheck: true };
  }
  const groups = new Map<string, typeof good>();
  for (const r of good) {
    const key = `${r.body.height}/${r.body.weight}/${r.fit}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const observedRules: ReviewedSizeRule[] = [];
  for (const group of groups.values()) {
    if (new Set(group.map(r => r.size)).size > 1) {
      const b = group[0].body;
      if (!hasMeasures(ref) && group[0].fit === input.fit && profileDistance(b, input) <= 0.5) {
        const chests = group.map(r => r.body.chestCircumference).filter((v): v is number => v !== null);
        const ordered = group.map(r => r.size).sort((a,b) => def!.sizes.indexOf(a) - def!.sizes.indexOf(b));
        return clarification(`На близких реальных примерках подошли разные размеры${chests.length > 1 && Math.max(...chests) - Math.min(...chests) >= 4 ? ": при одинаковых росте и весе различается обхват груди" : ""}. Укажите мерки подходящей вещи.`, false, ordered[Math.floor((ordered.length-1)/2)]);
      }
      continue; // Never average contradictory real bodies into a fictitious size.
    }
    const r = group[0];
    observedRules.push({ id: `fitting-${r.id}`, height: r.body.height, weight: r.body.weight, fit: r.fit as "closer" | "regular" | "relaxed", lengthPreference: "standard", colors: [variant.id], reference: {}, size: r.size, manual: false, source: "fitting" });
  }
  const calibrated = reviewed165[def.key];
  const review: ReviewedSizeRule[] = (calibrated ?? []).map((entry, i) => ({
    id: "nov-review-" + i, height:165, weight:50+i*5, fit:"regular", lengthPreference:"standard",
    colors:[variant.id], reference:{}, size:entry.split("/")[variant.id.startsWith("light-") && entry.includes("/") ? 1 : 0], manual:false, source:"inference"
  }));
  const recent = calibrated ? product.examples.filter(e => e.confirmedAt && Date.parse(e.confirmedAt) >= Date.UTC(2026,10,12))
    .sort((a,b) => Date.parse(b.confirmedAt!) - Date.parse(a.confirmedAt!)) : product.examples;
  for (const [i,entry] of (reviewed160[def.key] ?? []).entries()) review.push({ id:"review-160-"+i,height:160,weight:60+i*5,fit:"regular",lengthPreference:"standard",colors:[variant.id],reference:{},size:entry.split("/")[variant.id.startsWith("light-") && entry.includes("/") ? 1 : 0],manual:false,source:"inference" });
  const retained = calibrated ? def.rules.filter(r => r.manual || hasMeasures(r.reference) || (r.source==="owner" && r.height===183 && r.weight===78)) : def.rules;
  const rules = combineSizeExamples({ ...def, rules: [...review,...retained,...observedRules] }, recent, variant.id);
  estimate = () => modelSize(def!, rules, input)?.size ?? null;
  // A physically incompatible garment must not be sold as fitting merely because
  // an old height/weight example happened to carry its largest label.
  const chestRows = def.rows.filter(r => reliable(r, "chest") && !def.unavailableSizes.includes(r.tag));
  if (ref.chest !== undefined && chestRows.length) {
    const max = Math.max(...chestRows.map(r => r.measures.chest![1]));
    if (ref.chest > max + chestTolerance(def)) return clarification(`Грудь любимой вещи ${ref.chest} см, максимум этой модели ${max} см. Подходящего размера по этим меркам нет${def.buttoned ? ": учитываем застёгнутые пуговицы" : ""}.`, true);
  }
  const waistRows = def.rows.filter(r => reliable(r, "halfWaist") && !def.unavailableSizes.includes(r.tag));
  if (ref.halfWaist !== undefined && waistRows.length && ref.halfWaist > Math.max(...waistRows.map(r => r.measures.halfWaist![1])) + 1)
    return clarification("Полупояс любимых брюк больше спокойного полупояса всех размеров этой модели. Растянутый максимум не заменяет нужную ширину.", true);
  // The owner's try-on found a real sleeve limit, not an ordinal label problem.
  if (def.key === "samurai-shirt" && rules.some(r => r.manual && !r.size && sameProfile(r, input)) && ref.sleeve === undefined &&
    !observedRules.some(r => sameProfile(r, input) && r.fit === input.fit))
    return clarification("Для этих параметров корпус Самурайки подходит, но рукава коротки. Нужна длина рукава подходящей вещи: у 2XL–5XL здесь всего 58–60 см.");
  const qualified = rules.filter(r => sameProfile(r, input) && r.fit === input.fit && r.lengthPreference === input.lengthPreference &&
    (hasMeasures(ref) ? hasMeasures(r.reference) && sameMeasures(r.reference, ref) : !hasMeasures(r.reference)));
  qualified.sort((a, b) => rulePriority(b) - rulePriority(a) || measureCount(b.reference) - measureCount(a.reference) || (b.colors.length ? 1 : 0) - (a.colors.length ? 1 : 0));
  const waistOverride = input.fit === "regular" && input.lengthPreference === "standard" && ref.halfWaist !== undefined && (
    (def.key === "dense-new-stripe-pants" && input.height === 183 && input.weight === 88) ||
    (def.key === "margiela-striped-pants" && input.height === 180 && input.weight === 60)
  );
  const referenceAnchor = hasMeasures(ref) ? rules.filter(r => r.size && !r.manual && hasMeasures(r.reference) && r.fit === input.fit &&
    r.lengthPreference === input.lengthPreference && sameMeasures(r.reference, ref) && profileDistance(r, input) <= 1.2)
    .sort((a, b) => measureCount(b.reference) - measureCount(a.reference) || profileDistance(a, input) - profileDistance(b, input))[0] : undefined;
  const ownerRule = qualified[0] ?? (waistOverride ? rules.find(r => sameProfile(r, input) && r.fit === "regular" && !hasMeasures(r.reference)) : referenceAnchor);
  const model = modelSize(def, rules, input);
  let size: string | null = null;
  let basis: VariantSizeResult["basis"] = "estimate";
  let message = "Размер по рекомендациям магазина, меркам и выбранной посадке.";
  let manual = false;
  const checks: string[] = [];
  if (ownerRule) {
    size = ownerRule.size; basis = ownerRule.source === "fitting" ? "fitting" : ownerRule.source === "catalog" ? "legacy" : ownerRule.source === "inference" ? hasMeasures(ref) ? "measurements" : "estimate" : "owner";
    manual = ownerRule.manual;
    message = ownerRule.reason ?? "По рекомендациям магазина для этих параметров и посадки.";
    if (!size) return clarification(message);
  } else if (hasMeasures(ref) && def.rows.length) {
    const hasVolumeMeasure = def.kind === "pants" ? ref.halfWaist !== undefined : ref.shoulders !== undefined || ref.chest !== undefined;
    if (input.lengthPreference === "cropped" && !hasVolumeMeasure) {
      size = model?.size ?? null;
      message = "Размер по объёму; укороченную длину проверяем отдельно.";
    } else {
      const widthKey = def.kind === "pants" ? "halfWaist" : "chest";
      const width = ref[widthKey];
      const widthRows = def.kind === "pants" ? waistRows : chestRows;
      if (width !== undefined && widthRows.length) {
        const min = Math.min(...widthRows.map(r => r.measures[widthKey]![0]));
        const allowance = (def.kind === "pants" ? 2 : 3) + (input.fit === "relaxed" ? 2 : 0);
        if (width + allowance < min) {
          const label = def.kind === "pants" ? "Полупояс" : "Ширина по груди";
          return clarification(`${label} подходящей вещи — ${width} см. В проверенной сетке минимум ${min} см. Перед отправкой перемерьте ширину конкретного экземпляра.`);
        }
      }
      const row = closestRow(def, ref, model?.size ?? null, input);
      if (!row) return clarification("Нет достоверной сетки для введённого замера.");
      size = row.tag; basis = "measurements"; message = "Размер по меркам вещи с учётом выбранной посадки.";
    }
  } else {
    size = def.key === "huge-pants" && input.weight < 50 ? "L" : model?.size ?? null;
    if (model?.outside && (!hasMeasures(ref) || !def.rows.length) && !(def.key === "huge-pants" && input.weight < 50))
      return clarification(`Для этих роста и веса нужны ${def.kind === "pants" ? "полупояс и длина подходящих брюк" : "ширина по груди и длина подходящей вещи"}: параметры выходят за ориентиры этой модели.`);
    if (hasMeasures(ref) && !def.rows.length) checks.push("Полной сетки этой модели нет: указанный замер пока нельзя связать с биркой.");
  }
  if (!size || !def.sizes.includes(size) || def.unavailableSizes.includes(size)) return clarification("В размерном ряду нет подходящего размера по этим параметрам.");
  if (input.fit !== "regular") {
    const regular = resultFor(product, def, variant, { ...input, fit: "regular" });
    if (regular.size) {
      const regularIndex = def.sizes.indexOf(regular.size), candidateIndex = def.sizes.indexOf(size);
      // Fit ordering is enforced even for sparse fits and inputs with measurements.
      if (input.fit === "relaxed" && candidateIndex < regularIndex || input.fit === "closer" && candidateIndex > regularIndex) size = regular.size;
      if (!ownerRule && input.fit === "relaxed" && def.sizes.indexOf(size) > regularIndex && !addsVolume(def, regular.size, size)) {
        size = regular.size;
        checks.push("Следующая бирка не даёт подтверждённой прибавки по ширине. Для более свободной посадки сравните фактическую ширину вещи.");
      }
    }
  }
  // Bound estimates between reviewed profiles: a shorter, lighter customer
  // should not jump above a larger customer's reviewed label.
  if (def.key === "alpaca-striped-buttons" && ["dark-gray", "light-gray", "light-beige"].includes(variant.id) &&
      input.fit !== "relaxed" && input.lengthPreference === "standard" && !hasMeasures(ref) &&
      ownerRule?.source !== "fitting" && input.height >= 170 && input.height <= 185 &&
      input.weight >= 75 && input.weight <= 88) {
    const dark = variant.id === "dark-gray";
    const anchors: [number, number, string][] = [
      [173, 85, "XL"], [175, 85, "XL"], [180, 80, "XL"],
      [182, 86, dark ? "XL" : "2XL"], [183, 88, dark ? "XL" : "2XL"], [185, 85, "2XL"],
    ];
    let lo = 0, hi = def.sizes.length - 1;
    for (const [height, weight, regular] of anchors) {
      const index = def.sizes.indexOf(regular) - (input.fit === "closer" ? 1 : 0);
      if (input.height >= height && input.weight >= weight) lo = Math.max(lo, index);
      if (input.height <= height && input.weight <= weight) hi = Math.min(hi, index);
    }
    const bounded = def.sizes[Math.max(lo, Math.min(hi, def.sizes.indexOf(size)))];
    if (bounded !== size) {
      size = bounded; basis = "estimate"; message = "По рекомендациям магазина для этого цвета и посадки.";
    }
  }
  if (directRequest && def.key === "alpaca-striped-buttons" && input.fit === "regular" &&
      ((variant.id === "dark-gray" && input.height === 170 && input.weight === 65) ||
       (["light-gray", "light-beige"].includes(variant.id) && input.height === 160 && [55, 60].includes(input.weight))) &&
      input.lengthPreference === "standard" && !hasMeasures(ref)) {
    size = "M"; basis = "owner"; message = "Размер подтверждён владельцем для этих параметров.";
  }
  const failed = observations.find(r => r.size === size && !positiveFitting(r) && profileDistance(r.body, input) <= 0.35);
  if (failed && !hasMeasures(ref)) {
    const reason = failed.sleeve === "short" ? "короток рукав" : failed.length === "short" ? "коротка вещь" : failed.length === "long" || failed.sleeve === "long" ? "лишняя длина" : failed.fit === "too_tight" ? "тесно" : "слишком велико";
    const tags = def.sizes.filter(t => !def.unavailableSizes.includes(t));
    const step = failed.fit === "too_tight" || reason.startsWith("корот") ? 1 : -1;
    const adjacent = tags[tags.indexOf(size) + step] ?? size;
    return clarification(`На близкой реальной примерке у ${size}: ${reason}. Укажите мерки подходящей вещи; сверьте экземпляр перед отправкой.`, false, adjacent);
  }
  const row = def.rows.find(r => r.tag === size);
  checks.push(...compareMeasures(def, row, ref));
  if (row?.unreliableMeasures?.includes("chest") && (ref.chest !== undefined || input.fit === "relaxed"))
    checks.push("У Цветов в исходной сетке грудь L указана 60 см, XL — 56 см. Спорный замер L не используется как доказательство нужной ширины.");
  if (row?.estimated && !def.acceptedEstimatedGrading) checks.push("Замеры этого размера расчётные. Перемерьте вещь перед отправкой.");
  if (def.checkWaistBeforeShipping) checks.push("Перед отправкой перемерьте полупояс этой пары: экземпляры с одинаковой биркой отличаются.");
  if (input.lengthPreference === "cropped" && ref.length === undefined)
    checks.push("Укороченность сама по себе не меняет размер по объёму. Проверьте длину выбранной вещи.");
  const available = variant.stockSizes ?? product.sizes;
  if (!available.includes(size)) checks.push(`Проверьте наличие ${size} для этого цвета. Подходящий размер автоматически не заменяется соседним.`);
  return { ...base, size, basis, message, checks: [...new Set(checks)], requiresCheck: manual || checks.length > 0 };
}

export function recommendAllColors(product: DetailedSizeProduct, input: DetailedSizeInput): VariantSizeResult[] {
  const definition = definitions.get(product.id);
  const invalid = invalidInput(input);
  return variantsFor(product, definition).map(variant => invalid ? {
    colorId: variant.id, colorName: variant.name, size: null, basis: "clarification", message: invalid, checks: [], requiresCheck: true,
  } : (() => {
    const result = resultFor(product, definition, variant, input, true);
    const floors: Record<string, string> = { "wooden-buttons-longsleeve": "L", "black-cold-gray-longsleeve": "XL", "black-cold-tshirt": "L", "old-textured-collar-shirt": "2XL" };
    if (!definition || !variant.supported || input.fit === "closer" || input.lengthPreference !== "standard" ||
        hasMeasures(input.reference ?? {}) || !result.size || result.basis === "fitting" || result.basis === "owner") return result;
    const labels = definition.sizes.filter(x => !definition.unavailableSizes.includes(x));
    const idx = labels.indexOf(result.size);
    if (idx < 0) return result;
    // Use the reviewed 165 cm profile as a width reference. Length gains are
    // deliberately modest; do not gain several sizes solely to get a longer hem.
    const entries = reviewed165[definition.key];
    const slot = 0; // Length floor from the narrowest reviewed fit; the existing prediction handles width.
    const baseTag = entries?.[slot]?.split("/")[0];
    const baseline = definition.rows.find(r => r.tag === baseTag);
    const current = definition.rows.find(r => r.tag === result.size);
    const volume = definition.kind === "pants" ? "halfWaist" : "chest";
    let floor = result.size;
    if (input.height > 175 && baseline && current && reliable(baseline,"length") && reliable(current,"length") && reliable(current,volume)) {
      const desired = midpoint(baseline.measures.length!) + Math.min(5,(input.height-165)*0.13);
      const next = definition.rows.find(r=>r.tag===labels[idx+1]);
      if (next && reliable(next,"length") && reliable(next,volume) &&
          desired > midpoint(current.measures.length!)+0.8 &&
          Math.abs(midpoint(next.measures.length!)-desired)<Math.abs(midpoint(current.measures.length!)-desired) &&
          midpoint(next.measures[volume]!)-midpoint(current.measures[volume]!) <= (definition.kind==="pants"?1:3))
        floor = next.tag;
    }
    // The tall try-on sets the minimum length. For the tee this is L even
    // on a lean build; there is no reason to add the width of XL just for height.
    const tall = floors[definition.key];
    if (input.height>=189 && tall && (input.weight>=79 || definition.key==="black-cold-tshirt")) {
      floor = labels[Math.max(idx,labels.indexOf(tall))];
    }
    // For taller builds the L collar shirt is short (68 cm body, 60 cm sleeve).
    if (definition.key === "old-textured-collar-shirt" && input.height >= 185) {
      const minimum = input.height >= 189 && input.weight >= 79 ? "2XL" : "XL";
      if (labels.indexOf(floor) < labels.indexOf(minimum)) floor = minimum;
    }
    if (floor === result.size) return result;
    const checks = [definition.kind === "pants" ? "Сверьте полупояс и длину выбранной пары." : "Сверьте ширину и длину выбранной вещи."];
    if (!(variant.stockSizes ?? product.sizes).includes(floor)) checks.push("Проверьте наличие выбранного размера.");
    return { ...result, size: floor, basis: "estimate" as const, message: "Размер с учётом длины при высоком росте.", checks, requiresCheck: true };
  })());
}

// Used by the regression report to distinguish a tested owner anchor from a new estimate.
export function isReviewedInput(rule: ReviewedSizeRule, input: DetailedSizeInput) {
  return sameProfile(rule, input) && rule.fit === input.fit && rule.lengthPreference === input.lengthPreference && sameMeasures(rule.reference, input.reference ?? {});
}
