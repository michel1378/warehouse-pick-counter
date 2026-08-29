import { redirect } from "next/navigation";
import { logout } from "@/app/actions";
import { Scanner } from "@/components/Scanner";
import { utcRange, warehouseToday } from "@/lib/dates";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase";

export default async function ScanPage() {
  const session = await getSession();
  if (!session || session.role !== "employee") redirect("/");
  const db = createAdminClient();
  const { data: employee } = await db.from("employees").select("active,name").eq("id", session.sub).single();
  if (!employee?.active) redirect("/logout");
  const today = warehouseToday(); const range = utcRange(today, today);
  const [{ count }, { data: settings }] = await Promise.all([
    db.from("scans").select("id", { count: "exact", head: true }).eq("employee_id", session.sub).gte("scanned_at", range.fromUtc).lt("scanned_at", range.toUtc),
    db.from("settings").select("price_per_order").eq("id", 1).single(),
  ]);
  const price = Number(settings?.price_per_order ?? 23); const total = count ?? 0;
  return <main className="scan-page"><header className="scan-header"><div><p className="eyebrow">Сотрудник</p><h1>{employee.name}</h1></div><form action={logout}><button className="secondary">Выйти</button></form></header><Scanner initialCount={total} initialAmount={total * price} price={price} /></main>;
}
