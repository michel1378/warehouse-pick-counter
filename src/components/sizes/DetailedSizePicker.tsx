"use client";

import { useMemo, useState } from "react";
import { isPantsProduct, recommendAllColors } from "@/lib/detailed-sizes";
import type { DetailedFit, DetailedSizeProduct, GarmentMeasures } from "@/lib/detailed-size-types";

const fits: { id: DetailedFit; label: string }[] = [
  { id: "closer", label: "Ближе к телу" },
  { id: "regular", label: "По размеру" },
  { id: "relaxed", label: "Свободнее" },
];
const labels: Record<keyof GarmentMeasures, string> = {
  shoulders: "Плечи, см", chest: "Ширина груди, см", halfWaist: "Полупояс без растяжения, см", length: "Длина вещи, см", sleeve: "Рукав, см",
};
const topFields: (keyof GarmentMeasures)[] = ["shoulders", "chest", "length", "sleeve"];
const pantsFields: (keyof GarmentMeasures)[] = ["halfWaist", "length"];

export function DetailedSizePicker({ product }: { product: DetailedSizeProduct }) {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [fit, setFit] = useState<DetailedFit>("regular");
  const [lengthPreference, setLengthPreference] = useState<"standard" | "cropped">("standard");
  const [measures, setMeasures] = useState<Partial<Record<keyof GarmentMeasures, string>>>({});
  const pants = isPantsProduct(product);
  const fields = pants ? pantsFields : topFields;
  const results = useMemo(() => {
    if (!height.trim() || !weight.trim()) return null;
    const reference: GarmentMeasures = {};
    for (const key of fields) if (measures[key]?.trim()) reference[key] = Number(measures[key]!.replace(",", "."));
    return recommendAllColors(product, { height: Number(height.replace(",", ".")), weight: Number(weight.replace(",", ".")), fit, lengthPreference, reference, measurementSubject: "garment" });
  }, [height, weight, fit, lengthPreference, measures, product, fields]);
  const reset = () => { setHeight(""); setWeight(""); setFit("regular"); setLengthPreference("standard"); setMeasures({}); };

  return <div className="size-picker detailed-size-picker" id={`picker-${product.id}`}>
    <div className="size-measurements">
      <label>Рост, см<input type="number" inputMode="decimal" min="100" max="230" step="0.5" value={height} placeholder="Например, 175" onChange={e => setHeight(e.target.value)} /></label>
      <label>Вес, кг<input type="number" inputMode="decimal" min="25" max="250" step="0.5" value={weight} placeholder="Например, 75" onChange={e => setWeight(e.target.value)} /></label>
    </div>
    <fieldset className="size-fit"><legend>Как клиент хочет носить</legend>{fits.map(f => <label key={f.id} className={fit === f.id ? "selected" : ""}>
      <input type="radio" name={`detailed-fit-${product.id}`} checked={fit === f.id} onChange={() => setFit(f.id)} />{f.label}
    </label>)}</fieldset>
    <label className="size-length-choice">По длине<select value={lengthPreference} onChange={e => setLengthPreference(e.target.value as "standard" | "cropped")}>
      <option value="standard">Обычная длина</option><option value="cropped">Хочет укороченную</option>
    </select></label>
    <details className="size-reference-fields">
      <summary>Замеры любимой вещи — необязательно</summary>
      <p className="size-hint">Измеряйте вещь, которая сидит как нужно, в разложенном виде. {pants ? "Пояс — без натяжения." : "Грудь — ширина от подмышки до подмышки, не обхват тела. Рубашку застегните."} Можно заполнить только известные мерки.</p>
      <div className="size-measurements">{fields.map(key => <label key={key}>{labels[key]}<input
        type="number" inputMode="decimal" min="1" max="160" step="0.5" value={measures[key] ?? ""}
        onChange={e => setMeasures(old => ({ ...old, [key]: e.target.value }))}
      /></label>)}</div>
    </details>
    <div className="size-color-results" aria-live="polite" aria-atomic="true">
      {!results ? <p className="size-hint">Введите рост и вес. Для каждого цвета появится отдельный ответ.</p> : results.map(result => <section key={result.colorId} className={`size-color-answer ${result.requiresCheck ? "needs-check" : ""}`}>
        <div className="size-color-answer-heading"><h3>{result.colorName}</h3><strong>{result.size ?? "Уточнить"}</strong></div>
        <span className="size-answer-label">{result.size ? "Рекомендуемый размер" : "Нужна проверка"}</span>
        <p>{result.message}</p>
        {!!result.checks.length && <ul>{result.checks.map(check => <li key={check}>{check}</li>)}</ul>}
      </section>)}
    </div>
    {(height || weight || Object.values(measures).some(Boolean) || fit !== "regular" || lengthPreference !== "standard") &&
      <button type="button" className="secondary" onClick={reset}>Новый клиент</button>}
  </div>;
}
