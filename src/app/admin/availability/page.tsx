import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { AvailabilityCatalog } from "@/components/AvailabilityCatalog";
export default async function AdminAvailabilityPage() {
  const session = await getSession();
  if (session?.role !== "admin") redirect("/admin/login");
  return <><p className="eyebrow">Каталог склада</p><h1>Наличие</h1><p>Общий каталог товаров. Добавляйте позиции, описание и доступные размеры по цветам.</p><AvailabilityCatalog admin /></>;
}
