import Link from "next/link";
import { logout } from "@/app/actions";

export function AdminNav({ name }: { name: string }) {
  return <header className="admin-header"><Link href="/admin" className="brand">Склад</Link><nav><Link href="/admin">Статистика</Link><Link href="/admin/employees">Сотрудники</Link></nav><span className="admin-name">{name}</span><form action={logout}><button className="secondary">Выйти</button></form></header>;
}
