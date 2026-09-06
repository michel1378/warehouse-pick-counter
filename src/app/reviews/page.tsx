import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions";
import { ReviewsWorkspace } from "@/components/ReviewsWorkspace";
import { getSession } from "@/lib/session";

export default async function ReviewsPage(){const session=await getSession();if(!session||session.role!=="employee")redirect("/");if(!session.permissions?.includes("reviews"))redirect(session.permissions?.includes("attendance")?"/attendance":"/scan");return <main className="scan-page"><header className="scan-header"><div><p className="eyebrow">Помощник Avito</p><h1>Отзывы</h1></div><div className="employee-links">{session.permissions.includes("picking")&&<Link href="/scan">Сборка заказов</Link>}{session.permissions.includes("attendance")&&<Link href="/attendance">Отметки</Link>}<form action={logout}><button className="secondary">Выйти</button></form></div></header><ReviewsWorkspace/></main>}
