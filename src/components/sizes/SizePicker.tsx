"use client";
import { useMemo, useState } from "react";
import { FITS, FIT_LABELS, recommendSize, evaluateSizeExamples, type Fit, type SizeProduct } from "@/lib/sizes";

export function SizePicker({ product }: { product: SizeProduct }) {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [fit, setFit] = useState<Fit>("regular");
  const result = useMemo(() => height && weight ? recommendSize(product, Number(height), Number(weight), fit) : null, [height, weight, fit, product]);
  const validation = useMemo(() => evaluateSizeExamples(product), [product]);
  const warningLabels = {
    conflict: "Неоднозначность: для одинаковых параметров записаны разные размеры",
    boundary: "Неоднозначность: рядом граница размеров",
    sparse: "Мало близких примеров",
    outside: "Параметры за диапазоном примеров",
  };
  return <div className="size-picker" id={`picker-${product.id}`}>
    <div className="size-measurements">
      <label>Рост, см<input type="number" inputMode="decimal" min="100" max="230" step="0.5" value={height} placeholder="Например, 175" onChange={e => setHeight(e.target.value)} /></label>
      <label>Вес, кг<input type="number" inputMode="decimal" min="25" max="250" step="0.5" value={weight} placeholder="Например, 75" onChange={e => setWeight(e.target.value)} /></label>
    </div>
    <fieldset className="size-fit"><legend>Пожелание клиента</legend>{FITS.map(f => <label key={f} className={fit === f ? "selected" : ""}>
      <input type="radio" name={`fit-${product.id}`} value={f} checked={fit === f} onChange={() => setFit(f)} />{FIT_LABELS[f]}
    </label>)}</fieldset>
    <div aria-live="polite" aria-atomic="true" className={`size-answer ${result?.size ? result.kind === "exact" ? "ready" : `preliminary ${result.kind}` : ""}`}>
      {!result ? <p>Введите рост и вес — размер появится автоматически.</p> : <>
        {result.size ? <><span className="size-answer-label">{result.kind === "exact" ? "Размер по примеру владельца" : "Предварительно"}</span><strong>{result.size}</strong></> : <b>Нужно уточнение</b>}
        {result.size && result.kind !== "exact" ? <>
          <p>Рекомендация по примерам владельца. Размер не подтверждён.</p>
          {!!result.warnings.length && <p>{result.warnings.map(w => warningLabels[w]).join("; ")}. Уточните у владельца.</p>}
        </> : <p>{result.message}</p>}
      </>}
    </div>
    {!!result?.evidence.length && <details className="size-evidence"><summary>Ближайшие примеры выбранной посадки</summary>
      <ul>{result.evidence.map((e, i) => <li key={i}>{e.height} см · {e.weight} кг · {FIT_LABELS[e.fit]} → <b>{e.size}</b></li>)}</ul>
    </details>}
    {!!validation.length && <details className="size-evidence"><summary>Проверка на отложенных примерах</summary><p>Проверяемая строка и все повторы её параметров и посадки исключены из обучения. Метод фиксирован. Совпадений: {validation.filter(v=>v.result.size===v.example.size).length} из {validation.length}; ошибок на один размер: {validation.filter(v=>v.result.size && Math.abs(product.sizes.indexOf(v.result.size)-product.sizes.indexOf(v.example.size))===1).length}; на два размера или больше: {validation.filter(v=>v.result.size && Math.abs(product.sizes.indexOf(v.result.size)-product.sizes.indexOf(v.example.size))>=2).length}; без прогноза: {validation.filter(v=>!v.result.size).length}. Каталог использован при выборе подхода: это проверка разработки, а не независимая оценка точности на новых клиентах.</p><ul>{validation.map((v,i)=><li key={i}>{v.example.height} см · {v.example.weight} кг · {FIT_LABELS[v.example.fit]}: владелец {v.example.size}, прогноз {v.result.size ?? "нет"}{v.result.kind === "uncertain" && v.result.size ? " (с предупреждением)" : ""}</li>)}</ul></details>}
    {(height || weight || fit !== "regular") && <button type="button" className="secondary" onClick={() => { setHeight(""); setWeight(""); setFit("regular"); }}>Новый клиент</button>}
  </div>;
}
