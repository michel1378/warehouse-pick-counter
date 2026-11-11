import type { DetailedFit, ReviewedSizeRule } from "./detailed-size-types";

type Anchor = { height: number; weight: number; index: number };
const cache = new Map<string, ReturnType<typeof prepare>>();
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const profileDistance = (a: { height: number; weight: number }, b: { height: number; weight: number }) =>
  Math.hypot((a.height - b.height) / 7, (a.weight - b.weight) / 10);

// One regular-fit surface, with nonnegative slopes and bounds from shop examples.
// A single slim/loose example must never become an independent constant model.
function prepare(anchors: Anchor[], count: number) {
  const mh = anchors.reduce((n, a) => n + a.height, 0) / anchors.length;
  const mw = anchors.reduce((n, a) => n + a.weight, 0) / anchors.length;
  const my = anchors.reduce((n, a) => n + a.index, 0) / anchors.length;
  let hh = 0.25, ww = 0.25, hw = 0, hy = 0, wy = 0;
  for (const a of anchors) {
    const h = (a.height - mh) / 7, w = (a.weight - mw) / 10, y = a.index - my;
    hh += h * h; ww += w * w; hw += h * w; hy += h * y; wy += w * y;
  }
  const determinant = hh * ww - hw * hw;
  const candidates = [[0, 0], [Math.max(0, hy / hh), 0], [0, Math.max(0, wy / ww)]];
  const joint = [(hy * ww - wy * hw) / determinant, (wy * hh - hy * hw) / determinant];
  if (joint.every(n => n >= 0 && Number.isFinite(n))) candidates.push(joint);
  const loss = ([h, w]: number[]) => anchors.reduce((sum, a) => sum + (my + h * (a.height - mh) / 7 + w * (a.weight - mw) / 10 - a.index) ** 2, 0) + 0.25 * (h * h + w * w);
  candidates.sort((a, b) => loss(a) - loss(b));
  const [sh, sw] = candidates[0];
  const hs = anchors.map(a => a.height), ws = anchors.map(a => a.weight);
  const raw = (height: number, weight: number) => {
    const lower = Math.max(0, ...anchors.filter(a => a.height <= height && a.weight <= weight).map(a => a.index));
    const upper = Math.min(count - 1, ...anchors.filter(a => a.height >= height && a.weight >= weight).map(a => a.index));
    const exact = anchors.filter(a => a.height === height && a.weight === weight);
    const trend = my + sh * (height - mh) / 7 + sw * (weight - mw) / 10;
    let localSum = trend * 0.2, localWeight = 0.2;
    for (const a of anchors) {
      const influence = 1 / Math.max(0.000001, profileDistance(a, { height, weight }) ** 2);
      localSum += a.index * influence; localWeight += influence;
    }
    const local = localSum / localWeight;
    // Old catalog examples can disagree. Keep exact examples, without forcing a
    // contradictory envelope onto every nearby customer.
    const score = exact.length && new Set(exact.map(a => a.index)).size === 1 ? exact[0].index
      : lower <= upper ? clamp(local, lower, upper) : clamp(local, 0, count - 1);
    // At an exact height, the shop's next heavier example also bounds every
    // lighter customer. This resolves contradictory old cross-height examples.
    const nextSameHeight = Math.min(count - 1, ...anchors.filter(a => a.height === height && a.weight >= weight).map(a => a.index));
    return Math.min(score, nextSameHeight);
  };
  const columns = new Map<number, number[]>();
  const weights = [...new Set([...Array.from({ length: 226 }, (_, i) => i + 25), ...ws])].sort((a, b) => a - b);
  return (height: number, weight: number) => {
    let column = columns.get(height);
    if (!column) {
      let previous = 0;
      column = weights.map(w => previous = Math.max(previous, raw(height, w)));
      if (columns.size >= 64) columns.delete(columns.keys().next().value!);
      columns.set(height, column);
    }
    const right = weights.findIndex(w => w >= weight);
    const index = right < 0 ? weights.length - 1 : right;
    const left = Math.max(0, index - 1);
    const ratio = left === index ? 0 : clamp((weight - weights[left]) / (weights[index] - weights[left]), 0, 1);
    return { score: column[left] + (column[index] - column[left]) * ratio, outside: height > Math.max(...hs) + 10 || weight > Math.max(...ws) + 15 };
  };
}

export function regularProfile(rules: ReviewedSizeRule[], sizes: string[], height: number, weight: number) {
  const anchors = rules.filter(r => r.fit === "regular" && r.size && !r.manual && !Object.keys(r.reference).length && r.lengthPreference === "standard" && sizes.includes(r.size))
    .map(r => ({ height: r.height, weight: r.weight, index: sizes.indexOf(r.size!) }));
  if (!anchors.length) return null;
  const key = JSON.stringify([sizes, anchors]);
  let model = cache.get(key);
  if (!model) {
    model = prepare(anchors, sizes.length);
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, model);
  }
  return model(height, weight);
}

export function fitOffset(rules: ReviewedSizeRule[], sizes: string[], input: { height: number; weight: number; fit: DetailedFit }, prior: number) {
  if (input.fit === "regular") return 0;
  const usable = rules.filter(r => r.size && !r.manual && !Object.keys(r.reference).length && r.lengthPreference === "standard");
  let total = 0.7, sum = prior * total;
  for (const row of usable.filter(r => r.fit === input.fit)) {
    const regular = usable.find(r => r.fit === "regular" && r.height === row.height && r.weight === row.weight);
    const regularIndex = regular ? sizes.indexOf(regular.size!) : Math.round(regularProfile(rules, sizes, row.height, row.weight)?.score ?? NaN);
    if (!Number.isFinite(regularIndex)) continue;
    const delta = sizes.indexOf(row.size!) - regularIndex;
    // An unpaired fit example cannot establish "same as regular": that regular
    // size was itself only a prediction. Keep true paired exceptions instead.
    if (!regular && delta === 0) continue;
    if (input.fit === "relaxed" ? delta < 0 : delta > 0) continue;
    const distance = profileDistance(row, input);
    if (distance === 0) return delta;
    const weight = Math.exp(-distance * distance / 2) / (distance * distance);
    sum += delta * weight; total += weight;
  }
  return input.fit === "relaxed" ? clamp(sum / total, 0, 1) : clamp(sum / total, -1, 0);
}

const fitColumns = new Map<string, Map<number, { weights: number[]; scores: number[] }>>();
export function profileWithFit(rules: ReviewedSizeRule[], sizes: string[], input: { height: number; weight: number; fit: DetailedFit }, prior: number) {
  const regular = regularProfile(rules, sizes, input.height, input.weight);
  if (!regular || input.fit === "regular") return regular;
  const key = JSON.stringify([sizes, rules, input.fit, prior]);
  let columns = fitColumns.get(key);
  if (!columns) {
    if (fitColumns.size >= 64) fitColumns.delete(fitColumns.keys().next().value!);
    columns = new Map(); fitColumns.set(key, columns);
  }
  let column = columns.get(input.height);
  if (!column) {
    const anchors = rules.filter(r => r.fit === input.fit && r.size && !r.manual && !Object.keys(r.reference).length && r.lengthPreference === "standard");
    const weights = [...new Set([...Array.from({ length: 226 }, (_, i) => i + 25), ...anchors.map(r => r.weight)])].sort((a, b) => a - b);
    let previous = 0;
    const scores = weights.map(weight => {
      const x = { ...input, weight };
      const base = regularProfile(rules, sizes, input.height, weight)!.score;
      const offset = fitOffset(rules, sizes, x, prior);
      const nextExample = Math.min(sizes.length - 1, ...anchors.filter(r => r.height === input.height && r.weight >= weight).map(r => sizes.indexOf(r.size!)));
      const score = Math.min(nextExample, clamp(base + offset, 0, sizes.length - 1));
      return previous = Math.max(previous, score);
    });
    column = { weights, scores };
    if (columns.size >= 64) columns.delete(columns.keys().next().value!);
    columns.set(input.height, column);
  }
  const right = column.weights.findIndex(w => w >= input.weight);
  const i = right < 0 ? column.weights.length - 1 : right, left = Math.max(0, i - 1);
  const ratio = left === i ? 0 : clamp((input.weight - column.weights[left]) / (column.weights[i] - column.weights[left]), 0, 1);
  const score = column.scores[left] + (column.scores[i] - column.scores[left]) * ratio;
  return { ...regular, score: input.fit === "relaxed" ? Math.max(regular.score, score) : Math.min(regular.score, score) };
}
