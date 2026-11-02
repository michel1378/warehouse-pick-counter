"use client";
import { useEffect, useRef, useState } from "react";
import type { AvailabilityProduct, AvailabilityDetails, AvailabilityImage } from "@/lib/availability";
import { preparePhoto } from "@/lib/prepare-photo";
import { normalizeSize } from "@/lib/sizes";

function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <><button className="stock-image" type="button" aria-label={`Увеличить: ${alt}`} onClick={() => dialog.current?.showModal()}><img src={src} alt={alt} loading="lazy" /></button>
    <dialog ref={dialog} className="stock-zoom" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}><form method="dialog"><button autoFocus className="secondary">Закрыть</button></form><p>{alt} · прокрутите для просмотра в полном размере</p><div><img src={src} alt={alt} /></div></dialog></>;
}

const emptyProduct: AvailabilityProduct = { id: "", name: "", sizes: [], active: true, revision: 1, photo_count: 0, stock_details: { composition: "", material: "", stretch: "", colors: [] }, stock_has_chart: false, stock_model_count: 0 };
function AvailabilityEditor({ product = emptyProduct, onSaved, onClose }: { product?: AvailabilityProduct; onSaved: (product: AvailabilityProduct) => void; onClose: () => void }) {
  const [current, setCurrent] = useState<AvailabilityProduct | null>(product.id ? null : product);
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!product.id) return;
    const controller = new AbortController(); setError(""); setCurrent(null);
    fetch(`/api/availability/${product.id}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Не удалось открыть карточку.");
      setCurrent(body.product);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [product.id, attempt]);
  if (current) return <AvailabilityForm key={`${current.id}-${current.revision}`} product={current} onSaved={onSaved} onClose={onClose} />;
  return <div className="stock-editor">{error ? <><p className="error" role="alert">{error}</p><button type="button" className="secondary" onClick={() => setAttempt(a => a + 1)}>Повторить загрузку</button></> : <p role="status">Загружаем текущие данные и фотографии…</p>}<button type="button" className="secondary" onClick={onClose}>Отмена</button></div>;
}

function PhotoListEditor({ title, images, source, onChange, onUpload }: {
  title: string; images: AvailabilityImage[]; source: (image: AvailabilityImage) => string;
  onChange: (images: AvailabilityImage[]) => void; onUpload: (files: FileList | null, index?: number) => void;
}) {
  const move = (index: number, direction: number) => {
    const next = [...images]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(next);
  };
  return <section><h4>{title}</h4><p className="size-hint">До 6 фотографий. Изменения применяются после сохранения карточки.</p>
    {!images.length && <p>Фото не добавлено</p>}
    <div className="stock-gallery">{images.map((image, index) => <div className="stock-photo-edit" key={index}><img className="stock-preview" src={source(image)} alt={`${title}, фото ${index + 1}`} />
      <label>Заменить фото {index + 1}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { onUpload(e.target.files, index); e.target.value = ""; }} /></label>
      <div className="stock-actions"><button type="button" className="secondary" disabled={index === 0} aria-label={`Переместить фото ${index + 1} назад: ${title}`} onClick={() => move(index, -1)}>←</button><button type="button" className="secondary" disabled={index === images.length - 1} aria-label={`Переместить фото ${index + 1} вперёд: ${title}`} onClick={() => move(index, 1)}>→</button><button type="button" className="secondary" onClick={() => onChange(images.filter((_, i) => i !== index))}>Удалить фото {index + 1}</button></div>
    </div>)}</div>
    <label>Добавить фотографии<input type="file" multiple disabled={images.length >= 6} accept="image/jpeg,image/png,image/webp" onChange={e => { onUpload(e.target.files); e.target.value = ""; }} /></label>
  </section>;
}

function AvailabilityForm({ product, onSaved, onClose }: { product: AvailabilityProduct; onSaved: (product: AvailabilityProduct) => void; onClose: () => void }) {
  const creating = !product.id;
  const [name, setName] = useState(product.name);
  const [sizeText, setSizeText] = useState(product.sizes.join(", "));
  const [photos, setPhotos] = useState<AvailabilityImage[]>(() => Array.from({ length: product.photo_count }, (_, index) => ({ index })));
  const [photosChanged, setPhotosChanged] = useState(false), [modelsChanged, setModelsChanged] = useState(false);
  const sizes = sizeText.split(/[,;\s]+/).filter(Boolean).map(normalizeSize);
  const [details, setDetails] = useState<AvailabilityDetails>(product.stock_details);
  const [chart, setChart] = useState<string | null | undefined>();
  const [models, setModels] = useState<AvailabilityImage[]>(() => Array.from({ length: product.stock_model_count }, (_, index) => ({ index })));
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { const handler = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  function changePhotos(images: AvailabilityImage[]) { setPhotos(images); setPhotosChanged(true); setDirty(true); }
  function changeModels(images: AvailabilityImage[]) { setModels(images); setModelsChanged(true); setDirty(true); }
  async function upload(files: FileList | null, kind: "chart" | "model" | "product", index?: number) {
    if (!files?.length) return;
    setBusy(true); setError("");
    try {
      if (files.length > (kind === "chart" ? 1 : 6)) throw new Error("Выберите одну размерную сетку или до 6 фотографий в одной группе.");
      const existing = kind === "product" ? photos : models;
      if (index !== undefined && files.length !== 1) throw new Error("Для замены выберите одну фотографию.");
      if (kind !== "chart" && index === undefined && existing.length + files.length > 6) throw new Error("В группе может быть максимум 6 фотографий. Удалите лишние перед добавлением.");
      const images: string[] = [];
      for (const file of Array.from(files)) images.push(await preparePhoto(file));
      if (kind === "chart") setChart(images[0]);
      else {
        const next = index === undefined ? [...existing, ...images] : existing.map((photo, i) => i === index ? images[0] : photo);
        if (kind === "product") changePhotos(next); else changeModels(next);
      }
      setDirty(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось обработать фото."); }
    finally { setBusy(false); }
  }
  return <form className="stock-editor" onSubmit={async e => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      const bodyText = JSON.stringify({ ...(creating ? {} : { id: product.id, revision: product.revision }), name, sizes, ...(photosChanged ? { photos } : {}), stock_details: { ...details, colors: details.colors.filter(color => color.name.trim()) }, ...(chart !== undefined ? { stock_chart: chart } : {}), ...(modelsChanged ? { stock_models: models } : {}) });
      if (new Blob([bodyText]).size > 4300000) throw new Error("Суммарный размер фотографий слишком большой. Загрузите часть фото сейчас, остальные — после сохранения.");
      const response = await fetch("/api/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: bodyText });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Не удалось сохранить.");
      setDirty(false); onSaved(body.product);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить."); }
    finally { setSaving(false); }
  }} onChange={() => setDirty(true)}>
    <h3>{creating ? "Добавить позицию" : "Редактировать"}</h3><p className="size-hint">Обязательно только название. Товар сохраняется в общем каталоге. Для подбора размеров позже заполните примеры в разделе «Размеры».</p>
    <fieldset disabled={busy || saving}>
      <label>Название<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
      <PhotoListEditor title="Фотографии товара" images={photos} onChange={changePhotos} onUpload={(files, index) => void upload(files, "product", index)} source={image => typeof image === "string" ? image : `/api/sizes/${product.id}/photo?index=${image.index}&v=${product.revision}`} />
      <label>Размерный ряд — от меньшего к большему<input value={sizeText} onChange={e => setSizeText(e.target.value)} placeholder="S, M, L, XL (можно заполнить позже)" /></label>
      {([ ["composition", "Состав"], ["material", "Описание материала"], ["stretch", "Растяжимость"] ] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={3} maxLength={key === "material" ? 4000 : 2000} value={details[key]} onChange={e => setDetails({ ...details, [key]: e.target.value })} /></label>)}
      <h4>Доступные размеры по цветам</h4>
      <p className="size-hint">Снимите «Наличие не указано», чтобы выбрать размеры. Если ни один размер не выбран — доступных размеров нет.</p>
      {details.colors.map((color, i) => {
        const change = (patch: Partial<typeof color>) => setDetails({ ...details, colors: details.colors.map((c, j) => j === i ? { ...c, ...patch } : c) });
        return <div className="stock-color-editor" key={i}><label>Название цвета<input maxLength={80} value={color.name} onChange={e => change({ name: e.target.value })} /></label>
          <label className="stock-check"><input type="checkbox" checked={color.sizes === null} onChange={e => change({ sizes: e.target.checked ? null : [] })} />Наличие не указано</label>
          <div className="stock-size-options">{[...new Set([...sizes, ...(color.sizes ?? [])])].map(size => <label className="stock-check" key={size}><input type="checkbox" disabled={color.sizes === null} checked={color.sizes?.includes(size) ?? false} onChange={e => change({ sizes: e.target.checked ? [...(color.sizes ?? []), size] : color.sizes?.filter(s => s !== size) ?? [] })} />{size}{!sizes.includes(size) ? " (удалён из размерного ряда — снимите выбор)" : ""}</label>)}</div>
          <button type="button" className="secondary" onClick={() => { setDirty(true); setDetails({ ...details, colors: details.colors.filter((_, j) => i !== j) }); }}>Удалить цвет</button></div>;
      })}
      <button type="button" className="secondary" disabled={details.colors.length >= 50} onClick={() => { setDirty(true); setDetails({ ...details, colors: [...details.colors, { name: "", sizes: null }] }); }}>Добавить цвет</button>
      <label>Размерная сетка — отдельная картинка<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { void upload(e.target.files, "chart"); e.target.value = ""; }} /></label>
      {chart || (chart === undefined && product.stock_has_chart) ? <img className="stock-preview" src={chart ?? `/api/availability/${product.id}/photo?kind=chart&v=${product.revision}`} alt="Размерная сетка" /> : <p>Не указано</p>}
      <button type="button" className="secondary" onClick={() => { setChart(null); setDirty(true); }}>Удалить размерную сетку</button>
      <PhotoListEditor title="Фотографии на модели" images={models} onChange={changeModels} onUpload={(files, index) => void upload(files, "model", index)} source={image => typeof image === "string" ? image : `/api/availability/${product.id}/photo?kind=model&index=${image.index}&v=${product.revision}`} />
    </fieldset>
    {busy && <p role="status">Обрабатываем фотографии…</p>}{error && <p className="error" role="alert">{error}</p>}
    <div className="stock-actions"><button className="primary" disabled={busy || saving}>{saving ? "Сохраняем…" : creating ? "Добавить позицию" : "Сохранить"}</button><button type="button" className="secondary" disabled={busy || saving} onClick={() => { if (!dirty || window.confirm("Закрыть редактор без сохранения изменений?")) onClose(); }}>Отмена</button>{dirty && <span>Есть несохранённые изменения</span>}</div>
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
    {admin && <button type="button" className="primary" disabled={editor !== null || loading || Boolean(error)} onClick={() => { setEditor("new"); setNotice(""); }}>Добавить позицию</button>}
    {admin && editor === "new" && <AvailabilityEditor onClose={() => setEditor(null)} onSaved={saved => { setProducts(old => [...old.filter(p => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, "ru"))); setQuery(""); setEditor(null); setNotice(`«${saved.name}»: позиция добавлена.`); }} />}
    {notice && <p role="status">{notice}</p>}{loading && <p role="status">Загружаем товары…</p>}
    {error && <div role="alert"><p className="error">{error}</p><button className="secondary" onClick={() => setAttempt(a => a + 1)}>Повторить загрузку</button></div>}
    {!loading && !error && !visible.length && <p>{products.length ? "По этому названию ничего не найдено." : "В каталоге пока нет товаров."}</p>}
    {!error && <div className="stock-grid">{visible.map(product => {
      const photo = (index: number) => `/api/sizes/${product.id}/photo?index=${index}&v=${product.revision}`;
      const extra = (kind: "chart" | "model", index = 0) => `/api/availability/${product.id}/photo?kind=${kind}&index=${index}&v=${product.revision}`;
      return <details className="card stock-card" key={product.id}><summary>{product.photo_count > 0 ? <img src={photo(0)} alt={product.name} loading="lazy" width={600} height={600} /> : <div className="size-photo-placeholder">Фото не добавлено</div>}<span><strong>{product.name}</strong>{!product.active && <small>Скрыт от сотрудников</small>}<small>Фото, описание и наличие · раскрыть</small></span></summary>
        <div className="stock-content"><h3>Галерея товара</h3>{product.photo_count > 0 ? <div className="stock-gallery">{Array.from({ length: product.photo_count }, (_, i) => <ZoomImage key={i} src={photo(i)} alt={`${product.name}, фото ${i + 1}`} />)}</div> : <p>Фото не добавлено</p>}
          <h3>Размерная сетка</h3>{product.stock_has_chart ? <><p className="size-hint">Нажмите, чтобы увеличить</p><ZoomImage src={extra("chart")} alt={`${product.name}, размерная сетка`} /></> : <p>Не указано</p>}
          <h3>Фото на модели</h3>{product.stock_model_count ? <div className="stock-gallery">{Array.from({ length: product.stock_model_count }, (_, i) => <ZoomImage key={i} src={extra("model", i)} alt={`${product.name}, на модели ${i + 1}`} />)}</div> : <p>Не указано</p>}
          <dl className="stock-description">{([["composition", "Состав"], ["material", "Материал"], ["stretch", "Растяжимость"]] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{product.stock_details[key] || "Не указано"}</dd></div>)}</dl>
          <h3>Доступные размеры по цветам</h3>{product.stock_details.colors.length ? <ul className="stock-colors">{product.stock_details.colors.map(color => <li key={color.name}><strong>{color.name}</strong><span>{color.sizes === null ? "Не указано" : color.sizes.length ? color.sizes.join(" · ") : "Нет доступных размеров"}</span></li>)}</ul> : <p>Не указано</p>}
          {admin && (editor === product.id ? <AvailabilityEditor product={product} onClose={() => setEditor(null)} onSaved={saved => { setProducts(old => old.map(p => p.id === saved.id ? saved : p)); setEditor(null); setNotice(`«${saved.name}»: наличие сохранено.`); }} /> : <button className="secondary" type="button" disabled={editor !== null} onClick={() => { setNotice(""); setEditor(product.id); }}>Редактировать</button>)}
        </div></details>;
    })}</div>}
  </>;
}
