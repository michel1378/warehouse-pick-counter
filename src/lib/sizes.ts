import { fitSizeModel, sizeDistance } from "./size-model";
/** Product-specific recommendations. No global size chart or automatic fit offset. */
export const FITS = ["tight", "regular", "loose"] as const;
export type Fit = typeof FITS[number];
export const FIT_LABELS: Record<Fit, string> = {
  tight: "В обтяг", regular: "Размер в размер", loose: "Немного оверсайз",
};
export type SizeExample = { height: number; weight: number; fit: Fit; size: string };
export type SizeProduct = {
  id: string; name: string; note: string; sizes: string[]; examples: SizeExample[];
  active: boolean; revision: number; updated_at: string; photo_count: number;
};
export type SizeResult = {
  size: string | null; kind: "exact" | "estimated" | "uncertain";
  message: string; evidence: SizeExample[]; warnings: SizeWarning[];
};
export function normalizeSize(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "").replace(/^XXL$/, "2XL")
    .replace(/^XXXL$/, "3XL").replace(/^XXXXL$/, "4XL").replace(/^XXXXXL$/, "5XL");
}

type ProductTable = Pick<SizeProduct, "sizes" | "examples">;
export type SizeConflict = { firstRow: number; secondRow: number; first: SizeExample; second: SizeExample };
export type SizeWarning = "conflict" | "boundary" | "sparse" | "outside";

function validRows(product: ProductTable) {
  return [...new Map(product.examples.filter(e => product.sizes.includes(e.size) && FITS.includes(e.fit)
    && Number.isFinite(e.height) && Number.isFinite(e.weight)).map(e => [JSON.stringify([e.height, e.weight, e.fit, e.size]), e])).values()]
    .sort((a, b) => a.height - b.height || a.weight - b.weight || a.fit.localeCompare(b.fit) || product.sizes.indexOf(a.size) - product.sizes.indexOf(b.size));
}

/** Report original row numbers; never rewrite or remove the owner's data. */
export function findSizeConflicts(product: ProductTable): SizeConflict[] {
  const conflicts: SizeConflict[] = [];
  product.examples.forEach((a, i) => product.examples.slice(i + 1).forEach((b, j) => {
    const ai = product.sizes.indexOf(a.size), bi = product.sizes.indexOf(b.size);
    if (a.fit !== b.fit || ai < 0 || bi < 0) return;
    if (a.height === b.height && a.weight === b.weight && ai !== bi) {
      conflicts.push({ firstRow: i + 1, secondRow: i + j + 2, first: a, second: b });
    }
  }));
  return conflicts;
}

// Content-keyed, bounded cache: edited examples cannot reuse an old fitted model.
const modelCache = new Map<string, ReturnType<typeof fitSizeModel>>();
function fixedModel(rows: SizeExample[], sizes: string[]) {
  const key = JSON.stringify([sizes, rows]);
  let model = modelCache.get(key);
  if (!model) {
    model = fitSizeModel(rows, sizes);
    if (modelCache.size >= 64) modelCache.delete(modelCache.keys().next().value!);
    modelCache.set(key, model);
  }
  return model;
}

/** Joint height/weight interpolation anchored to owner examples; no sign constraints. */
export function recommendSize(product: ProductTable, height: number, weight: number, fit: Fit): SizeResult {
  const unsure = (message: string, warnings: SizeWarning[] = [], evidence: SizeExample[] = []): SizeResult => ({ size: null, kind: "uncertain", message, evidence, warnings });
  if (!Number.isFinite(height) || !Number.isFinite(weight) || height < 100 || height > 230 || weight < 25 || weight > 250)
    return unsure("Проверьте рост (100–230 см) и вес (25–250 кг).");
  const same = validRows(product).filter(e => e.fit === fit);
  if (!same.length) return unsure("Для выбранной посадки нет примеров. Уточните у владельца.", ["sparse"]);
  const exact = same.filter(e => e.height === height && e.weight === weight);
  const evidence = [...same].sort((a, b) => sizeDistance(a.height - height, a.weight - weight) - sizeDistance(b.height - height, b.weight - weight)).slice(0, 6);
  if (new Set(exact.map(e => e.size)).size > 1)
    return unsure("Для одинаковых роста, веса и посадки записаны разные размеры. Администратору нужно проверить строки таблицы.", ["conflict"], exact);
  if (exact.length) return { size: exact[0].size, kind: "exact", message: "Такие параметры и посадка есть в таблице владельца.", evidence: exact, warnings: [] };
  const predict = fixedModel(same, product.sizes);
  const value = predict(height, weight);
  if (value === null) return unsure("Параметры далеко за пределами примеров этой посадки. Уточните у владельца.", ["outside"]);
  const warnings: SizeWarning[] = [];
  const reasons: string[] = [];
  const conflicts = findSizeConflicts({ ...product, examples: same });
  if (conflicts.some(c => sizeDistance(c.first.height - height, c.first.weight - weight) <= 1.8)) {
    warnings.push("conflict"); reasons.push("Рядом есть разные размеры для одинаковых роста, веса и посадки. Администратору нужно проверить строки таблицы.");
  }
  if (same.length < 6 || sizeDistance(evidence[0].height - height, evidence[0].weight - weight) > 1.8) {
    warnings.push("sparse"); reasons.push("Мало примеров выбранной посадки рядом с этими параметрами.");
  }
  const index = Math.round(value);
  const nearby = [[height - 2, weight], [height + 2, weight], [height, weight - 2], [height, weight + 2]];
  if (Math.abs(value - Math.floor(value) - 0.5) < 0.2 || nearby.some(([h, w]) => {
    const v = predict(h, w); return v !== null && Math.round(v) !== index;
  })) {
    warnings.push("boundary"); reasons.push("Граница размеров: небольшое изменение параметров может изменить рекомендацию.");
  }
  const hs = same.map(e => e.height), ws = same.map(e => e.weight);
  if (height < Math.min(...hs) || height > Math.max(...hs) || weight < Math.min(...ws) || weight > Math.max(...ws)) {
    warnings.push("outside"); reasons.push("Параметры за диапазоном примеров выбранной посадки.");
  }
  return { size: product.sizes[index], kind: warnings.length ? "uncertain" : "estimated", warnings,
    message: reasons.length ? reasons.join(" ") + " Уточните у владельца." : "Подбор по близким рекомендациям владельца с совместным учётом роста и веса. Это прогноз, а не точный пример.", evidence };
}
/** Exclude all duplicates of the tested measurements and fit to avoid leakage. */
export function evaluateSizeExamples(product: Pick<SizeProduct,"sizes"|"examples">) {
  return product.examples.map(example=>({example,result:recommendSize({...product,examples:product.examples.filter(e=>!(e.height===example.height && e.weight===example.weight && e.fit===example.fit))},example.height,example.weight,example.fit)}));
}

export function parseExampleRows(text: string): SizeExample[] {
  const rows = text.trim().split(/\r?\n/).filter(line => line.trim());
  if (!rows.length) throw new Error("Вставьте строки таблицы.");
  const fitNames: Record<string, Fit> = { tight: "tight", regular: "regular", loose: "loose", "в обтяг": "tight", "размер в размер": "regular", "немного оверсайз": "loose" };
  return rows.flatMap((line, index) => {
    const cells = line.split(/\t|;/).map(cell => cell.trim());
    if (index === 0 && /^рост/i.test(cells[0])) return [];
    const [h, w, f, s] = cells;
    const height = Number(h?.replace(",", ".")), weight = Number(w?.replace(",", "."));
    const fit = fitNames[f?.toLowerCase()];
    if (cells.length !== 4 || !fit || !s || !Number.isFinite(height) || !Number.isFinite(weight) || height < 100 || height > 230 || weight < 25 || weight > 250)
      throw new Error(`Строка ${index + 1}: нужны рост, вес, посадка, размер. Разделитель — табуляция или точка с запятой.`);
    return [{ height, weight, fit, size: normalizeSize(s) }];
  });
}
