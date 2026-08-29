import Link from "next/link";
import { PeriodFilter } from "@/components/PeriodFilter";
import { SubmitForm } from "@/components/SubmitForm";
import { updatePrice } from "@/app/actions";
import { presetRange, utcRange } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase";
import { getSession } from "@/lib/session";
import { redirect } from "next/navigation";

type Search = Promise<{ preset?: string; from?: string; to?: string }>;
const validDate = (value?: string) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");

export default async function AdminPage({ searchParams }: { searchParams: Search }) {
  const session = await getSession(); if (!session || session.role !== "admin") redirect("/admin/login");
  const query = await searchParams; const preset = query.preset ?? "today";
  const fallback = presetRange(preset);
  const from = preset === "custom" && validDate(query.from) ? query.from! : fallback.from;
  const to = preset === "custom" && validDate(query.to) ? query.to! : fallback.to;
  const safeTo = from <= to ? to : from; const range = utcRange(from, safeTo);
  const db = createAdminClient();
  const [{ data: rows, error }, { data: settings }] = await Promise.all([
    db.rpc("employee_stats", { p_from: range.fromUtc, p_to: range.toUtc }),
    db.from("settings").select("price_per_order").eq("id", 1).single(),
  ]);
  const price = Number(settings?.price_per_order ?? 23);
  return <><div className="title-row"><div><p className="eyebrow">Отчеты</p><h1>Статистика сборки</h1></div><SubmitForm action={updatePrice} className="price-form"><label>Ставка, ₽ <input name="price" type="number" min="0" step="0.01" defaultValue={price} required /></label></SubmitForm></div><PeriodFilter preset={preset} from={from} to={safeTo} />{error ? <p className="error">Не удалось загрузить статистику</p> : <div className="table-wrap"><table><thead><tr><th>Сотрудник</th><th>Заказов</th><th>Сумма</th><th>Дублей</th></tr></thead><tbody>{(rows ?? []).map((row: { id: string; name: string; successful: number | string; duplicates: number | string }) => { const success = Number(row.successful); return <tr key={row.id}><td><Link href={`/admin/employees/${row.id}?from=${from}&to=${safeTo}`}>{row.name}</Link></td><td>{success}</td><td>{(success * price).toLocaleString("ru-RU")} ₽</td><td>{Number(row.duplicates)}</td></tr>; })}</tbody></table></div>}</>;
}
