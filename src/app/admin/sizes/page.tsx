import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SizeCatalog } from "@/components/sizes/SizeCatalog";
export default async function AdminSizesPage() {
  const session = await getSession();
  if (session?.role !== "admin") redirect("/admin/login");
  return <><p className="eyebrow">Каталог и рекомендации</p><h1>Размеры</h1><SizeCatalog admin /></>;
}
