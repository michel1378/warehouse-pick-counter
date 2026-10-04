"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SizeProduct } from "@/lib/sizes";
import { SizePicker } from "./SizePicker";
import { SizeEditor } from "./SizeEditor";

export function SizeCatalog({ admin = false }: { admin?: boolean }) {
  const [products, setProducts] = useState<SizeProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editor, setEditor] = useState<SizeProduct | "new" | null>(null);
  const [notice, setNotice] = useState("");
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
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { generation.current++; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  const visible = products.filter(p => p.name.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  return <>
    <div className="size-toolbar"><label className="size-search"><span className="visually-hidden">Найти вещь</span><input type="search" placeholder="Найти вещь по названию…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <button type="button" className="secondary" onClick={() => void load()}>Обновить</button>
      {admin && <button type="button" className="primary" disabled={editor !== null} onClick={() => { setEditor("new"); setNotice(""); }}>+ Добавить вещь</button>}
    </div>
    {notice && <p className="success" role="status">{notice}</p>}
    {admin && editor !== null && <SizeEditor key={editor === "new" ? "new" : editor.id} product={editor === "new" ? null : editor} onClose={() => { setEditor(null); void load(); }} onSaved={p => {
      generation.current++; setProducts(old => [...old.filter(x => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name, "ru")));
      setEditor(null); setError(""); setNotice(p.active ? "Сохранено. Вещь доступна сотрудникам." : "Сохранено. Вещь скрыта от сотрудников.");
    }} />}
    {error && <p className="error" role="alert">{error} Подбор недоступен до обновления каталога.</p>}
    {loading ? <p role="status">Загружаем вещи…</p> : !error && !products.length ? <div className="card size-empty"><h2>Здесь появятся ваши вещи</h2><p>{admin ? "Добавьте фотографию, размерный ряд и ваши рекомендации." : "Администратор пока не добавил вещи в каталог."}</p></div> : !error && !visible.length ? <p>По этому названию ничего не найдено.</p> : null}
    {!error && <div className="size-grid">{visible.map(p => <article key={p.id} className={`card size-card ${open === p.id ? "expanded" : ""}`}>
      <button type="button" className="size-card-button" aria-expanded={open === p.id} aria-controls={`picker-${p.id}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
        <img src={`/api/sizes/${p.id}/photo?v=${p.revision}`} alt={p.name} loading="lazy" width={600} height={600} />
        <span className="size-card-caption"><strong>{p.name}</strong><small>{p.note || "Особенности посадки не указаны"}</small>{!p.active && <span className="badge">Скрыта от сотрудников</span>}<span className="size-card-action">{open === p.id ? "Свернуть ↑" : "Подобрать размер ↓"}</span></span>
      </button>
      {open === p.id && <SizePicker key={`${p.id}-${p.revision}`} product={p} />}
      {admin && <div className="size-card-admin"><span>{p.examples.length} примеров · {p.sizes.join(" / ")}</span><button className="secondary" type="button" disabled={editor !== null} onClick={() => { setEditor(p); setNotice(""); }}>Редактировать</button></div>}
    </article>)}</div>}
  </>;
}
