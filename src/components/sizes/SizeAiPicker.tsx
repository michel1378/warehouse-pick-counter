"use client";
import { useEffect, useRef, useState } from "react";
import { FITS, FIT_LABELS, type Fit } from "@/lib/sizes";
import type { CatalogSizeProduct as SizeProduct } from "@/lib/catalog-visibility";
import { STRETCH_LABELS, sizeLengthAssessment, isTrousers, type SizeComparison, type SizeAiResult } from "@/lib/size-profile";
import {ColorGridsTable} from "./ColorGridsTable";

export function SizeAiPicker({ product }: { product: SizeProduct }) {
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [halfWaist, setHalfWaist] = useState("");
  const [shoulders, setShoulders] = useState("");
  const [chestWidth, setChestWidth] = useState("");
  const [beltFit, setBeltFit] = useState<"unknown" | "snug" | "roomy">("unknown");
  const [comparison, setComparison] = useState<SizeComparison | null>(null);
  const [fit, setFit] = useState<Fit>("regular");
  const [result, setResult] = useState<SizeAiResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const profile = product.size_profile!;
  useEffect(() => () => { generation.current++; pending.current?.abort(); }, []);
  function invalidate() {
    generation.current++; pending.current?.abort(); setBusy(false); setResult(null); setComparison(null); setError("");
  }
  async function recommend() {
    invalidate();
    const h = Number(height), w = Number(weight), waist = Number(halfWaist);
    if (!height || !weight || h < 100 || h > 230 || w < 25 || w > 250 || (halfWaist && (waist < 20 || waist > 100))
      || (shoulders && (Number(shoulders) < 15 || Number(shoulders) > 100)) || (chestWidth && (Number(chestWidth) < 20 || Number(chestWidth) > 150))) {
      setError("Проверьте рост, вес и необязательные мерки любимой вещи."); return;
    }
    const request = ++generation.current;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/sizes/recommend", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ productId: product.id, revision: product.revision, height: h, weight: w, fit,
          ...(isTrousers(profile) && halfWaist ? { halfWaistCm: waist, beltFit } : {}),
          ...(!isTrousers(profile) && shoulders ? { shouldersCm: Number(shoulders) } : {}),
          ...(!isTrousers(profile) && chestWidth ? { chestWidthCm: Number(chestWidth) } : {}) }),
      });
      const data = await response.json();
      if (request !== generation.current) return;
      if (!response.ok) throw new Error(data.error ?? "Не удалось подобрать размер.");
      setResult(data.result);
      setComparison(data.comparison ?? null);
    } catch (e) {
      if (request === generation.current) setError(e instanceof Error ? e.message : "Проверьте подключение.");
    } finally { if (request === generation.current) setBusy(false); }
  }
  return <div className="size-picker" id={`picker-${product.id}`}>
    <p className="size-hint">{profile.cut || "Крой не указан"} · {STRETCH_LABELS[profile.stretch]}. {profile.fabric}</p>
    {profile.fitNote && <p className="size-hint">{profile.fitNote}</p>}
    <div className="size-measurements">
      <label>Рост, см<input type="number" inputMode="decimal" min="100" max="230" step="0.5" value={height} onChange={e => { invalidate(); setHeight(e.target.value); }} /></label>
      <label>Вес, кг<input type="number" inputMode="decimal" min="25" max="250" step="0.5" value={weight} onChange={e => { invalidate(); setWeight(e.target.value); }} /></label>
    </div>
    {isTrousers(profile) ? <><label className="size-waist">Полупояс подходящих брюк, см (необязательно)
      <input type="number" inputMode="decimal" min="20" max="100" step="0.5" value={halfWaist} onChange={e => { invalidate(); setHalfWaist(e.target.value); }} />
      <span className="size-hint">Измерьте пояс от края до края, разложив подходящие брюки ровно, без растяжения. Это не обхват талии.</span>
    </label>
    {halfWaist && <fieldset className="size-fit"><legend>Как сидит пояс любимых брюк?</legend>{([['unknown', 'Не знаю'], ['snug', 'Впритык'], ['roomy', 'С запасом']] as const).map(([value, label]) => <label key={value} className={beltFit === value ? "selected" : ""}>
      <input type="radio" name={`belt-${product.id}`} checked={beltFit === value} onChange={() => { invalidate(); setBeltFit(value); }} />{label}
    </label>)}</fieldset>}</> : <>
      <div className="size-measurements">
        <label>Плечи любимой вещи, см (необязательно)<input type="number" inputMode="decimal" min="15" max="100" step="0.5" value={shoulders} onChange={e => { invalidate(); setShoulders(e.target.value); }} /></label>
        <label>Ширина по груди любимой вещи, см (необязательно)<input type="number" inputMode="decimal" min="20" max="150" step="0.5" value={chestWidth} onChange={e => { invalidate(); setChestWidth(e.target.value); }} /></label>
      </div><p className="size-hint">Разложите вещь ровно. Плечи — между плечевыми швами, грудь — от подмышки до подмышки. Это ширина вещи, не обхват тела.</p>
    </>}
    <fieldset className="size-fit"><legend>Пожелание клиента</legend>{FITS.map(f => <label key={f} className={fit === f ? "selected" : ""}>
      <input type="radio" name={`fit-${product.id}`} checked={fit === f} onChange={() => { invalidate(); setFit(f); }} />{FIT_LABELS[f]}
    </label>)}</fieldset>
    <button type="button" className="primary" disabled={busy || !height || !weight} onClick={() => void recommend()}>{busy ? "Подбираем…" : "Подобрать"}</button>
    <div aria-live="polite" aria-atomic="true" aria-busy={busy} className={`size-answer ${result?.size ? "preliminary" : ""}`}>
      {busy ? <p>Сравниваем параметры с таблицей выбранной вещи…</p> : result ? <>
        {result.summary ? <><span className="size-answer-label">По цветам, предварительно</span><strong className="size-final-choice">{result.summary}</strong>
          {result.colorResults?.map(color=><div key={color.key}><p><b>{color.name}</b>: {color.explanation}</p><p className="size-hint">{color.lengthText}</p></div>)}
          {[...new Set(result.colorResults?.map(color=>color.clarification).filter(Boolean))].map(question=><p key={question}>{question}</p>)}
        </> : <>
          {result.size ? <><span className="size-answer-label">Предварительная рекомендация по бирке</span><strong className="size-final-choice">Положить: {result.size}</strong></> : <b>Нужно уточнение</b>}
          <p>{result.explanation}</p>{result.clarification && <p>{result.clarification}</p>}
        </>}
      </> : <p>Подбор запускается по кнопке. По росту и весу нельзя гарантировать точную посадку.</p>}
    </div>
    {result && !result.colorResults && <div className="size-length-assessment"><b>Длина отдельно</b><p>{sizeLengthAssessment(profile, result.size)}</p></div>}
    {!!comparison?.rows.length && <details className="size-evidence"><summary>Сравнение мерок с сеткой</summary><ul>{comparison.rows.map(row => <li key={row.size}><b>{row.size}</b>: {row.measurements.map(m => `${m.label}: ${m.itemCm} см (${m.deltaCm > 0 ? "+" : ""}${m.deltaCm} см к любимой вещи)`).join("; ")}</li>)}</ul><p className="size-hint">Минус — уже, плюс — шире. При одинаковой разнице нет единственного ближайшего размера.</p></details>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="size-hint">Рекомендация предварительная. Наличие размера проверяйте в разделе «Наличие»: строка в таблице его не подтверждает.</p>
    <details className="size-evidence"><summary>{profile.colorGrids?'Размерные таблицы по цветам, см':'Размерная таблица, см'}</summary>{profile.colorGrids ? <ColorGridsTable grids={profile.colorGrids}/> : <div className="table-wrap"><table>
      <thead><tr><th>По бирке</th>{profile.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>{profile.rows.map(row => <tr key={row.size}><th>{row.size}</th>{row.values.map((value, i) => <td key={i}>{value}</td>)}</tr>)}</tbody>
    </table></div>}</details>
    <details className="size-evidence"><summary>Сохранённые примеры владельца ({product.examples.length})</summary>
      <ul>{product.examples.map((row, i) => <li key={i}>{row.height} см · {row.weight} кг · {FIT_LABELS[row.fit]} → <b>{row.size}</b></li>)}</ul>
      <p className="size-hint">Старые рекомендации учитываются как ориентир, а не как подтверждённые примерки. Прямые мерки имеют приоритет.</p>
    </details>
    <button type="button" className="secondary" onClick={() => { invalidate(); setHeight(""); setWeight(""); setHalfWaist(""); setShoulders(""); setChestWidth(""); setBeltFit("unknown"); setFit("regular"); }}>Новый клиент</button>
  </div>;
}
