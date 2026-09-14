import Link from "next/link";
import { redirect } from "next/navigation";
import { formatWarehouseDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { formatInTimeZone } from "date-fns-tz";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";

type Search = Promise<{ barcode?: string | string[]; page?: string | string[] }>;
const pageSize = 50;

export default async function OrderSearchPage({ searchParams }: { searchParams: Search }) {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/admin/login");

  const query = await searchParams;
  const barcode = typeof query.barcode === "string" ? query.barcode.trim() : "";
  const requestedPage = typeof query.page === "string" ? Number(query.page) : 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 1_000_000 ? requestedPage : 1;
  const invalid = [...barcode].length > 512;
  const db = createAdminClient();
  // Both queries run only on the server, after checking the signed admin session.
  // scan_attempts is the audit journal also populated by ScannerAgent registration.
  const results = barcode && !invalid ? await Promise.all([
    db.from("scans").select("id,barcode,employee_id,scanned_at,shift_id,order_interval_seconds")
      .eq("barcode", barcode).maybeSingle(),
    db.from("scan_attempts").select("id,barcode,employee_id,attempted_at,success,duplicate_of,reason,shift_id", { count: "exact" })
      .eq("barcode", barcode).order("attempted_at", { ascending: false }).order("id", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1),
  ]) : null;
  const scanError = results?.[0].error;
  const attemptsError = results?.[1].error;
  if (scanError) logSupabaseError("admin order search: scans", scanError);
  if (attemptsError) logSupabaseError("admin order search: scan_attempts", attemptsError);
  const scan = results?.[0].data;
  const attempts = results?.[1].data ?? [];
  const count = results?.[1].count ?? 0;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const pageHref = (value: number) => `/admin/order-search?${new URLSearchParams({ barcode, page: String(value) })}`;
  // Fetch only the employees present in these results; no PostgREST relationship inference.
  const employeeIds = [...new Set([...(scan ? [scan.employee_id] : []), ...attempts.map(a => a.employee_id)])];
  const employees = employeeIds.length ? await db.from("employees").select("id,name").in("id", employeeIds) : null;
  if (employees?.error) logSupabaseError("admin order search: employees", employees.error);
  const names = new Map((employees?.data ?? []).map(employee => [employee.id, employee.name]));
  const employeeName = (id: string) => names.get(id) ?? "Имя недоступно";
  const employeeHref = (id: string, timestamp: string) => {
    const day = formatInTimeZone(timestamp, env().WAREHOUSE_TIMEZONE, "yyyy-MM-dd");
    return `/admin/employees/${id}?${new URLSearchParams({ preset: "custom", from: day, to: day })}#collected-orders`;
  };

  return <>
    <h1>Поиск заказа</h1>
    <form action="/admin/order-search" method="get" className="card section" style={{ display: "grid", gap: 12 }}>
      <label htmlFor="order-barcode">Введите номер заказа или штрихкод</label>
      <input id="order-barcode" name="barcode" type="text" defaultValue={barcode} placeholder="Например, P00119280697" required autoCapitalize="none" spellCheck={false} />
      <button className="primary" type="submit">Найти</button>
    </form>
    {invalid && <p className="error" role="alert">Штрихкод должен содержать не более 512 символов.</p>}
    {query.barcode !== undefined && !barcode && <p role="status">Введите номер заказа или штрихкод.</p>}
    {scanError && <p className="error" role="alert">Не удалось загрузить успешный скан из базы. Причина записана в журнал сервера.</p>}
    {attemptsError && <p className="error" role="alert">Не удалось загрузить историю попыток из базы. Причина записана в журнал сервера.</p>}
    {employees?.error && <p className="error" role="alert">Не удалось загрузить имена сотрудников. Сотрудники указаны по employee_id.</p>}
    {results && <>
      {!scan && count === 0 && !scanError && !attemptsError ? <p role="status">Заказ с таким штрихкодом не найден</p> : <>
        {scan ? <section className="card section" style={{ overflowWrap: "anywhere" }}>
          <p className="success">successful · Засчитан</p>
          <h2 style={{ fontSize: "clamp(1.6rem, 4vw, 2.5rem)" }}>Собирал: <Link href={employeeHref(scan.employee_id, scan.scanned_at)}>{employeeName(scan.employee_id)}</Link></h2>
          <p style={{ fontSize: "clamp(1.3rem, 3vw, 2rem)", fontWeight: 800 }}>Отсканировано: {formatWarehouseDateTime(scan.scanned_at)}</p>
          <p>Штрихкод: <strong>{scan.barcode}</strong></p>
          <p>employee_id: <Link href={employeeHref(scan.employee_id, scan.scanned_at)}>{scan.employee_id}</Link></p>
          <p>Смена / shift_id: {scan.shift_id ?? "Не записана"}</p>
          {scan.order_interval_seconds != null && <p>Интервал от предыдущего успешного заказа: {Number(scan.order_interval_seconds).toLocaleString("ru-RU")} сек.</p>}
        </section> : !scanError && count > 0 && <p role="status">Успешный скан не найден. Найдены попытки сканирования.</p>}
        {!attemptsError && <>
        <h2>Все попытки: {count}</h2>
        <p>Время: {env().WAREHOUSE_TIMEZONE}. Сначала новые попытки.</p>
        {attempts.length > 0 ? <div className="table-wrap"><table>
          <thead><tr><th>Дата и точное время</th><th>Штрихкод</th><th>Сотрудник / employee_id</th><th>Смена / shift_id</th><th>Статус</th></tr></thead>
          <tbody>{attempts.map(attempt => {
            const status = attempt.success ? "successful" : attempt.duplicate_of ? "duplicate" : "rejected";
            return <tr key={attempt.id}>
              <td>{formatWarehouseDateTime(attempt.attempted_at)}</td>
              <td style={{ overflowWrap: "anywhere" }}>{attempt.barcode}</td>
              <td><Link href={employeeHref(attempt.employee_id, attempt.attempted_at)}>{employeeName(attempt.employee_id)}</Link><br /><small>{attempt.employee_id}</small></td>
              <td>{attempt.shift_id ?? "Не записана"}</td>
              <td><span className={`result ${attempt.success ? "accepted" : status}`}>{status}</span>{attempt.reason && attempt.reason !== "counted" && attempt.reason !== status && <div>{attempt.reason}</div>}</td>
            </tr>;
          })}</tbody>
        </table></div> : <p>{count > 0 ? "На этой странице нет попыток." : "В журнале попыток нет записей."}</p>}
        {(pages > 1 || page > 1) && <nav className="pagination" aria-label="Страницы попыток">
          {page > 1 && <Link href={pageHref(Math.min(page - 1, pages))}>← Назад</Link>}
          <span>Страница {page} · всего {pages}</span>
          {page < pages && <Link href={pageHref(page + 1)}>Далее →</Link>}
        </nav>}
        </>}
      </>}
    </>}
  </>;
}
