"use client";
import { useMemo, useState } from "react";
import { FITS, FIT_LABELS, recommendSize, type Fit, type SizeProduct } from "@/lib/sizes";

export function SizePicker({ product }: { product: SizeProduct }) {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [fit, setFit] = useState<Fit>("regular");
  const result = useMemo(() => height && weight ? recommendSize(product, Number(height), Number(weight), fit) : null, [height, weight, fit, product]);
  return <div className="size-picker" id={`picker-${product.id}`}>
    <div className="size-measurements">
      <label>Рост, см<input type="number" inputMode="decimal" min="100" max="230" step="0.5" value={height} placeholder="Например, 175" onChange={e => setHeight(e.target.value)} /></label>
      <label>Вес, кг<input type="number" inputMode="decimal" min="25" max="250" step="0.5" value={weight} placeholder="Например, 75" onChange={e => setWeight(e.target.value)} /></label>
    </div>
    <fieldset className="size-fit"><legend>Пожелание клиента</legend>{FITS.map(f => <label key={f} className={fit === f ? "selected" : ""}>
      <input type="radio" name={`fit-${product.id}`} value={f} checked={fit === f} onChange={() => setFit(f)} />{FIT_LABELS[f]}
    </label>)}</fieldset>
    <div aria-live="polite" aria-atomic="true" className={`size-answer ${result?.size ? "ready" : ""}`}>
      {!result ? <p>Введите рост и вес — размер появится автоматически.</p> : <>
        {result.size ? <><span>Положить размер по бирке</span><strong>{result.size}</strong></> : <b>Нужно уточнение</b>}
        <p>{result.message}</p>
      </>}
    </div>
    {!!result?.evidence.length && <details className="size-evidence"><summary>На каких примерах основан подбор</summary>
      <ul>{result.evidence.map((e, i) => <li key={i}>{e.height} см · {e.weight} кг · {FIT_LABELS[e.fit]} → <b>{e.size}</b></li>)}</ul>
    </details>}
    {(height || weight || fit !== "regular") && <button type="button" className="secondary" onClick={() => { setHeight(""); setWeight(""); setFit("regular"); }}>Новый клиент</button>}
  </div>;
}
