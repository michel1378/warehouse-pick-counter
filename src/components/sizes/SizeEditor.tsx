"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FITS, FIT_LABELS, normalizeSize, parseExampleRows, type Fit, type SizeExample, type SizeProduct } from "@/lib/sizes";
import { SizePicker } from "./SizePicker";

type DraftRow = { height: string; weight: string; fit: Fit; size: string };
const emptyRow = (): DraftRow => ({ height: "", weight: "", fit: "regular", size: "" });
async function preparePhoto(file: File): Promise<string> {
  if (!/image\/(jpeg|png|webp)/.test(file.type) || file.size > 15 * 1024 * 1024) throw new Error("Выберите JPEG, PNG или WebP до 15 МБ.");
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error("Не удалось открыть фотографию.");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Браузер не смог обработать фото.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.68, 0.5, 0.35]) {
      const result = canvas.toDataURL("image/jpeg", quality);
      if (result.length <= 400000) return result;
    }
    throw new Error("Фото слишком сложное для сжатия. Выберите уменьшенную копию.");
  } finally { bitmap.close(); }
}
export function SizeEditor({ product, onSaved, onClose }: {
  product: SizeProduct | null; onSaved: (product: SizeProduct) => void; onClose: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [note, setNote] = useState(product?.note ?? "Не маломерит");
  const [sizeText, setSizeText] = useState(product?.sizes.join(", ") ?? "");
  const [active, setActive] = useState(product?.active ?? true);
  const [rows, setRows] = useState<DraftRow[]>(product?.examples.length ? product.examples.map(e => ({ ...e, height: String(e.height), weight: String(e.weight) })) : [emptyRow()]);
  const [photo, setPhoto] = useState<string>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [bulk, setBulk] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const latestPhoto = useRef(0);
  const sizes = sizeText.split(/[,;\s]+/).filter(Boolean).map(normalizeSize);
  useEffect(() => { formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function close() { if (!dirty || window.confirm("Закрыть без сохранения изменений?")) onClose(); }
  function updateRow(index: number, patch: Partial<DraftRow>) { setDirty(true); setRows(old => old.map((r, i) => i === index ? { ...r, ...patch } : r)); }
  function examples(): SizeExample[] {
    const filled = rows.filter(r => r.height || r.weight || r.size);
    return filled.map((r, i) => {
      const height = Number(r.height.replace(",", ".")), weight = Number(r.weight.replace(",", "."));
      if (!r.height || !r.weight || !r.size || !Number.isFinite(height) || !Number.isFinite(weight) || height < 100 || height > 230 || weight < 25 || weight > 250) throw new Error(`Заполните корректно строку ${i + 1}: рост 100–230, вес 25–250 и размер.`);
      if (!sizes.includes(r.size)) throw new Error(`Строка ${i + 1}: размера ${r.size} нет в размерном ряду.`);
      return { height, weight, fit: r.fit, size: r.size };
    });
  }
  function pasteRows() {
    try {
      const imported = parseExampleRows(bulk);
      if (!imported.length) throw new Error("В таблице нет строк с рекомендациями.");
      const missing = imported.filter(e => !sizes.includes(e.size));
      if (missing.length) throw new Error(`Сначала добавьте в размерный ряд: ${[...new Set(missing.map(e => e.size))].join(", ")}.`);
      const filled = rows.filter(r => r.height || r.weight || r.size);
      if (filled.length + imported.length > 200) throw new Error("Максимум 200 примеров на вещь.");
      setRows([...filled, ...imported.map(e => ({ ...e, height: String(e.height), weight: String(e.weight) }))]);
      setBulk(""); setError(""); setDirty(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось вставить таблицу."); }
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      const input = { ...(product ? { id: product.id, revision: product.revision } : {}), name, note, sizes, examples: examples(), active, ...(photo ? { photo } : {}) };
      if (!product && !photo) throw new Error("Добавьте фотографию вещи.");
      setSaving(true);
      const response = await fetch("/api/sizes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось сохранить.");
      setDirty(false); onSaved(data.product);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить. Проверьте подключение."); }
    finally { setSaving(false); }
  }
  let preview: SizeProduct | null = null;
  try { preview = { id: "preview", name, note, sizes, examples: examples(), active, revision: 1, updated_at: "" }; } catch { /* Incomplete rows are shown in the editor, not interpreted as examples. */ }
  return <form className="card size-editor" ref={formRef} onSubmit={save} onChange={() => setDirty(true)}>
    <div className="size-toolbar"><h2>{product ? "Редактировать вещь" : "Новая вещь"}</h2><button type="button" className="secondary" onClick={close} disabled={saving}>Закрыть</button></div>
    <fieldset disabled={saving} className="size-editor-fields">
      <div className="size-editor-top"><div>
        {(photo || product) ? <img className="size-editor-photo" src={photo ?? `/api/sizes/${product!.id}/photo?v=${product!.revision}`} alt={name || "Фотография вещи"} /> : <div className="size-photo-placeholder">Фотография вещи</div>}
        <label>Загрузить фото<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return;
          const request = ++latestPhoto.current; setPhotoBusy(true); setError("");
          try { const result = await preparePhoto(file); if (request === latestPhoto.current) { setPhoto(result); setDirty(true); } }
          catch (err) { if (request === latestPhoto.current) setError(err instanceof Error ? err.message : "Не удалось открыть фото."); }
          finally { if (request === latestPhoto.current) setPhotoBusy(false); }
        }} /></label><p className="size-hint">{photoBusy ? "Обрабатываем фото…" : "JPEG, PNG или WebP. Фото уменьшается автоматически."}</p>
      </div><div className="size-fields">
        <label>Название вещи<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Лонгслив Alpaca" /></label>
        <label>Подпись под названием<input maxLength={200} list="size-notes" value={note} onChange={e => setNote(e.target.value)} /></label>
        <datalist id="size-notes"><option value="Не маломерит" /><option value="Маломерит на размер" /><option value="Маломерит на два размера" /></datalist>
        <label>Какие размеры привозим — от меньшего к большему<input required value={sizeText} onChange={e => setSizeText(e.target.value)} placeholder="S, M, L, XL, 2XL, 3XL" /></label>
        <p className="size-hint">Именно маркировка на бирке. Подпись о маломерности не прибавляет размер повторно.</p>
        <label className="size-checkbox"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Показывать сотрудникам</label>
      </div></div>
      <h3>Ваши рекомендации</h3><p className="size-hint">Начните с 10–20 разных примеров. Указывайте желаемую посадку и размер, который вы действительно положили бы. Для каждой посадки нужны свои примеры.</p>
      <div className="table-wrap size-example-table"><table><thead><tr><th>Рост, см</th><th>Вес, кг</th><th>Посадка</th><th>По бирке</th><th><span className="visually-hidden">Удаление</span></th></tr></thead><tbody>
        {rows.map((row, i) => <tr key={i}>
          <td><input aria-label={`Рост, строка ${i + 1}`} type="number" min="100" max="230" step="0.5" value={row.height} onChange={e => updateRow(i, { height: e.target.value })} /></td>
          <td><input aria-label={`Вес, строка ${i + 1}`} type="number" min="25" max="250" step="0.5" value={row.weight} onChange={e => updateRow(i, { weight: e.target.value })} /></td>
          <td><select aria-label={`Посадка, строка ${i + 1}`} value={row.fit} onChange={e => updateRow(i, { fit: e.target.value as Fit })}>{FITS.map(f => <option key={f} value={f}>{FIT_LABELS[f]}</option>)}</select></td>
          <td><select aria-label={`Размер на бирке, строка ${i + 1}`} value={row.size} onChange={e => updateRow(i, { size: e.target.value })}><option value="">Выбрать</option>{row.size && !sizes.includes(row.size) && <option value={row.size}>{row.size} — отсутствует</option>}{[...new Set(sizes)].map(s => <option key={s}>{s}</option>)}</select></td>
          <td><button type="button" className="danger" aria-label={`Удалить строку ${i + 1}`} onClick={() => { setRows(old => old.filter((_, j) => j !== i)); setDirty(true); }}>×</button></td>
        </tr>)}
      </tbody></table></div>
      <button type="button" className="secondary" disabled={rows.length >= 200} onClick={() => { setRows(old => [...old, emptyRow()]); setDirty(true); }}>+ Добавить пример</button>
      <details className="size-bulk"><summary>Вставить несколько строк из Excel или текста</summary>
        <p className="size-hint">Четыре колонки: рост, вес, посадка, размер. Из Excel — скопируйте ячейки. В тексте разделяйте значения точкой с запятой. Строки добавляются к таблице.</p>
        <textarea aria-label="Строки рекомендаций" rows={5} value={bulk} onChange={e => setBulk(e.target.value)} placeholder="Рост;Вес;Посадка;Размер" />
        <button type="button" className="secondary" onClick={pasteRows}>Добавить строки в таблицу</button>
      </details>
      <details className="size-test"><summary>Проверить подбор перед сохранением</summary>
        {preview ? <SizePicker product={preview} /> : <p>Сначала заполните строки таблицы корректно.</p>}
      </details>
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="size-save"><button className="primary" disabled={saving || photoBusy}>{saving ? "Сохраняем…" : "Сохранить вещь"}</button><span className="size-hint">{dirty ? "Есть несохранённые изменения" : ""}</span></div>
  </form>;
}
