"use client";

import { useMemo, useState } from "react";
import { isPantsProduct, recommendAllColors } from "@/lib/detailed-sizes";
import type { DetailedFit, DetailedSizeProduct, GarmentMeasures } from "@/lib/detailed-size-types";

const fits: { id: DetailedFit; label: string }[] = [
  { id: "closer", label: "В облипку" },
  { id: "regular", label: "В размер" },
  { id: "relaxed", label: "Свободнее" },
];
type PickerMeasure = "shoulders" | "chest" | "halfWaist";
const labels: Record<PickerMeasure, string> = {
  shoulders: "Плечи, см", chest: "Грудь, см", halfWaist: "Полупояс, см",
};
const measureTitles: Record<PickerMeasure, string> = {
  shoulders: "Плечи любимой вещи в разложенном виде",
  chest: "Ширина любимой вещи от подмышки до подмышки, не обхват тела",
  halfWaist: "Полупояс любимых брюк без растяжения",
};
const topFields: PickerMeasure[] = ["shoulders", "chest"];
const pantsFields: PickerMeasure[] = ["halfWaist"];

export function DetailedSizePicker({ product }: { product: DetailedSizeProduct }) {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [fit, setFit] = useState<DetailedFit>("regular");
  const [measures, setMeasures] = useState<Partial<Record<PickerMeasure, string>>>({});
  const pants = isPantsProduct(product);
  const fields = pants ? pantsFields : topFields;
  const results = useMemo(() => {
    if (!height.trim() || !weight.trim()) return null;
    const reference: GarmentMeasures = {};
    for (const key of fields) if (measures[key]?.trim()) reference[key] = Number(measures[key]!.replace(",", "."));
    return recommendAllColors(product, { height: Number(height.replace(",", ".")), weight: Number(weight.replace(",", ".")), fit, lengthPreference: "standard", reference, measurementSubject: "garment" });
  }, [height, weight, fit, measures, product, fields]);
  const reset = () => { setHeight(""); setWeight(""); setFit("regular"); setMeasures({}); };

  return <div className="size-picker detailed-size-picker" id={`picker-${product.id}`}>
    <div className="size-measurements">
      <label>Рост, см<input type="number" inputMode="decimal" min="100" max="230" step="0.5" value={height} onChange={e => setHeight(e.target.value)} /></label>
      <label>Вес, кг<input type="number" inputMode="decimal" min="25" max="250" step="0.5" value={weight} onChange={e => setWeight(e.target.value)} /></label>
    </div>
    <div className="size-measurements">{fields.map(key => <label key={key}>{labels[key]}<input
      type="number" inputMode="decimal" min="1" max="160" step="0.5" title={measureTitles[key]} value={measures[key] ?? ""}
      onChange={e => setMeasures(old => ({ ...old, [key]: e.target.value }))}
    /></label>)}</div>
    <fieldset className="size-fit" aria-label="Посадка">{fits.map(f => <label key={f.id} className={fit === f.id ? "selected" : ""}>
      <input type="radio" name={`detailed-fit-${product.id}`} checked={fit === f.id} onChange={() => setFit(f.id)} />{f.label}
    </label>)}</fieldset>
    <div className="size-color-results" aria-live="polite" aria-atomic="true">
      {results?.map(result => <section key={result.colorId} className={`size-color-answer ${result.requiresCheck ? "needs-check" : ""}`}>
        <div className="size-color-answer-heading"><h3>{result.colorName}</h3><strong>{result.size ?? "Уточнить"}</strong></div>
        {!result.size && <p>{result.message}</p>}
        {!!result.checks.length && <ul>{result.checks.map(check => <li key={check}>{check}</li>)}</ul>}
      </section>)}
    </div>
    {(height || weight || Object.values(measures).some(Boolean) || fit !== "regular") &&
      <button type="button" className="secondary" onClick={reset}>Новый клиент</button>}
  </div>;
}
