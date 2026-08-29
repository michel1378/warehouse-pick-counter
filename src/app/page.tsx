import Link from "next/link";
import { redirect } from "next/navigation";
import { loginEmployee } from "@/app/actions";
import { LoginForm } from "@/components/LoginForm";
import { getSession } from "@/lib/session";

export default async function LoginPage() {
  const session = await getSession();
  if (session?.role === "employee") redirect("/scan");
  if (session?.role === "admin") redirect("/admin");
  return (
    <main className="center-page">
      <div className="login-wrap">
        <p className="eyebrow">Склад</p><h1>Вход сотрудника</h1>
        <LoginForm action={loginEmployee} label="Войти" />
        <Link href="/admin/login" className="muted-link">Вход администратора</Link>
      </div>
    </main>
  );
}
