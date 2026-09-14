import Link from "next/link";
import { redirect } from "next/navigation";
import { formatWarehouseDateTime, utcRange } from "@/lib/dates";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";

export async function EmployeeOrders({ employeeId, from, to, barcode: input, page: inputPage }: {
  employeeId: string; from: string; to: string; barcode?: string; page?: string;
}) {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/admin/login");
  const barcode = typeof input === "string" ? input.trim() : "";
  const requestedPage = Number(inputPage ?? 1);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 1_000_000 ? requestedPage : 1;
  const pageSize = 50;
  const range = utcRange(from, to);
  let query = createAdminClient().from("scans")
    .select("id,barcode,scanned_at,shift_id,order_interval_seconds", { count: "exact" })
    .eq("employee_id", employeeId).gte("scanned_at", range.fromUtc).lt("scanned_at", range.toUtc);
  if (barcode) query = query.eq("barcode", barcode);
  const { data, error, count } = await query.order("scanned_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) logSupabaseError("admin employee collected orders: scans", error);
  const pages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
  const href = (value: number) => `?${new URLSearchParams({ preset: "custom", from, to, barcode, ordersPage: String(value) })}#collected-orders`;
  return <section id="collected-orders" style={{ marginBottom: 32 }}>
    <h2>Собранные заказы</h2>
    <form method="get" className="card section" style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name="preset" value="custom" />
      <input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
      <label>Поиск по точному штрихкоду<input type="text" name="barcode" defaultValue={barcode} autoCapitalize="none" spellCheck={false} /></label>
      <button className="secondary">Найти</button>
      {barcode && <Link href={`?${new URLSearchParams({ preset: "custom", from, to })}#collected-orders`}>Сбросить поиск</Link>}
    </form>
    {error ? <p className="error" role="alert">Не удалось загрузить собранные заказы. Причина записана в журнал сервера.</p> : <>
      <p>{from} — {to} · всего {count ?? 0} · сначала новые</p>
      {data?.length ? <div className="table-wrap"><table>
        <thead><tr><th>Штрихкод</th><th>Дата</th><th>Точное время</th><th>Смена / shift_id</th><th>Интервал сборки</th><th>Статус</th></tr></thead>
        <tbody>{data.map(scan => {
          const [date, time] = formatWarehouseDateTime(scan.scanned_at).split(" ");
          return <tr key={scan.id}>
            <td style={{ overflowWrap: "anywhere" }}><Link href={`/admin/order-search?${new URLSearchParams({ barcode: scan.barcode })}`}>{scan.barcode}</Link></td>
            <td>{date}</td><td>{time}</td><td>{scan.shift_id ?? "Не записана"}</td>
            <td>{scan.order_interval_seconds == null ? "—" : `${Number(scan.order_interval_seconds).toLocaleString("ru-RU")} сек.`}</td>
            <td><span className="result accepted">successful · Засчитан</span></td>
          </tr>;
        })}</tbody>
      </table></div> : <p>{page > 1 ? "На этой странице нет заказов." : "За выбранный период заказы не найдены."}</p>}
      {(pages > 1 || page > 1) && <nav className="pagination" aria-label="Страницы собранных заказов">
        {page > 1 && <Link href={href(Math.min(page - 1, pages))}>← Назад</Link>}
        <span>Страница {page} · всего {pages}</span>
        {page < pages && <Link href={href(page + 1)}>Далее →</Link>}
      </nav>}
    </>}
  </section>;
}
