"use client";
import { STRETCH_LABELS, MEASUREMENT_LABELS, columnKey, isTrousers, hugeTrousersProfile, type MeasurementKey, type SizeProfile } from "@/lib/size-profile";
import {ColorGridEditor} from "./ColorGridEditor";
import {spreadBounds} from "@/lib/color-size-grids";

export function SizeProfileEditor({ value, onChange, name }: { value: SizeProfile | null; onChange: (value: SizeProfile | null) => void; name: string }) {
  function change(patch: Partial<SizeProfile>) { if (value) onChange({ ...value, ...patch }); }
  function start(garment: "trousers" | "top") {
    const columns = garment === "trousers" ? ["Полупояс", "Длина", "Выход"] : ["Плечи", "Ширина по груди", "Длина"];
    onChange({ garment, fabric: "", stretch: "unknown", cut: "", columns, rows: [{ size: "", values: columns.map(() => 0) }] });
  }
  return <section className="size-profile-editor" aria-label="Числовая размерная таблица">
    <h3>Числовая размерная таблица и ткань</h3>
    <p className="size-hint">Отдельно для этой вещи. Все мерки в сантиметрах, размеры — по бирке. Таблица не меняет наличие, фотографии и примеры владельца.</p>
    {!value ? <div className="size-toolbar">
      <button type="button" className="secondary" onClick={() => onChange({ garment: "other", fabric: "", stretch: "unknown", cut: "", columns: ["Длина"], rows: [{ size: "", values: [0] }] })}>+ Добавить числовую таблицу</button>
      <button type="button" className="secondary" onClick={() => start("trousers")}>Сетка брюк / джинсов</button>
      <button type="button" className="secondary" onClick={() => start("top")}>Сетка верха</button>
      {name.trim() === "Брюки Огромнейшие" && <button type="button" className="secondary" onClick={() => onChange(hugeTrousersProfile())}>Заполнить сетку «Брюки Огромнейшие»</button>}
    </div> : <>
      <div className="size-fields">
        <label>Вид вещи<select aria-label="Вид вещи" disabled={!!value.colorGrids} value={value.garment} onChange={e => change({ garment: e.target.value as SizeProfile["garment"],
          ...(["trousers", "jeans"].includes(e.target.value) ? { columns: ["Полупояс", ...value.columns.slice(1)], ...(value.columnKeys ? { columnKeys: ["halfWaistCm", ...value.columnKeys.slice(1)] as MeasurementKey[] } : {}) } : {}) })}><option value="other">Другая вещь</option><option value="trousers">Брюки</option><option value="jeans">Джинсы</option><option value="top">Верх</option></select></label>
        <label>Ткань и состав<textarea rows={2} maxLength={1000} value={value.fabric} onChange={e => change({ fabric: e.target.value })} /></label>
        <label>Растяжимость<select aria-label="Растяжимость" value={value.stretch} onChange={e => change({ stretch: e.target.value as SizeProfile["stretch"] })}>{Object.entries(STRETCH_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Крой<input maxLength={500} value={value.cut} onChange={e => change({ cut: e.target.value })} placeholder="Например, широкий" /></label>
        <label>Описание маломерности для сетки<textarea rows={2} maxLength={1000} value={value.fitNote??''} onChange={e=>change({fitNote:e.target.value})}/></label>
      </div>
      {value.colorGrids ? <ColorGridEditor grids={value.colorGrids} onChange={grids=>change({colorGrids:grids,rows:grids.colors[0].rows.map(row=>({size:row.size,values:[row.shoulders,row.chest,row.length,row.sleeve].map(v=>spreadBounds(v)[0])}))})}/> : <>
      <div className="table-wrap size-example-table"><table><caption>Замеры вещи, см</caption><thead><tr><th>По бирке</th>{value.columns.map((column, index) => <th key={index}>
        <input aria-label={`Название мерки ${index + 1}`} maxLength={60} value={column} readOnly={isTrousers(value) && index === 0}
          onChange={e => change({ columns: value.columns.map((c, i) => i === index ? e.target.value : c) })} />
        <select aria-label={`Тип мерки ${index + 1}`} value={columnKey(value, index)} disabled={isTrousers(value) && index === 0} onChange={e => change({ columnKeys: value.columns.map((_, i) => i === index ? e.target.value as MeasurementKey : columnKey(value, i)) })}>{Object.entries(MEASUREMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        {value.columns.length > 1 && !(isTrousers(value) && index === 0) && <button type="button" className="secondary" aria-label={`Удалить мерку ${index + 1}`} onClick={() => change({ columns: value.columns.filter((_, i) => i !== index), ...(value.columnKeys ? { columnKeys: value.columnKeys.filter((_, i) => i !== index) } : {}), rows: value.rows.map(row => ({ ...row, values: row.values.filter((_, i) => i !== index) })) })}>Убрать мерку</button>}
      </th>)}<th>Удалить</th></tr></thead><tbody>{value.rows.map((row, index) => <tr key={index}>
        <td><input aria-label={`Бирка, строка сетки ${index + 1}`} maxLength={16} value={row.size} onChange={e => change({ rows: value.rows.map((r, i) => i === index ? { ...r, size: e.target.value } : r) })} /></td>
        {row.values.map((number, column) => <td key={column}><input aria-label={`${value.columns[column]}, строка сетки ${index + 1}`} type="number" min="0.1" max="400" step="0.1" required value={number || ""}
          onChange={e => change({ rows: value.rows.map((r, i) => i === index ? { ...r, values: r.values.map((v, c) => c === column ? Number(e.target.value) : v) } : r) })} /></td>)}
        <td><button type="button" className="danger" aria-label={`Удалить строку сетки ${index + 1}`} disabled={value.rows.length === 1} onClick={() => change({ rows: value.rows.filter((_, i) => i !== index) })}>×</button></td>
      </tr>)}</tbody></table></div>
      <div className="size-toolbar">
        <button type="button" className="secondary" disabled={value.rows.length >= 30} onClick={() => change({ rows: [...value.rows, { size: "", values: value.columns.map(() => 0) }] })}>+ Строка сетки</button>
        <button type="button" className="secondary" disabled={value.columns.length >= 6} onClick={() => change({ columns: [...value.columns, "Новая мерка"], ...(value.columnKeys ? { columnKeys: [...value.columnKeys, "other"] } : {}), rows: value.rows.map(row => ({ ...row, values: [...row.values, 0] })) })}>+ Мерка</button>
        <button type="button" className="secondary" onClick={() => { if (window.confirm("Удалить числовую таблицу и свойства ткани? Примеры владельца сохранятся.")) onChange(null); }}>Удалить числовую таблицу</button>
      </div>
      </>}
      <p className="size-hint">Подпись «маломерит» не прибавляет размер поверх расчёта по сетке. Сохраните вещь, затем проверьте подбор в карточке.</p>
    </>}
  </section>;
}
