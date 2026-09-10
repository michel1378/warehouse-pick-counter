"use server";

import { revalidatePath } from "next/cache";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";

const schema = z.object({
  id: z.string().uuid(),
  expectedStart: z.string().datetime({ offset: true }),
  expectedEnd: z.string().datetime({ offset: true }).nullable(),
  start: z.string(), end: z.string().nullable(),
  finishNow: z.boolean(), reason: z.string().trim().max(2000),
});

function localToUtc(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/.test(value)) throw new Error("INVALID_DATE");
  const zone = env().WAREHOUSE_TIMEZONE;
  const date = fromZonedTime(value, zone);
  if (!Number.isFinite(date.getTime()) || formatInTimeZone(date, zone, "yyyy-MM-dd'T'HH:mm:ss.SSS") !== value) throw new Error("INVALID_DATE");
  return date.toISOString();
}

export async function editAttendance(input: z.infer<typeof schema>): Promise<{ error?: string; ok?: string }> {
  const session = await getSession();
  if (!session || session.role !== "admin") return { error: "Редактирование доступно только администратору" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Проверьте поля формы. Причина — не более 2000 символов." };
  const v = parsed.data;
  let start: string, end: string | null;
  try {
    start = v.finishNow ? v.expectedStart : localToUtc(v.start);
    end = v.finishNow || v.end === null ? null : localToUtc(v.end);
    // PostgreSQL stores microseconds; keep them when a field was not edited.
    if (Date.parse(start) === Date.parse(v.expectedStart)) start = v.expectedStart;
    if (end && v.expectedEnd && Date.parse(end) === Date.parse(v.expectedEnd)) end = v.expectedEnd;
  } catch { return { error: "Укажите корректные дату и время" }; }
  const { error } = await createAdminClient().rpc("admin_edit_employee_time_session", {
    p_session_id: v.id, p_admin_id: session.sub,
    p_expected_started_at: v.expectedStart, p_expected_ended_at: v.expectedEnd,
    p_started_at: start, p_ended_at: end, p_finish_now: v.finishNow, p_reason: v.reason,
  });
  if (error) {
    const messages: Record<string, string> = {
      ADMIN_REQUIRED: "Редактирование доступно только действующему администратору",
      SESSION_NOT_FOUND: "Интервал не найден",
      SESSION_CHANGED: "Интервал уже изменился. Обновите данные и откройте форму заново.",
      ACTIVE_STATE_CHANGE: "Активную сессию можно завершить только кнопкой «Завершить сейчас»",
      INVALID_INTERVAL: "Начало должно быть раньше окончания. Будущее время недопустимо.",
      INTERVAL_OVERLAP: "Интервал пересекается с другим интервалом сотрудника",
      SESSION_ALREADY_ACTIVE: "У сотрудника уже есть активная сессия",
    };
    logSupabaseError("attendance edit failed", error);
    return { error: messages[error.message] ?? "Не удалось сохранить изменения" };
  }
  revalidatePath("/admin/attendance");
  revalidatePath("/attendance");
  return { ok: "Изменения сохранены" };
}
