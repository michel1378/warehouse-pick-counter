import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions";
import { WorkClock } from "@/components/WorkClock";
import { utcRange, warehouseToday } from "@/lib/dates";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase";

type Row = { id:string; started_at:string; ended_at:string|null };
export default async function AttendancePage() {
  const session=await getSession(); if(!session||session.role!=="employee") redirect("/");
  if(!session.permissions?.includes("attendance")) redirect("/scan");
  const range=utcRange(warehouseToday(),warehouseToday()); const db=createAdminClient();
  const {data}=await db.from("employee_time_sessions").select("id,started_at,ended_at").eq("employee_id",session.sub).lt("started_at",range.toUtc).or(`ended_at.is.null,ended_at.gt.${range.fromUtc}`).order("started_at");
  const rows=(data??[]) as Row[]; const active=rows.find(x=>!x.ended_at);
  const completedSeconds=rows.filter(x=>x.ended_at).reduce((sum,x)=>sum+(new Date(x.ended_at!).getTime()-Math.max(new Date(x.started_at).getTime(),new Date(range.fromUtc).getTime()))/1000,0);
  return <main className="scan-page"><header className="scan-header"><div><p className="eyebrow">Отметки</p><h1>{session.name}</h1></div><div className="employee-links">{session.permissions.includes("picking")&&<Link href="/scan">Сборка заказов</Link>}<form action={logout}><button className="secondary">Выйти</button></form></div></header><WorkClock startedAt={active?.started_at??null} completedSeconds={completedSeconds}/><section className="card section"><h2>Сегодняшние интервалы</h2>{rows.length?<ul className="session-list">{rows.map(x=><li key={x.id}><strong>{new Date(x.started_at).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}</strong><span>— {x.ended_at?new Date(x.ended_at).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}):"сейчас"}</span></li>)}</ul>:<p className="period">Сегодня отметок ещё нет.</p>}</section></main>;
}
