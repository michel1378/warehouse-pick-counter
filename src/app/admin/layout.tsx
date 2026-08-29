import { AdminNav } from "@/components/AdminNav";
import { getSession } from "@/lib/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "admin") return children;
  return <><AdminNav name={session.name} /><main className="admin-main">{children}</main></>;
}
