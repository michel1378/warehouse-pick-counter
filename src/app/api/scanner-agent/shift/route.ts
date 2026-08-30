import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { validAgentToken } from "@/lib/scanner-agent";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";

export const runtime = "nodejs";
const bodySchema = z.object({ employee_identifier: z.string().trim().min(1).max(120), action: z.enum(["start", "pause", "resume", "finish"]) });

async function employee(identifier: string) {
  const db = createAdminClient();
  if (z.string().uuid().safeParse(identifier).success) return (await db.from("employees").select("id,name").eq("id", identifier).eq("active", true).maybeSingle()).data;
  const { data } = await db.from("employees").select("id,name,pin_hash").eq("active", true);
  for (const row of data ?? []) if (await bcrypt.compare(identifier, row.pin_hash)) return { id: row.id, name: row.name };
  return null;
}
function authorized(r: NextRequest) { const token = r.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? r.headers.get("x-agent-token"); return validAgentToken(token, env().SCANNER_AGENT_API_TOKEN); }
async function view(employeeId: string, name: string, shift?: Record<string, unknown> | null) {
  const db = createAdminClient();
  let current = shift;
  if (!current) current = (await db.from("work_shifts").select("*").eq("employee_id", employeeId).is("ended_at", null).maybeSingle()).data;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("scans").select("id", { count: "exact", head: true }).eq("employee_id", employeeId).gte("scanned_at", today.toISOString());
  const price = Number((await db.from("settings").select("price_per_order").eq("id", 1).single()).data?.price_per_order ?? 0);
  if (!current) return { employeeName: name, status: "none", orders: count ?? 0, earnings: (count ?? 0) * price, activeSeconds: 0, totalSeconds: 0, pauseSeconds: 0, pauseCount: 0 };
  const end = current.ended_at ? new Date(String(current.ended_at)) : new Date(), started = new Date(String(current.started_at)); let pauseSeconds = Number(current.pause_seconds), pauseStartedAt: string | null = null;
  if (current.status === "paused") { const open = (await db.from("work_shift_pauses").select("started_at").eq("shift_id", String(current.id)).is("ended_at", null).maybeSingle()).data; if (open) { pauseStartedAt = open.started_at; pauseSeconds += Math.max(0, Math.floor((end.getTime() - new Date(open.started_at).getTime()) / 1000)); } }
  const totalSeconds = Math.max(0, Math.floor((end.getTime() - started.getTime()) / 1000)), activeSeconds = current.status === "finished" ? Number(current.active_seconds) : Math.max(0, totalSeconds - pauseSeconds);
  const metrics = current.status === "finished" ? null : (await db.rpc("shift_order_metrics", { p_shift_id: current.id })).data?.[0];
  return { id: current.id, employeeName: name, status: current.status, startedAt: current.started_at, endedAt: current.ended_at, pauseStartedAt, activeSeconds, totalSeconds, pauseSeconds, pauseCount: Number(current.pause_count), orders: current.status === "finished" ? Number(current.orders_count) : count ?? 0, earnings: current.status === "finished" ? Number(current.earnings) : (count ?? 0) * price, medianIntervalSeconds: metrics?.median_interval_seconds == null ? (current.median_interval_seconds == null ? null : Number(current.median_interval_seconds)) : Number(metrics.median_interval_seconds), intervalCount: Number(metrics?.interval_count ?? current.interval_count ?? 0) };
}
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ message: "Неверный токен" }, { status: 401 });
  const found = await employee(request.nextUrl.searchParams.get("employee_identifier") ?? ""); if (!found) return NextResponse.json({ message: "Сотрудник не найден" }, { status: 403 }); return NextResponse.json(await view(found.id, found.name));
}
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ message: "Неверный токен" }, { status: 401 }); const parsed = bodySchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ message: "Некорректный запрос" }, { status: 400 });
  const found = await employee(parsed.data.employee_identifier); if (!found) return NextResponse.json({ message: "Сотрудник не найден" }, { status: 403 }); const db = createAdminClient();
  const lookup = await db.from("work_shifts").select("*").eq("employee_id", found.id).is("ended_at", null).maybeSingle();
  if (lookup.error) { logSupabaseError("shift lookup failed", lookup.error); return NextResponse.json({ message: "Не удалось прочитать смены. Проверьте, что миграция work_shifts применена." }, { status: 503 }); }
  let shift = lookup.data;
  if (parsed.data.action === "start") {
    // Start is idempotent: a repeated click or a lost first response returns the open shift.
    if (!shift) {
      const created = await db.from("work_shifts").insert({ employee_id: found.id, status: "active" }).select("*").single();
      if (created.error || !created.data) { if (created.error) logSupabaseError("shift start failed", created.error); return NextResponse.json({ message: "Не удалось начать смену. Проверьте миграцию work_shifts и права service role." }, { status: 500 }); }
      shift = created.data;
    }
  }
  else if (!shift) return NextResponse.json({ message: "Активная смена не найдена" }, { status: 409 });
  else if (parsed.data.action === "pause" && shift.status === "active") { await db.from("work_shift_pauses").insert({ shift_id: shift.id }); shift = (await db.from("work_shifts").update({ status: "paused", pause_count: Number(shift.pause_count) + 1 }).eq("id", shift.id).select("*").single()).data; }
  else if (parsed.data.action === "resume" && shift.status === "paused") { const pause = (await db.from("work_shift_pauses").select("*").eq("shift_id", shift.id).is("ended_at", null).single()).data; const now = new Date(); const added = pause ? Math.floor((now.getTime() - new Date(pause.started_at).getTime()) / 1000) : 0; if (pause) await db.from("work_shift_pauses").update({ ended_at: now.toISOString() }).eq("id", pause.id); shift = (await db.from("work_shifts").update({ status: "active", pause_seconds: Number(shift.pause_seconds) + added }).eq("id", shift.id).select("*").single()).data; }
  else if (parsed.data.action === "finish") {
    const now = new Date(); if (shift.status === "paused") { const pause = (await db.from("work_shift_pauses").select("*").eq("shift_id", shift.id).is("ended_at", null).single()).data; if (pause) { shift.pause_seconds = Number(shift.pause_seconds) + Math.floor((now.getTime() - new Date(pause.started_at).getTime()) / 1000); await db.from("work_shift_pauses").update({ ended_at: now.toISOString() }).eq("id", pause.id); } }
    const [{ count: orders }, { data: setting }, { data: metricRows }] = await Promise.all([db.from("scans").select("id", { count: "exact", head: true }).eq("shift_id", shift.id), db.from("settings").select("price_per_order").eq("id", 1).single(), db.rpc("shift_order_metrics", { p_shift_id: shift.id })]);
    const metrics = metricRows?.[0];
    const total = Math.floor((now.getTime() - new Date(shift.started_at).getTime()) / 1000), orderCount = orders ?? 0; shift = (await db.from("work_shifts").update({ status: "finished", ended_at: now.toISOString(), active_seconds: Math.max(0, total - Number(shift.pause_seconds)), orders_count: orderCount, earnings: orderCount * Number(setting?.price_per_order ?? 0), median_interval_seconds: metrics?.median_interval_seconds ?? null, average_interval_seconds: metrics?.average_interval_seconds ?? null, interval_count: Number(metrics?.interval_count ?? 0) }).eq("id", shift.id).select("*").single()).data;
  }
  return NextResponse.json(await view(found.id, found.name, shift));
}
