import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SizeCatalog } from "@/components/sizes/SizeCatalog";

export default async function SizePreviewPage() {
  const session = await getSession();
  if (session?.role !== "admin") redirect("/admin/login");
  return <>
    <div className="title-row"><div><p className="eyebrow">Проверка перед запуском</p><h1>Подбор по цветам и меркам</h1>
      <p>Один клиент — отдельный размер для каждого цвета модели.</p></div><Link href="/admin/sizes">Открыть обычный подбор</Link></div>
    <SizeCatalog detailed />
  </>;
}
