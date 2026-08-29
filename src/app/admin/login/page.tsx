import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAdmin } from "@/app/actions";
import { LoginForm } from "@/components/LoginForm";
import { getSession } from "@/lib/session";

export default async function AdminLoginPage() {
  const session = await getSession();
  if (session?.role === "admin") redirect("/admin");
  return <main className="center-page"><div className="login-wrap"><p className="eyebrow">Управление</p><h1>Вход администратора</h1><LoginForm action={loginAdmin} label="Войти в панель" /><Link href="/" className="muted-link">← Вход сотрудника</Link></div></main>;
}
