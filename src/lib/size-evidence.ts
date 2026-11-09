import { recommendSize, type SizeExample } from "@/lib/sizes";
import { columnKey, isTrousers, type SizeComparison, type SizeCustomer, type SizeProfile } from "@/lib/size-profile";

export type SizeProductFacts = { id?: string; name: string; note: string; examples?: SizeExample[]; sizes?: string[]; stock_details?:{material?:string;composition?:string;stretch?:string} };
const round = (value: number) => Math.round(value * 1000) / 1000;
export const cm = (value: number) => String(round(value)).replace(".", ",");

/** Table minus customer's favourite garment. Negative means narrower, never 'closer'. */
export function compareSizeMeasurements(profile: SizeProfile, input: SizeCustomer): SizeComparison {
  if (profile.colorGrids) return {nearest:[],rows:[]}; // Color grids use their complete ranges/samples, never compatibility minima.
  const keys = isTrousers(profile) ? ["halfWaistCm"] : ["shouldersCm", "chestWidthCm"];
  const columns = profile.columns.flatMap((label, index) => {
    const key = columnKey(profile, index);
    const value = input[key as "halfWaistCm" | "shouldersCm" | "chestWidthCm"];
    return keys.includes(key) && typeof value === "number" ? [{ key, label, index, value }] : [];
  });
  if (!columns.length) return { nearest: [], rows: [] };
  const rows = profile.rows.map(row => {
    const measurements = columns.map(column => ({ key: column.key, label: column.label, clientCm: column.value,
      itemCm: row.values[column.index], deltaCm: round(row.values[column.index] - column.value) }));
    return { size: row.size, measurements, distanceCm: round(measurements.reduce((sum, m) => sum + Math.abs(m.deltaCm), 0)) };
  });
  const min = Math.min(...rows.map(row => row.distanceCm));
  return { rows, nearest: rows.filter(row => Math.abs(row.distanceCm - min) < 0.000001).map(row => row.size) };
}

export function sizeOwnerGuidance(product: SizeProductFacts, profile: SizeProfile, input: SizeCustomer) {
  const sizes = (product.sizes?.length ? product.sizes : profile.rows.map(row => row.size)).filter(size => profile.rows.some(row => row.size === size));
  const examples = (product.examples ?? []).filter(row => sizes.includes(row.size));
  const estimate = recommendSize({ sizes, examples }, input.height, input.weight, input.fit);
  const sameFit = examples.filter(row => row.fit === input.fit);
  const usable = estimate.size !== null && (estimate.kind === "exact" || (sameFit.length >= 3 && estimate.warnings.length === 0));
  const nearest = [...sameFit].sort((a, b) => Math.hypot((a.height - input.height) / 7, (a.weight - input.weight) / 10)
    - Math.hypot((b.height - input.height) / 7, (b.weight - input.weight) / 10)).slice(0, 6);
  return { status: "unconfirmed_owner_recommendations" as const, usable, suggestedSize: usable ? estimate.size : null,
    examples: nearest, warnings: estimate.warnings, reason: usable ? "Есть согласованный ориентир владельца для этой посадки; это не подтверждённая примерка." : "Близких согласованных ориентиров недостаточно либо есть граница размеров. Нужна одна прямая мерка." };
}

export function sizeAllowedCandidates(comparison: SizeComparison, profile: SizeProfile) {
  if (!comparison.rows.length) return [];
  if (isTrousers(profile)) {
    const lower = comparison.rows.filter(row => row.measurements[0].deltaCm <= 0).sort((a, b) => b.measurements[0].deltaCm - a.measurements[0].deltaCm)[0];
    const upper = comparison.rows.filter(row => row.measurements[0].deltaCm >= 0).sort((a, b) => a.measurements[0].deltaCm - b.measurements[0].deltaCm)[0];
    return [...new Set([lower?.size, upper?.size].filter((size): size is string => !!size))];
  }
  return comparison.nearest;
}
