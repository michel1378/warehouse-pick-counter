import { redirect } from "next/navigation";
import { PeriodFilter } from "@/components/PeriodFilter";
import { presetRange, utcRange } from "@/lib/dates";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase";

type Search=Promise<{preset?:string;from?:string;to?:string}>;
type EmployeeRow={id:string;name:string}; type TimeRow={id:string;employee_id:string;started_at:string;ended_at:string|null};
const valid=(x?:string)=>/^\d{4}-\d{2}-\d{2}$/.test(x??"");
const human=(seconds:number)=>{const m=Math.max(0,Math.floor(seconds/60));return `${Math.floor(m/60)} ч ${String(m%60).padStart(2,"0")} мин`;};

export default async function AdminAttendancePage({searchParams}:{searchParams:Search}){
  const session=await getSession();if(!session||session.role!=="admin")redirect("/admin/login");
  const q=await searchParams,preset=q.preset??"today",fallback=presetRange(preset),from=preset==="custom"&&valid(q.from)?q.from!:fallback.from,to0=preset==="custom"&&valid(q.to)?q.to!:fallback.to,to=from<=to0?to0:from,range=utcRange(from,to);
  const db=createAdminClient();const [{data:employees},{data:sessions,error}]=await Promise.all([db.from("employees").select("id,name").eq("role","online").eq("active",true).order("name"),db.from("employee_time_sessions").select("id,employee_id,started_at,ended_at").lt("started_at",range.toUtc).or(`ended_at.is.null,ended_at.gt.${range.fromUtc}`).order("started_at",{ascending:false})]);
  const rows=(sessions??[]) as TimeRow[],start=new Date(range.fromUtc).getTime(),end=new Date(range.toUtc).getTime(),now=Date.now();
  return <><p className="eyebrow">Учёт времени</p><h1>Отметки</h1><PeriodFilter preset={preset} from={from} to={to} basePath="/admin/attendance"/>{error?<p className="error">Не удалось загрузить отметки</p>:<div className="attendance-grid">{((employees??[]) as EmployeeRow[]).map(e=>{const own=rows.filter(x=>x.employee_id===e.id),active=own.find(x=>!x.ended_at),total=own.reduce((s,x)=>s+(Math.min(x.ended_at?new Date(x.ended_at).getTime():now,end)-Math.max(new Date(x.started_at).getTime(),start))/1000,0);return <article className="card section" key={e.id}><div className="employee-status"><h2>{e.name}</h2><span className={`badge ${active?"active":""}`}>{active?"Работает сейчас":"Не работает"}</span></div>{active&&<p className="period">Текущая сессия с {new Date(active.started_at).toLocaleString("ru-RU",{hour:"2-digit",minute:"2-digit",day:"2-digit",month:"2-digit"})}</p>}<p className="total-time">{human(total)}</p><ul className="session-list">{own.map(x=><li key={x.id}><span>{new Date(x.started_at).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})} — {x.ended_at?new Date(x.ended_at).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"сейчас"}</span><strong>{human((Math.min(x.ended_at?new Date(x.ended_at).getTime():now,end)-Math.max(new Date(x.started_at).getTime(),start))/1000)}</strong></li>)}</ul></article>;})}</div>}</>;
}
