import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatWarehouseDateTime, presetRange, utcRange } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase";
import { getSession } from "@/lib/session";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string; page?: string }> };
const duration = (seconds: number | string | null) => { const n = Number(seconds ?? 0); return `${String(Math.floor(n / 3600)).padStart(2,"0")}:${String(Math.floor(n % 3600 / 60)).padStart(2,"0")}:${String(n % 60).padStart(2,"0")}`; };
export default async function EmployeePage({ params, searchParams }: Props) {
  const session = await getSession(); if (!session || session.role !== "admin") redirect("/admin/login");
  const { id } = await params, query = await searchParams, fallback = presetRange("today"); const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from ?? "") ? query.from! : fallback.from, to = /^\d{4}-\d{2}-\d{2}$/.test(query.to ?? "") ? query.to! : fallback.to; const page = Math.max(1, Number.parseInt(query.page ?? "1") || 1), pageSize = 100, range = utcRange(from, to), db = createAdminClient();
  const [{ data: employee }, { data: scans, count }, { data: shifts }] = await Promise.all([
    db.from("employees").select("name").eq("id", id).maybeSingle(),
    db.from("scan_attempts").select("id,barcode,attempted_at,duration_ms,input_type,success,duplicate_of", { count: "exact" }).eq("employee_id", id).gte("attempted_at", range.fromUtc).lt("attempted_at", range.toUtc).order("attempted_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1),
    db.from("work_shifts").select("id,started_at,ended_at,active_seconds,pause_seconds,pause_count,orders_count,earnings,median_interval_seconds").eq("employee_id", id).gte("started_at", range.fromUtc).lt("started_at", range.toUtc).order("started_at", { ascending: false }),
  ]); if (!employee) notFound(); const pages = Math.ceil((count ?? 0) / pageSize);
  return <><Link href={`/admin?from=${from}&to=${to}&preset=custom`} className="back">← К статистике</Link><p className="eyebrow">Сотрудник</p><h1>{employee.name}</h1>
    <h2>История смен</h2><div className="table-wrap"><table><thead><tr><th>Дата</th><th>Начало</th><th>Конец</th><th>Активное время</th><th>Паузы</th><th>Заказов</th><th>Заработано</th><th>Медианный темп</th></tr></thead><tbody>{(shifts ?? []).map(s => <tr key={s.id}><td>{new Date(s.started_at).toLocaleDateString("ru-RU")}</td><td>{formatWarehouseDateTime(s.started_at)}</td><td>{s.ended_at ? formatWarehouseDateTime(s.ended_at) : "Идёт"}</td><td>{duration(s.active_seconds)}</td><td>{s.pause_count} / {duration(s.pause_seconds)}</td><td>{s.orders_count}</td><td>{Number(s.earnings).toLocaleString("ru-RU")} ₽</td><td>{s.median_interval_seconds == null ? "—" : duration(Math.round(Number(s.median_interval_seconds)))}</td></tr>)}</tbody></table></div>
    <h2 style={{marginTop:32}}>История сканов</h2><p className="period">{from} — {to} · всего {count ?? 0}</p><div className="table-wrap"><table><thead><tr><th>Дата и время</th><th>Штрихкод</th><th>Длительность</th><th>Тип</th><th>Результат</th></tr></thead><tbody>{(scans ?? []).map(a => <tr key={a.id}><td>{formatWarehouseDateTime(a.attempted_at)}</td><td className="barcode">{a.barcode}</td><td>{a.duration_ms} мс</td><td>{a.input_type === "scanner" ? "Сканер" : "Ручной ввод"}</td><td><span className={`result ${a.success ? "accepted" : a.duplicate_of ? "duplicate" : "rejected"}`}>{a.success ? "Засчитан" : a.duplicate_of ? "Дубль" : "Не засчитан"}</span></td></tr>)}</tbody></table></div>
    {pages > 1 && <nav className="pagination">{page > 1 && <Link href={`?from=${from}&to=${to}&page=${page-1}`}>← Назад</Link>}<span>{page} / {pages}</span>{page < pages && <Link href={`?from=${from}&to=${to}&page=${page+1}`}>Далее →</Link>}</nav>}</>;
}
