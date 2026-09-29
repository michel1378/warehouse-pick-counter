import { databaseFailure } from "@/lib/agent-errors";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { validAgentToken } from "@/lib/scanner-agent";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";

export const runtime = "nodejs";
const bodySchema = z.object({ employee_identifier: z.string().trim().min(1).max(120), action: z.enum(["start", "pause", "resume", "finish"]), operation_id: z.string().uuid().optional(), shift_id: z.string().uuid().nullable().optional() });

async function employee(identifier: string) {
  const db = createAdminClient();
  if (z.string().uuid().safeParse(identifier).success) {
    const { data, error } = await db.from("employees").select("id,name").eq("id", identifier).eq("active", true).maybeSingle();
    if (error) { logSupabaseError("agent shift employee lookup", error); return { unavailable: true as const }; }
    return data;
  }
  const { data, error } = await db.from("employees").select("id,name,pin_hash").eq("active", true);
  if (error) { logSupabaseError("agent shift employee lookup", error); return { unavailable: true as const }; }
  for (const row of data ?? []) if (await bcrypt.compare(identifier, row.pin_hash)) return { id: row.id, name: row.name };
  return null;
}
function authorized(r: NextRequest) { const token = r.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? r.headers.get("x-agent-token"); return validAgentToken(token, env().SCANNER_AGENT_API_TOKEN); }
async function view(employeeId: string, name: string, shift?: Record<string, unknown> | null) {
  const db = createAdminClient();
  let current = shift;
  if (!current) { const lookup = await db.from("work_shifts").select("*").eq("employee_id", employeeId).is("ended_at", null).maybeSingle(); if (lookup.error) { logSupabaseError("agent shift view", lookup.error); return null; } current = lookup.data; }
  const zone = env().WAREHOUSE_TIMEZONE; const today = fromZonedTime(formatInTimeZone(new Date(), zone, "yyyy-MM-dd") + "T00:00:00", zone);
  const { count, error: countError } = await db.from("scans").select("id", { count: "exact", head: true }).eq("employee_id", employeeId).gte("scanned_at", today.toISOString());
  const setting = await db.from("settings").select("price_per_order").eq("id", 1).single(); if (countError || setting.error) { logSupabaseError("agent shift totals", (countError ?? setting.error)!); return null; } const price = Number(setting.data?.price_per_order ?? 0);
  if (!current) return { employeeName: name, status: "none", orders: count ?? 0, earnings: (count ?? 0) * price, activeSeconds: 0, totalSeconds: 0, pauseSeconds: 0, pauseCount: 0 };
  const end = current.ended_at ? new Date(String(current.ended_at)) : new Date(), started = new Date(String(current.started_at)); let pauseSeconds = Number(current.pause_seconds), pauseStartedAt: string | null = null;
  if (current.status === "paused") { const pause = await db.from("work_shift_pauses").select("started_at").eq("shift_id", String(current.id)).is("ended_at", null).maybeSingle(); if (pause.error) { logSupabaseError("agent shift pause", pause.error); return null; } const open = pause.data; if (open) { pauseStartedAt = open.started_at; pauseSeconds += Math.max(0, Math.floor((end.getTime() - new Date(open.started_at).getTime()) / 1000)); } }
  const totalSeconds = Math.max(0, Math.floor((end.getTime() - started.getTime()) / 1000)), activeSeconds = current.status === "finished" ? Number(current.active_seconds) : Math.max(0, totalSeconds - pauseSeconds);
  const metricResult = current.status === "finished" ? null : await db.rpc("shift_order_metrics", { p_shift_id: current.id }); if (metricResult?.error) { logSupabaseError("agent shift metrics", metricResult.error); return null; } const metrics = metricResult?.data?.[0];
  return { id: current.id, employeeName: name, status: current.status, startedAt: current.started_at, endedAt: current.ended_at, pauseStartedAt, activeSeconds, totalSeconds, pauseSeconds, pauseCount: Number(current.pause_count), orders: current.status === "finished" ? Number(current.orders_count) : count ?? 0, earnings: current.status === "finished" ? Number(current.earnings) : (count ?? 0) * price, medianIntervalSeconds: metrics?.median_interval_seconds == null ? (current.median_interval_seconds == null ? null : Number(current.median_interval_seconds)) : Number(metrics.median_interval_seconds), intervalCount: Number(metrics?.interval_count ?? current.interval_count ?? 0) };
}
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ message: "Неверный токен" }, { status: 401 });
  const found = await employee(request.nextUrl.searchParams.get("employee_identifier") ?? ""); if (found && "unavailable" in found) return NextResponse.json({ message: "База временно недоступна" }, { status: 503 }); if (!found) return NextResponse.json({ message: "Сотрудник не найден" }, { status: 403 }); const state = await view(found.id, found.name); return NextResponse.json(state ?? { message: "База временно недоступна" }, { status: state ? 200 : 503 });
}
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ code: "invalid_token", message: "Неверный токен" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Некорректный запрос" }, { status: 400 });
  const found = await employee(parsed.data.employee_identifier);
  if (found && "unavailable" in found) return databaseFailure({ message: "Employee lookup unavailable" });
  if (!found) return NextResponse.json({ message: "Сотрудник не найден" }, { status: 403 });
  const { data, error } = await createAdminClient().rpc("scanner_shift_action", { p_employee: found.id, p_action: parsed.data.action, p_operation: parsed.data.operation_id ?? null, p_shift: parsed.data.shift_id ?? null });
  if (error) return databaseFailure(error);
  if (data?.error) return NextResponse.json({ message: data.error }, { status: 409 });
  const state = await view(found.id, found.name, data);
  return state ? NextResponse.json(state, { headers: { "Cache-Control": "no-store" } }) : databaseFailure({ message: "Shift view unavailable" });
}
