"use client";
import { useContext, useState, useTransition } from "react";
import { AttendanceFeedbackContext } from "@/components/AttendanceFeedback";
import { useRouter } from "next/navigation";
import { editAttendance } from "@/app/admin/attendance/actions";

export type AttendanceIntervalData = {
  id: string; started_at: string; ended_at: string | null;
  localStart: string; localEnd: string | null; label: string; duration: string;
  edits: { id: string; at: string; by: string; before: string; after: string; reason: string | null }[];
};
export function AttendanceInterval({ row, employee, zone }: { row: AttendanceIntervalData; employee: string; zone: string }) {
  const router = useRouter();
  const notify = useContext(AttendanceFeedbackContext);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ error?: string; ok?: string }>({});
  const [pending, startTransition] = useTransition();
  function submit(form: FormData, finishNow = false) {
    const local = (prefix: string) => {
      const time = String(form.get(`${prefix}Time`));
      const [whole, fraction = ""] = time.split(".");
      return `${form.get(`${prefix}Date`)}T${whole.length === 5 ? `${whole}:00` : whole}.${fraction.padEnd(3, "0")}`;
    };
    setMessage({});
    notify("");
    startTransition(async () => {
      try {
        const result = await editAttendance({
          id: row.id, expectedStart: row.started_at, expectedEnd: row.ended_at,
          start: finishNow ? row.localStart : local("start"), end: row.ended_at && !finishNow ? local("end") : null,
          reason: String(form.get("reason") ?? ""), finishNow,
        });
        setMessage(result);
        if (result.ok) { notify(result.ok); setEditing(false); router.refresh(); }
      } catch { setMessage({ error: "Не удалось сохранить изменения. Попробуйте ещё раз." }); }
    });
  }
  return <li className="attendance-interval"><div className="interval-summary"><span>{row.label}</span><strong>{row.duration}</strong></div>
    {row.edits.length > 0 && <><small className="badge">Изменено администратором</small><details><summary>История изменений ({row.edits.length})</summary>
      {row.edits.map(edit => <div className="interval-audit" key={edit.id}><strong>{edit.at} · {edit.by}</strong><p>Было: {edit.before}</p><p>Стало: {edit.after}</p>{edit.reason && <p>Причина: {edit.reason}</p>}</div>)}
    </details></>}
    {!editing ? <button type="button" className="secondary" onClick={() => { setMessage({}); setEditing(true); }}>Редактировать</button> :
      <form className="interval-edit" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget)); }}>
        <strong>Сотрудник: {employee}</strong><small>Часовой пояс: {zone}</small>
        <fieldset disabled={pending}><legend>Начало работы</legend>
          <label>Дата <input type="date" name="startDate" required defaultValue={row.localStart.slice(0, 10)} /></label>
          <label>Время <input type="time" name="startTime" step="0.001" required defaultValue={row.localStart.slice(11)} /></label>
        </fieldset>
        {row.localEnd ? <fieldset disabled={pending}><legend>Окончание работы</legend>
          <label>Дата <input type="date" name="endDate" required defaultValue={row.localEnd.slice(0, 10)} /></label>
          <label>Время <input type="time" name="endTime" step="0.001" required defaultValue={row.localEnd.slice(11)} /></label>
        </fieldset> : <p>Сессия активна. Окончание пока не задано.</p>}
        <label>Причина корректировки (необязательно)<textarea name="reason" maxLength={2000} disabled={pending} /></label>
        <div className="interval-buttons"><button className="primary" disabled={pending}>Сохранить</button><button type="button" className="secondary" disabled={pending} onClick={() => setEditing(false)}>Отмена</button>
          {!row.ended_at && <button type="button" className="danger" disabled={pending} onClick={event => {
            const form = event.currentTarget.form;
            if (form && window.confirm("Завершить сессию сейчас? Несохраненные изменения начала не применятся.")) submit(new FormData(form), true);
          }}>Завершить сейчас</button>}
        </div>
      </form>}
    {message.error && <p className="error" role="alert">{message.error} <button type="button" className="secondary" onClick={() => { setEditing(false); router.refresh(); }}>Обновить данные</button></p>}
  </li>;
}
