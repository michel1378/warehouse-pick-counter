import type { SizeExample } from "./sizes";

// Frozen anchored-plane model: distance units 7 cm / 10 kg, ridge 0.25, residual IDW2.
export const sizeDistance = (dh: number, dw: number) => Math.hypot(dh / 7, dw / 10);
function canonicalRows(examples: SizeExample[], sizes: string[]) {
  return [...new Map(examples.filter(e => sizes.includes(e.size) && Number.isFinite(e.height) && Number.isFinite(e.weight))
    .map(e => [JSON.stringify([e.height, e.weight, e.fit, e.size]), e])).values()]
    .sort((a, b) => a.height - b.height || a.weight - b.weight || a.fit.localeCompare(b.fit) || sizes.indexOf(a.size) - sizes.indexOf(b.size))
    .map(e => ({ ...e })); // Prepared models must not retain mutable editor rows.
}

/** An unrestricted joint height/weight trend, with regularized slopes. */
function plane(rows: SizeExample[], sizes: string[]) {
  const mh = rows.reduce((s, e) => s + e.height, 0) / rows.length;
  const mw = rows.reduce((s, e) => s + e.weight, 0) / rows.length;
  const features = (h: number, w: number) => [1, (h - mh) / 7, (w - mw) / 10];
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  for (const e of rows) {
    const x = features(e.height, e.weight);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) matrix[i][j] += x[i] * x[j];
      matrix[i][3] += x[i] * sizes.indexOf(e.size);
    }
  }
  matrix[1][1] += 0.25; matrix[2][2] += 0.25;
  for (let i = 0; i < 3; i++) {
    const divisor = matrix[i][i];
    for (let k = i; k < 4; k++) matrix[i][k] /= divisor;
    for (let j = 0; j < 3; j++) if (j !== i) {
      const factor = matrix[j][i];
      for (let k = i; k < 4; k++) matrix[j][k] -= factor * matrix[i][k];
    }
  }
  return (h: number, w: number) => features(h, w).reduce((s, v, i) => s + v * matrix[i][3], 0);
}

/** All weights vary continuously; no top-k neighbor enters/leaves abruptly. */
export function fitSizeModel(examples: SizeExample[], sizes: string[]) {
  sizes = [...sizes];
  const rows = canonicalRows(examples, sizes);
  const trend = rows.length ? plane(rows, sizes) : () => 0;
  const residuals = rows.map(e => sizes.indexOf(e.size) - trend(e.height, e.weight));
  const hs = rows.map(e => e.height), ws = rows.map(e => e.weight);
  return (height: number, weight: number): number | null => {
    if (!rows.length || height < Math.min(...hs) - 10 || height > Math.max(...hs) + 10
      || weight < Math.min(...ws) - 15 || weight > Math.max(...ws) + 15) return null;
    const distances = rows.map(e => sizeDistance(e.height - height, e.weight - weight));
    const nearest = Math.min(...distances);
    if (nearest === 0) {
      const labels = rows.filter((_, i) => distances[i] === 0).map(e => sizes.indexOf(e.size));
      return new Set(labels).size === 1 ? labels[0] : null;
    }
    const weights = distances.map(d => (nearest / d) ** 2);
    const correction = residuals.reduce((s, value, i) => s + value * weights[i], 0) / weights.reduce((s, v) => s + v, 0);
    return Math.max(0, Math.min(sizes.length - 1, trend(height, weight) + correction));
  };
}
