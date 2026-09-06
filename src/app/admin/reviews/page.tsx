import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function ReviewsPage(){const session=await getSession();if(!session||session.role!=="admin")redirect("/admin/login");return <><p className="eyebrow">Следующий этап</p><h1>Отзывы</h1><div className="placeholder-grid"><article className="card section"><h2>Сообщения клиентам</h2><p>Подготовка ответа клиенту по описанию ситуации или скриншоту.</p><span className="badge">Скоро</span></article><article className="card section"><h2>Обжалование отзывов</h2><p>Подготовка аргументированного обращения для обжалования негативного отзыва.</p><span className="badge">Скоро</span></article></div></>}
