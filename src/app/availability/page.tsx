import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions";
import { getSession } from "@/lib/session";
import { AvailabilityCatalog } from "@/components/AvailabilityCatalog";
export default async function AvailabilityPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role === "admin") redirect("/admin/availability");
  return <main className="sizes-page"><header className="sizes-header"><div><p className="eyebrow">Каталог склада</p><h1>Наличие</h1><p>Выберите товар, чтобы посмотреть фотографии, описание и размеры по цветам.</p></div><nav className="employee-links"><Link href="/sizes">Размеры</Link>{session.permissions?.includes("picking") && <Link href="/scan">Сборка заказов</Link>}{session.permissions?.includes("reviews") && <Link href="/reviews">Отзывы</Link>}<form action={logout}><button className="secondary">Выйти</button></form></nav></header><AvailabilityCatalog /></main>;
}
