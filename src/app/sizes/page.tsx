import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions";
import { getSession } from "@/lib/session";
import { SizeCatalog } from "@/components/sizes/SizeCatalog";
export default async function SizesPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role === "admin") redirect("/admin/sizes");
  return <main className="sizes-page"><header className="sizes-header"><div><p className="eyebrow">Подбор для отправки</p><h1>Размеры</h1><p className="size-hint">Выберите вещь и укажите параметры клиента.</p></div>
    <nav className="employee-links">{session.permissions?.includes("picking") && <Link href="/scan">Сборка заказов</Link>}{session.permissions?.includes("attendance") && <Link href="/attendance">Отметки</Link>}{session.permissions?.includes("reviews") && <Link href="/reviews">Отзывы</Link>}<form action={logout}><button className="secondary">Выйти</button></form></nav>
  </header><SizeCatalog /></main>;
}
