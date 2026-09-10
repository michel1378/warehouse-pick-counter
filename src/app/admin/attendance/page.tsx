import { redirect } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { AttendanceInterval } from "@/components/AttendanceInterval";
import { AttendanceFeedback } from "@/components/AttendanceFeedback";
import { PeriodFilter } from "@/components/PeriodFilter";
import { presetRange, utcRange, formatWarehouseDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase";

type Search = Promise<{ preset?: string; from?: string; to?: string }>;
type Edit = { id: string; old_started_at: string; old_ended_at: string | null; new_started_at: string; new_ended_at: string | null; edited_at: string; edited_by: string; reason: string | null };
type TimeRow = { id: string; employee_id: string; started_at: string; ended_at: string | null; employee_time_session_edits: Edit[] };
const valid = (x?: string) => /^\d{4}-\d{2}-\d{2}$/.test(x ?? "");
const human = (seconds: number) => { const m = Math.max(0, Math.floor(seconds / 60)); return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, "0")} мин`; };
const intervalLabel = (start: string, end: string | null) => `${formatWarehouseDateTime(start)} — ${end ? formatWarehouseDateTime(end) : "сейчас"}`;

export default async function AdminAttendancePage({ searchParams }: { searchParams: Search }) {
  const session = await getSession();
  if (!session || session.role !== "admin") redirect("/admin/login");
  const q = await searchParams, preset = q.preset ?? "today", fallback = presetRange(preset);
  const from = preset === "custom" && valid(q.from) ? q.from! : fallback.from;
  const to0 = preset === "custom" && valid(q.to) ? q.to! : fallback.to, to = from <= to0 ? to0 : from;
  const range = utcRange(from, to), zone = env().WAREHOUSE_TIMEZONE, db = createAdminClient();
  const [employeesResult, sessionsResult, adminsResult, activeResult] = await Promise.all([
    db.from("employees").select("id,name,role,active").order("name"),
    db.from("employee_time_sessions").select("id,employee_id,started_at,ended_at,employee_time_session_edits(*)")
      .lt("started_at", range.toUtc).or(`ended_at.is.null,ended_at.gt.${range.fromUtc}`).order("started_at", { ascending: false }),
    db.from("admins").select("id,name"),
    db.from("employee_time_sessions").select("employee_id,started_at").is("ended_at", null),
  ]);
  const error = employeesResult.error || sessionsResult.error || adminsResult.error || activeResult.error;
  const rows = (sessionsResult.data ?? []) as TimeRow[];
  const start = new Date(range.fromUtc).getTime(), end = new Date(range.toUtc).getTime(), now = Date.now();
  const seconds = (row: TimeRow) => Math.max(0, (Math.min(row.ended_at ? new Date(row.ended_at).getTime() : now, end) - Math.max(new Date(row.started_at).getTime(), start)) / 1000);
  const local = (value: string) => formatInTimeZone(value, zone, "yyyy-MM-dd'T'HH:mm:ss.SSS");
  return <><p className="eyebrow">Учёт времени</p><h1>Отметки</h1>
    <PeriodFilter preset={preset} from={from} to={to} basePath="/admin/attendance" />
    <AttendanceFeedback>{error ? <p className="error">Не удалось загрузить отметки и историю изменений</p> : <div className="attendance-grid">
      {(employeesResult.data ?? []).map(employee => {
        const own = rows.filter(row => row.employee_id === employee.id);
        const active = activeResult.data?.find(row => row.employee_id === employee.id);
        if (!own.length && !active && !(employee.role === "online" && employee.active)) return null;
        return <article className="card section" key={employee.id}>
          <div className="employee-status"><h2>{employee.name}</h2><span className={`badge ${active ? "active" : ""}`}>{active ? "Работает сейчас" : "Не работает"}</span></div>
          {active && <p className="period">Текущая сессия с {formatWarehouseDateTime(active.started_at)}</p>}
          <p className="total-time">{human(own.reduce((sum, row) => sum + seconds(row), 0))}</p>
          <ul className="session-list">{own.map(row => <AttendanceInterval key={row.id} employee={employee.name} zone={zone} row={{
            id: row.id, started_at: row.started_at, ended_at: row.ended_at,
            localStart: local(row.started_at), localEnd: row.ended_at ? local(row.ended_at) : null,
            label: intervalLabel(row.started_at, row.ended_at), duration: human(seconds(row)),
            edits: row.employee_time_session_edits.slice().sort((a, b) => b.edited_at.localeCompare(a.edited_at)).map(edit => ({
              id: edit.id, at: formatWarehouseDateTime(edit.edited_at),
              by: adminsResult.data?.find(admin => admin.id === edit.edited_by)?.name ?? edit.edited_by,
              before: intervalLabel(edit.old_started_at, edit.old_ended_at), after: intervalLabel(edit.new_started_at, edit.new_ended_at), reason: edit.reason,
            })),
          }} />)}</ul>
        </article>;
      })}
    </div>}</AttendanceFeedback>
  </>;
}
