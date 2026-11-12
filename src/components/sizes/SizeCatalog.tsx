"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { CatalogSizeProduct as SizeProduct } from "@/lib/catalog-visibility";
import { SizePicker } from "./SizePicker";
import { SizeEditor } from "./SizeEditor";
import { SizeConflicts } from "./SizeConflicts";

const DetailedSizePicker = dynamic(() => import("./DetailedSizePicker").then(module => module.DetailedSizePicker), {
  loading: () => <p className="size-hint">Открываем подбор…</p>,
});

export function SizeCatalog({ admin = false, detailed = false }: { admin?: boolean; detailed?: boolean }) {
  const [products, setProducts] = useState<SizeProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editor, setEditor] = useState<SizeProduct | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [photoIndexes, setPhotoIndexes] = useState<Record<string, number>>({});
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const response = await fetch("/api/sizes", { cache: "no-store" });
      const data = await response.json();
      if (request !== generation.current) return;
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить каталог.");
      setProducts(data.products); setError("");
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : "Не удалось загрузить каталог. Проверьте интернет."); }
    finally { if (request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    let lastRefresh = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh < 1000) return;
      lastRefresh = Date.now(); void load();
    };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { generation.current++; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  const [hidden, setHidden] = useState(false);
  const visible = products.filter(p => hidden ? !p.show_in_sizes : p.show_in_sizes).filter(p => p.name.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  return <>
    {admin && <label className="size-checkbox"><input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} />Скрытые в размерах (включая скрытые в обоих разделах)</label>}
    <div className="size-toolbar"><label className="size-search"><span className="visually-hidden">Найти вещь</span><input type="search" placeholder="Найти вещь по названию…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <button type="button" className="secondary" onClick={() => void load()}>Обновить</button>
      {admin && <button type="button" className="primary" disabled={editor !== null} onClick={() => { setEditor("new"); setNotice(""); }}>+ Добавить вещь</button>}
    </div>
    {notice && <p className="success" role="status">{notice}</p>}
    {admin && editor !== null && <SizeEditor key={editor === "new" ? "new" : editor.id} product={editor === "new" ? null : editor} onClose={() => { setEditor(null); void load(); }} onSaved={p => {
      generation.current++; setPhotoIndexes(old => ({ ...old, [p.id]: 0 })); setProducts(old => [...old.filter(x => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name, "ru")));
      setEditor(null); setError(""); setNotice("Сохранено. Настройки видимости обновлены.");
    }} />}
    {error && <p className="error" role="alert">{error} Подбор недоступен до обновления каталога.</p>}
    {loading ? <p role="status">Загружаем вещи…</p> : !error && !products.length ? <div className="card size-empty"><h2>Здесь появятся ваши вещи</h2><p>{admin ? "Добавьте фотографию, размерный ряд и ваши рекомендации." : "Администратор пока не добавил вещи в каталог."}</p></div> : !error && !visible.length ? <p>По этому названию ничего не найдено.</p> : null}
    {!error && <div className="size-grid">{visible.map((p, position) => {
      const count = Math.max(1, p.photo_count || 1);
      const index = Math.min(photoIndexes[p.id] ?? 0, count - 1);
      const changePhoto = (delta: number) => setPhotoIndexes(old => ({ ...old, [p.id]: (index + delta + count) % count }));
      return <article key={p.id} className={`card size-card ${open === p.id ? "expanded" : ""}`}>
      <div className="size-card-media">
        {p.photo_count > 0 ? <img src={`/api/sizes/${p.id}/photo?index=${index}&v=${p.revision}`} alt={`${p.name}, фото ${index + 1} из ${count}`} loading={position < 2 ? "eager" : "lazy"} decoding="async" width={600} height={600} /> : <div className="size-photo-placeholder">Фото не добавлено</div>}
        {count > 1 && <><button type="button" className="size-photo-arrow prev" aria-label="Предыдущее фото" onClick={() => changePhoto(-1)}>‹</button><button type="button" className="size-photo-arrow next" aria-label="Следующее фото" onClick={() => changePhoto(1)}>›</button><span className="size-photo-count">{index + 1} / {count}</span></>}
      </div>
      <button type="button" className="size-card-button" aria-expanded={open === p.id} aria-controls={`picker-${p.id}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
        <span className="size-card-caption"><strong>{p.name}</strong><small>{p.note || "Особенности посадки не указаны"}</small>{!p.active && <span className="badge">Скрыта от сотрудников</span>}<span className="size-card-action">{open === p.id ? "Свернуть ↑" : "Подобрать размер ↓"}</span></span>
      </button>
      {open === p.id && ((p.examples.length || p.fittings?.length) && p.sizes.length && p.photo_count > 0 ? detailed
        ? <DetailedSizePicker key={`${p.id}-${p.revision}`} product={p} />
        : <SizePicker key={`${p.id}-${p.revision}`} product={p} />
        : <p className="size-hint">Подбор пока недоступен. Заполните размеры, фотографии и примеры подбора.</p>)}
      {admin && <SizeConflicts product={p} />}
      {admin && <div className="size-card-admin"><span>{p.examples.length} примеров · {p.sizes.join(" / ")}</span><button className="secondary" type="button" disabled={editor !== null} onClick={() => { setEditor(p); setNotice(""); }}>Редактировать</button></div>}
    </article>})}</div>}
  </>;
}
