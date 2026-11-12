import type { SizeExample } from "./sizes";
import type { DetailedSizeDefinition, ReviewedSizeRule } from "./detailed-size-types";

const identity = (r: SizeExample) => JSON.stringify([r.height, r.weight, r.fit, r.size, r.colorId ?? ""]);

export function changedExampleWithoutColor(incoming: SizeExample[], previous: SizeExample[]) {
  const existing = new Set(previous.map(identity));
  return incoming.some(r => (!r.colorId || r.colorId === "all") && !existing.has(identity(r)));
}

/** Saving a photo/note must not reconfirm every old, potentially superseded row. */
export function confirmSizeExamples(incoming: SizeExample[], previous: SizeExample[], now = new Date().toISOString()): SizeExample[] {
  const existing = new Map(previous.map(r => [identity(r), r]));
  return incoming.map(r => {
    const old = existing.get(identity(r));
    const confirmedAt = old ? old.confirmedAt : now;
    return { height: r.height, weight: r.weight, fit: r.fit, size: r.size,
      ...(r.colorId ? { colorId: r.colorId } : {}), ...(confirmedAt ? { confirmedAt } : {}) };
  });
}

export const rulePriority = (r: ReviewedSizeRule) =>
  r.source === "fitting" ? 4 : r.source === "editor" ? 3 : r.source === "catalog" ? 0 : 2;

export function needsExampleColor(def?: DetailedSizeDefinition) {
  if (!def || def.sharedSizeAcrossColors) return false;
  const profiles = new Map<string, Set<string>>();
  for (const r of def.rules) if (r.colors.length && r.size) {
    const key = JSON.stringify([r.height, r.weight, r.fit, r.reference, r.lengthPreference]);
    const sizes = profiles.get(key) ?? new Set<string>();
    sizes.add(r.size); profiles.set(key, sizes);
  }
  return [...profiles.values()].some(sizes => sizes.size > 1);
}

const profileKey = (r: ReviewedSizeRule) => JSON.stringify([r.height, r.weight, r.fit, r.lengthPreference, r.reference]);

/** All live catalog examples participate; reviewed corrections outrank old rows.
 * Catalog snapshots are not a second live source: deleting a row must remove it.
 */
export function combineSizeExamples(def: DetailedSizeDefinition, examples: SizeExample[], colorId: string): ReviewedSizeRule[] {
  const reviewed = def.rules.filter(r => r.source !== "catalog" && (!r.colors.length || r.colors.includes(colorId)));
  const catalog: ReviewedSizeRule[] = examples.filter(r => def.sizes.includes(r.size) && !def.unavailableSizes.includes(r.size) &&
    ["tight", "regular", "loose"].includes(r.fit) && Number.isFinite(r.height) && Number.isFinite(r.weight) &&
    (!r.colorId || r.colorId === "all" || r.colorId === colorId)).map((r, i) => ({
    id: `catalog-${i}`, height: r.height, weight: r.weight, size: r.size,
    fit: r.fit === "tight" ? "closer" : r.fit === "loose" ? "relaxed" : "regular",
    colors: r.colorId && r.colorId !== "all" ? [r.colorId] : [], reference: {}, manual: false, lengthPreference: "standard",
    source: r.confirmedAt && Number.isFinite(Date.parse(r.confirmedAt)) ? "editor" : "catalog",
  }));
  const combined = [...reviewed, ...catalog].sort((a, b) => rulePriority(b) - rulePriority(a));
  const chosen = new Map<string, ReviewedSizeRule>();
  for (const r of combined) if (!chosen.has(profileKey(r))) chosen.set(profileKey(r), r);
  const rules = [...chosen.values()];
  const authoritative = rules.filter(r => r.source !== "catalog" && r.size && !r.manual && !Object.keys(r.reference).length && r.lengthPreference === "standard");
  // Old examples may predate the owner's corrections. Do not let a stale row
  // force a smaller size for a heavier customer than a reviewed nearby anchor.
  return rules.filter(r => {
    if (r.source !== "catalog" || !r.size) return true;
    const sameFit = authoritative.filter(a => a.fit === r.fit);
    const index = def.sizes.indexOf(r.size);
    const lower = Math.max(0, ...sameFit.filter(a => a.height <= r.height && a.weight <= r.weight).map(a => def.sizes.indexOf(a.size!)));
    const upper = Math.min(def.sizes.length - 1, ...sameFit.filter(a => a.height >= r.height && a.weight >= r.weight).map(a => def.sizes.indexOf(a.size!)));
    return lower > upper || index >= lower && index <= upper;
  });
}
