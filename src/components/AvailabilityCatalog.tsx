"use client";
import { useEffect, useRef, useState } from "react";
import type { AvailabilityProduct, AvailabilityDetails } from "@/lib/availability";
import { preparePhoto } from "@/lib/prepare-photo";

function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <><button className="stock-image" type="button" aria-label={`Увеличить: ${alt}`} onClick={() => dialog.current?.showModal()}><img src={src} alt={alt} loading="lazy" /></button>
    <dialog ref={dialog} className="stock-zoom" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}><form method="dialog"><button autoFocus className="secondary">Закрыть</button></form><p>{alt} · прокрутите для просмотра в полном размере</p><div><img src={src} alt={alt} /></div></dialog></>;
}

function AvailabilityEditor({ product, onSaved, onClose }: { product: AvailabilityProduct; onSaved: (product: AvailabilityProduct) => void; onClose: () => void }) {
  const [details, setDetails] = useState<AvailabilityDetails>(product.stock_details);
  const [chart, setChart] = useState<string | null | undefined>();
  const [models, setModels] = useState<string[] | undefined>();
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { const handler = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  async function upload(files: FileList | null, kind: "chart" | "model") {
    if (!files?.length) return;
    setBusy(true); setError("");
    try {
      if (files.length > (kind === "chart" ? 1 : 6)) throw new Error("Выберите одну размерную сетку или до 6 фото на модели.");
      const images = [];
      for (const file of Array.from(files)) images.push(await preparePhoto(file));
      if (kind === "chart") setChart(images[0]); else setModels(images);
      setDirty(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось обработать фото."); }
    finally { setBusy(false); }
  }
  return <form className="stock-editor" onSubmit={async e => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: product.id, revision: product.revision, stock_details: details, ...(chart !== undefined ? { stock_chart: chart } : {}), ...(models !== undefined ? { stock_models: models } : {}) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Не удалось сохранить.");
      setDirty(false); onSaved(body.product);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить."); }
    finally { setSaving(false); }
  }} onChange={() => setDirty(true)}>
    <h3>Редактировать наличие</h3><p className="size-hint">Название, размеры и галерея берутся из раздела «Размеры». Здесь заполняются дополнительные данные.</p>
    <fieldset disabled={busy || saving}>
      {([ ["composition", "Состав"], ["material", "Описание материала"], ["stretch", "Растяжимость"] ] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={3} maxLength={key === "material" ? 4000 : 2000} value={details[key]} onChange={e => setDetails({ ...details, [key]: e.target.value })} /></label>)}
      <h4>Доступные размеры по цветам</h4>
      <p className="size-hint">Снимите «Наличие не указано», чтобы выбрать размеры. Если ни один размер не выбран — доступных размеров нет.</p>
      {details.colors.map((color, i) => {
        const change = (patch: Partial<typeof color>) => setDetails({ ...details, colors: details.colors.map((c, j) => j === i ? { ...c, ...patch } : c) });
        return <div className="stock-color-editor" key={i}><label>Название цвета<input required maxLength={80} value={color.name} onChange={e => change({ name: e.target.value })} /></label>
          <label className="stock-check"><input type="checkbox" checked={color.sizes === null} onChange={e => change({ sizes: e.target.checked ? null : [] })} />Наличие не указано</label>
          <div className="stock-size-options">{[...new Set([...product.sizes, ...(color.sizes ?? [])])].map(size => <label className="stock-check" key={size}><input type="checkbox" disabled={color.sizes === null} checked={color.sizes?.includes(size) ?? false} onChange={e => change({ sizes: e.target.checked ? [...(color.sizes ?? []), size] : color.sizes?.filter(s => s !== size) ?? [] })} />{size}{!product.sizes.includes(size) ? " (удалён из каталога — снимите выбор)" : ""}</label>)}</div>
          <button type="button" className="secondary" onClick={() => { setDirty(true); setDetails({ ...details, colors: details.colors.filter((_, j) => i !== j) }); }}>Удалить цвет</button></div>;
      })}
      <button type="button" className="secondary" disabled={details.colors.length >= 50} onClick={() => { setDirty(true); setDetails({ ...details, colors: [...details.colors, { name: "", sizes: null }] }); }}>Добавить цвет</button>
      <label>Размерная сетка — отдельная картинка<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { void upload(e.target.files, "chart"); e.target.value = ""; }} /></label>
      {chart ? <img className="stock-preview" src={chart} alt="Новая размерная сетка" /> : <p>{chart === null ? "Сетка будет удалена" : product.stock_has_chart ? "Существующая сетка сохранится без новой загрузки" : "Не указано"}</p>}
      <button type="button" className="secondary" onClick={() => { setChart(null); setDirty(true); }}>Удалить размерную сетку</button>
      <label>Отдельные фото на модели (до 6)<input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => { void upload(e.target.files, "model"); e.target.value = ""; }} /></label>
      <p className="size-hint">Новая загрузка заменит только фото на модели. Галерея товара сохранится.</p>
      {models ? <div className="stock-gallery">{models.map((src, i) => <img className="stock-preview" src={src} key={i} alt={`Новое фото на модели ${i + 1}`} />)}</div> : <p>Сохранено фото на модели: {product.stock_model_count}</p>}
      <button type="button" className="secondary" onClick={() => { setModels([]); setDirty(true); }}>Удалить фото на модели</button>
    </fieldset>
    {busy && <p role="status">Обрабатываем фотографии…</p>}{error && <p className="error" role="alert">{error}</p>}
    <div className="stock-actions"><button className="primary" disabled={busy || saving}>{saving ? "Сохраняем…" : "Сохранить"}</button><button type="button" className="secondary" disabled={busy || saving} onClick={() => { if (!dirty || window.confirm("Закрыть редактор без сохранения изменений?")) onClose(); }}>Отмена</button>{dirty && <span>Есть несохранённые изменения</span>}</div>
  </form>;
}

export function AvailabilityCatalog({ admin = false }: { admin?: boolean }) {
  const [products, setProducts] = useState<AvailabilityProduct[]>([]), [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    fetch("/api/availability", { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Не удалось загрузить наличие.");
      setProducts(body.products);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const visible = products.filter(p => p.name.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  return <><label className="stock-search">Поиск по названию<input type="search" disabled={editor !== null} value={query} onChange={e => setQuery(e.target.value)} placeholder="Название товара" /></label>
    {notice && <p role="status">{notice}</p>}{loading && <p role="status">Загружаем товары…</p>}
    {error && <div role="alert"><p className="error">{error}</p><button className="secondary" onClick={() => setAttempt(a => a + 1)}>Повторить загрузку</button></div>}
    {!loading && !error && !visible.length && <p>{products.length ? "По этому названию ничего не найдено." : "В каталоге пока нет товаров."}</p>}
    {!error && <div className="stock-grid">{visible.map(product => {
      const photo = (index: number) => `/api/sizes/${product.id}/photo?index=${index}&v=${product.revision}`;
      const extra = (kind: "chart" | "model", index = 0) => `/api/availability/${product.id}/photo?kind=${kind}&index=${index}&v=${product.revision}`;
      return <details className="card stock-card" key={product.id}><summary><img src={photo(0)} alt={product.name} loading="lazy" width={600} height={600} /><span><strong>{product.name}</strong>{!product.active && <small>Скрыт от сотрудников</small>}<small>Фото, описание и наличие · раскрыть</small></span></summary>
        <div className="stock-content"><h3>Галерея товара</h3><div className="stock-gallery">{Array.from({ length: product.photo_count || 1 }, (_, i) => <ZoomImage key={i} src={photo(i)} alt={`${product.name}, фото ${i + 1}`} />)}</div>
          <h3>Размерная сетка</h3>{product.stock_has_chart ? <><p className="size-hint">Нажмите, чтобы увеличить</p><ZoomImage src={extra("chart")} alt={`${product.name}, размерная сетка`} /></> : <p>Не указано</p>}
          <h3>Фото на модели</h3>{product.stock_model_count ? <div className="stock-gallery">{Array.from({ length: product.stock_model_count }, (_, i) => <ZoomImage key={i} src={extra("model", i)} alt={`${product.name}, на модели ${i + 1}`} />)}</div> : <p>Не указано</p>}
          <dl className="stock-description">{([["composition", "Состав"], ["material", "Материал"], ["stretch", "Растяжимость"]] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{product.stock_details[key] || "Не указано"}</dd></div>)}</dl>
          <h3>Доступные размеры по цветам</h3>{product.stock_details.colors.length ? <ul className="stock-colors">{product.stock_details.colors.map(color => <li key={color.name}><strong>{color.name}</strong><span>{color.sizes === null ? "Не указано" : color.sizes.length ? color.sizes.join(" · ") : "Нет доступных размеров"}</span></li>)}</ul> : <p>Не указано</p>}
          {admin && (editor === product.id ? <AvailabilityEditor product={product} onClose={() => setEditor(null)} onSaved={saved => { setProducts(old => old.map(p => p.id === saved.id ? saved : p)); setEditor(null); setNotice(`«${saved.name}»: наличие сохранено.`); }} /> : <button className="secondary" type="button" disabled={editor !== null} onClick={() => { setNotice(""); setEditor(product.id); }}>Редактировать наличие</button>)}
        </div></details>;
    })}</div>}
  </>;
}
