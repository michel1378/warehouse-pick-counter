"use client";
import { useEffect, useState } from "react";
import { BODY_FITS, LENGTH_FITS, type FitPerson, type FittingInput, type FittingRecord } from "@/lib/size-fittings";
import { getSizeVariants, isPantsProduct } from "@/lib/detailed-sizes";
import type { DetailedSizeProduct } from "@/lib/detailed-size-types";

export type FittingDraft = Omit<FittingInput, "fit" | "length" | "sleeve"> & { fit: string; length: string; sleeve: string };
const bodyFields = [
  ["height", "Рост, см"], ["weight", "Вес, кг"], ["shoulders", "Ширина плеч, см"],
  ["chest_circumference", "Обхват груди, см"], ["waist_circumference", "Обхват талии, см"],
] as const;
function PersonEditor({ person, onSaved }: { person: FitPerson; onSaved: (p: FitPerson) => void }) {
  const [draft, setDraft] = useState(Object.fromEntries(bodyFields.map(([k]) => [k, person[k] === null ? "" : String(person[k])])));
  const [label, setLabel] = useState(person.label), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try {
      const values = Object.fromEntries(bodyFields.map(([k]) => [k, draft[k].trim() ? Number(draft[k].replace(",", ".")) : null]));
      const response = await fetch("/api/size-fit-people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: person.id, revision: person.revision, label, ...values }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Не удалось сохранить профиль.");
      onSaved(data.person); setMessage("Профиль сохранён.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Ошибка сохранения."); }
    finally { setBusy(false); }
  }
  return <div className="fit-person" onChange={e => e.stopPropagation()}>
    <h4>Человек {person.slot}</h4><small className="fit-person-id">ID: {person.id}</small>
    <label>Имя или обозначение<input maxLength={40} value={label} disabled={busy} onChange={e => setLabel(e.target.value)} /></label>
    <div className="fit-fields">{bodyFields.map(([key, title]) => <label key={key}>{title}<input type="number" step="0.5" min="0" value={draft[key]} disabled={busy} onChange={e => setDraft(old => ({ ...old, [key]: e.target.value }))} /></label>)}</div>
    <button type="button" className="secondary" disabled={busy} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить профиль"}</button>
    {message && <p role="status">{message}</p>}
  </div>;
}

export function FittingEditor({ product, sizes, rows, onChange, onPeople }: {
  product: DetailedSizeProduct; sizes: string[]; rows: FittingDraft[]; onChange: (rows: FittingDraft[]) => void; onPeople: (people: FitPerson[]) => void;
}) {
  const [people, setPeople] = useState<FitPerson[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const pants = isPantsProduct(product), colors = getSizeVariants(product);
  useEffect(() => { let active = true;
    fetch("/api/size-fit-people", { cache: "no-store" }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить профили.");
      if (active) { setPeople(data.people); onPeople(data.people); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Не удалось загрузить профили."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onPeople]);
  function update(index: number, patch: Partial<FittingDraft>) { onChange(rows.map((r, i) => i === index ? { ...r, ...patch } : r)); }
  return <section className="fit-editor" aria-label="Реальные примерки">
    <h3>Реальные примерки</h3>
    <details className="fit-profiles"><summary>Три человека: рост, вес и мерки тела</summary>
      <p className="size-hint">Профили общие для всех вещей и сохраняются отдельно. Плечи — ширина тела от плеча до плеча; грудь и талия — полный обхват тела.</p>
      {loading ? <p role="status">Загружаем профили…</p> : <div className="fit-people">{people.map(p => <PersonEditor key={p.id} person={p} onSaved={saved => {
        const next = people.map(x => x.id === saved.id ? saved : x); setPeople(next); onPeople(next);
      }} />)}</div>}
    </details>
    {error && <p className="error" role="alert">{error} Закройте и откройте карточку для повторной загрузки.</p>}
    {!rows.length && <p className="size-hint">Пока нет примерок. Одного человека можно записать несколько раз — в разных размерах и цветах.</p>}
    <div className="fit-observations">{rows.map((row, index) => {
      const old: FittingRecord | undefined = product.fittings?.find(r => r.id === row.id && r.personId === row.personId);
      return <fieldset className="fit-observation" key={row.id}><legend>Примерка {index + 1}</legend>
        <div className="fit-fields">
          <label>Человек<select value={row.personId} required onChange={e => update(index, { personId: e.target.value, refreshMeasurements: true })}><option value="">Выберите</option>{people.map(p => <option key={p.id} value={p.id}>{p.slot}. {p.label}{p.height === null ? " — сначала заполните профиль" : ` · ${p.height}/${p.weight}`}</option>)}</select></label>
          <label>Размер на бирке<select value={row.size} required onChange={e => update(index, { size: e.target.value })}><option value="">Выберите</option>{row.size && !sizes.includes(row.size) && <option value={row.size}>{row.size} — нет в ряду</option>}{sizes.map(s => <option key={s}>{s}</option>)}</select></label>
          {!(colors.length === 1 && colors[0].id === "all") && <label>Цвет<select value={row.colorId} required onChange={e => update(index, { colorId: e.target.value })}>{colors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <label>Как сидит по объёму<select value={row.fit} required onChange={e => update(index, { fit: e.target.value })}><option value="">Выберите</option>{Object.entries(BODY_FITS).map(([v, title]) => <option key={v} value={v}>{title}</option>)}</select></label>
          <label>Длина вещи<select value={row.length} required onChange={e => update(index, { length: e.target.value })}><option value="">Выберите</option>{Object.entries(LENGTH_FITS).map(([v, title]) => <option key={v} value={v}>{title}</option>)}</select></label>
          {!pants && <label>Рукав<select value={row.sleeve} required onChange={e => update(index, { sleeve: e.target.value })}><option value="">Выберите</option>{Object.entries(LENGTH_FITS).map(([v, title]) => <option key={v} value={v}>{title}</option>)}</select></label>}
        </div>
        <label>Заметка<input maxLength={500} value={row.notes} onChange={e => update(index, { notes: e.target.value })} placeholder="Например, тесно в груди или коротки рукава" /></label>
        {old && !row.refreshMeasurements && <p className="size-hint">Мерки на момент примерки: {old.body.height} см / {old.body.weight} кг · {new Date(old.measuredAt).toLocaleDateString("ru-RU")}. <button type="button" className="secondary" onClick={() => update(index, { refreshMeasurements: true })}>Взять текущие мерки человека</button></p>}
        {row.refreshMeasurements && <p className="size-hint">При сохранении будут записаны текущие сохранённые мерки профиля.</p>}
        <button type="button" className="danger" onClick={() => onChange(rows.filter((_, i) => i !== index))}>Убрать примерку {index + 1}</button>
      </fieldset>;
    })}</div>
    <button type="button" className="secondary" disabled={loading || !!error || !people.length || !sizes.length || rows.length >= 200} onClick={() => onChange([...rows, { id: crypto.randomUUID(), personId: "", size: "", colorId: colors[0].id, fit: "", length: "", sleeve: pants ? "na" : "", notes: "" }])}>+ Добавить примерку</button>
    <p className="size-hint">Примерки сохраняются кнопкой «Сохранить вещь». Обновление профиля не изменяет мерки в прошлых примерках.</p>
  </section>;
}
