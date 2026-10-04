/** Product-specific recommendations. No global size chart or automatic fit offset. */
export const FITS = ["tight", "regular", "loose"] as const;
export type Fit = typeof FITS[number];
export const FIT_LABELS: Record<Fit, string> = {
  tight: "В обтяг", regular: "Размер в размер", loose: "Немного оверсайз",
};
export type SizeExample = { height: number; weight: number; fit: Fit; size: string };
export type SizeProduct = {
  id: string; name: string; note: string; sizes: string[]; examples: SizeExample[];
  active: boolean; revision: number; updated_at: string;
};
export type SizeResult = {
  size: string | null; kind: "exact" | "estimated" | "uncertain";
  message: string; evidence: SizeExample[];
};
export function normalizeSize(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "").replace(/^XXL$/, "2XL")
    .replace(/^XXXL$/, "3XL").replace(/^XXXXL$/, "4XL").replace(/^XXXXXL$/, "5XL");
}

/** Heuristic distances, not probabilities. Calibrate against owners' held-out examples. */
export function recommendSize(product: Pick<SizeProduct, "sizes" | "examples">,
  height: number, weight: number, fit: Fit): SizeResult {
  const unsure = (message: string, evidence: SizeExample[] = []): SizeResult =>
    ({ size: null, kind: "uncertain", message, evidence });
  if (!Number.isFinite(height) || !Number.isFinite(weight) || height < 100 || height > 230 || weight < 25 || weight > 250)
    return unsure("Проверьте рост (100–230 см) и вес (25–250 кг).");
  const examples = product.examples.filter(e => e.fit === fit && product.sizes.includes(e.size));
  if (!examples.length) return unsure("Для этой посадки пока нет рекомендаций. Уточните у Кирилла.");
  const exact = examples.filter(e => e.height === height && e.weight === weight);
  if (exact.length) {
    if (new Set(exact.map(e => e.size)).size > 1) return unsure("В базе разные размеры для этих параметров. Уточните у Кирилла.", exact);
    return { size: exact[0].size, kind: "exact", message: "Такие параметры и посадка есть в вашей таблице.", evidence: exact };
  }
  // De-duplicate cases: repeating the same row must not give it extra weight.
  const unique = [...new Map(examples.map(e => [`${e.height}/${e.weight}/${e.size}`, e])).values()];
  const ranked = unique.map(e => ({ e, d: Math.hypot((height - e.height) / 7, (weight - e.weight) / 10) }))
    .sort((a, b) => a.d - b.d || a.e.height - b.e.height || a.e.weight - b.e.weight || a.e.size.localeCompare(b.e.size));
  const nearby = ranked.filter(x => Math.abs(x.e.height - height) <= 10 && Math.abs(x.e.weight - weight) <= 15 && x.d <= 1.8);
  if (nearby.length < 2) return unsure("Мало близких примеров для этой посадки. Уточните размер у Кирилла.", ranked.slice(0, 3).map(x => x.e));
  const heights = examples.map(e => e.height), weights = examples.map(e => e.weight);
  if (height < Math.min(...heights) - 3 || height > Math.max(...heights) + 3 || weight < Math.min(...weights) - 4 || weight > Math.max(...weights) + 4)
    return unsure("Параметры выходят за проверенный диапазон. Уточните размер у Кирилла.", nearby.slice(0, 3).map(x => x.e));
  // Include all equally close neighbours, to avoid order-dependent choices at boundaries.
  const cutoff = nearby[Math.min(2, nearby.length - 1)].d;
  const selected = nearby.filter(x => x.d <= cutoff + 1e-9);
  const votes = new Map<string, number>();
  for (const { e, d } of selected) votes.set(e.size, (votes.get(e.size) ?? 0) + 1 / (d * d + 0.08));
  const ordered = [...votes].sort((a, b) => b[1] - a[1]);
  const total = ordered.reduce((sum, x) => sum + x[1], 0);
  const winner = ordered[0][0];
  const evidence = selected.slice(0, 6).map(x => x.e);
  const nearestDisagrees = selected.some(x => x.d <= selected[0].d * 1.2 + 0.05 && x.e.size !== winner);
  if (ordered[0][1] / total < 0.75 || nearestDisagrees)
    return unsure("Пограничный случай: близкие примеры дают разные размеры. Уточните у Кирилла.", evidence);
  return { size: winner, kind: "estimated", message: "Рекомендация по близким примерам с такой же посадкой.", evidence };
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
