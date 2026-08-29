import Link from "next/link";
import { notFound } from "next/navigation";
import { formatWarehouseDateTime, presetRange, utcRange } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string; page?: string }> };
export default async function EmployeeScansPage({ params, searchParams }: Props) {
  const session = await getSession(); if (!session || session.role !== "admin") redirect("/admin/login");
  const { id } = await params; const query = await searchParams; const fallback = presetRange("today");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from ?? "") ? query.from! : fallback.from;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to ?? "") ? query.to! : fallback.to;
  const page = Math.max(1, Number.parseInt(query.page ?? "1") || 1); const pageSize = 100; const range = utcRange(from, to);
  const db = createAdminClient();
  const [{ data: employee }, { data: scans, count }] = await Promise.all([
    db.from("employees").select("name").eq("id", id).maybeSingle(),
    db.from("scan_attempts").select("id,barcode,attempted_at,duration_ms,input_type,success,duplicate_of", { count: "exact" }).eq("employee_id", id).gte("attempted_at", range.fromUtc).lt("attempted_at", range.toUtc).order("attempted_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1),
  ]);
  if (!employee) notFound(); const pages = Math.ceil((count ?? 0) / pageSize);
  return <><Link href={`/admin?from=${from}&to=${to}&preset=custom`} className="back">← К статистике</Link><p className="eyebrow">История попыток</p><h1>{employee.name}</h1><p className="period">{from} — {to} · всего {count ?? 0}</p><div className="table-wrap"><table><thead><tr><th>Дата и время</th><th>Штрихкод</th><th>Длительность</th><th>Тип</th><th>Результат</th></tr></thead><tbody>{(scans ?? []).map((attempt) => <tr key={attempt.id}><td>{formatWarehouseDateTime(attempt.attempted_at)}</td><td className="barcode">{attempt.barcode}</td><td>{attempt.duration_ms} мс</td><td>{attempt.input_type === "scanner" ? "Сканер" : "Ручной ввод"}</td><td><span className={`result ${attempt.success ? "accepted" : attempt.duplicate_of ? "duplicate" : "rejected"}`}>{attempt.success ? "Засчитан" : attempt.duplicate_of ? "Дубль" : "Не засчитан"}</span></td></tr>)}</tbody></table></div>{pages > 1 && <nav className="pagination">{page > 1 && <Link href={`?from=${from}&to=${to}&page=${page - 1}`}>← Назад</Link>}<span>{page} / {pages}</span>{page < pages && <Link href={`?from=${from}&to=${to}&page=${page + 1}`}>Далее →</Link>}</nav>}</>;
}
