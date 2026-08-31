import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { agentRateLimited, validAgentToken } from "@/lib/scanner-agent";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";

export const runtime = "nodejs";

const bodySchema = z.object({
  event_id: z.string().uuid(),
  barcode: z.string().trim().regex(/^\d{8,512}$/),
  employee_identifier: z.string().trim().min(1).max(120),
  duration_ms: z.number().int().min(0).max(600_000),
  input_metadata: z.object({ average_interval_ms: z.number().min(0).max(600_000), source: z.literal("windows-agent") }).optional(),
  average_interval_ms: z.number().min(0).max(600_000).optional(),
  source: z.literal("windows-agent").optional(),
  scanner_device: z.string().min(1).max(1024),
  scanned_at: z.string().datetime({ offset: true }).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  shift_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const config = env();
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-agent-token");
  if (!validAgentToken(token, config.SCANNER_AGENT_API_TOKEN)) {
    return NextResponse.json({ success: false, result: "rejected", message: "Неверный токен агента" }, { status: 401 });
  }
  const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "scanner-agent";
  if (agentRateLimited(clientKey)) {
    return NextResponse.json({ success: false, result: "rejected", message: "Слишком много запросов" }, { status: 429 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, result: "rejected", message: "Некорректные данные скана" }, { status: 400 });
  }

  const db = createAdminClient();
  const identifier = parsed.data.employee_identifier;
  let employeeId: string | undefined;
  if (z.string().uuid().safeParse(identifier).success) {
    const { data } = await db.from("employees").select("id").eq("id", identifier).eq("active", true).maybeSingle();
    employeeId = data?.id;
  } else {
    const { data, error } = await db.from("employees").select("id,pin_hash").eq("active", true);
    if (error) logSupabaseError("agent employee lookup failed", error);
    for (const employee of data ?? []) {
      if (await bcrypt.compare(identifier, employee.pin_hash)) { employeeId = employee.id; break; }
    }
  }
  if (!employeeId) {
    return NextResponse.json({ success: false, result: "rejected", message: "Сотрудник не найден или отключён" }, { status: 403 });
  }

  const { data, error } = await db.rpc("register_agent_scan", {
    p_event_id: parsed.data.event_id,
    p_barcode: parsed.data.barcode,
    p_employee_id: employeeId,
    p_duration_ms: parsed.data.duration_ms,
    p_scanner_device: parsed.data.scanner_device,
    p_timezone: config.WAREHOUSE_TIMEZONE,
    p_shift_id: parsed.data.shift_id,
    p_scanned_at_client: parsed.data.scanned_at ?? parsed.data.timestamp ?? new Date().toISOString(),
    p_input_metadata: parsed.data.input_metadata ?? { average_interval_ms: parsed.data.average_interval_ms ?? 0, source: parsed.data.source ?? "windows-agent" },
  });
  if (error || !data?.[0]) {
    if (error) logSupabaseError("agent scan failed", error);
    return NextResponse.json({ success: false, result: "rejected", message: "Не удалось зарегистрировать скан" }, { status: 500 });
  }
  const row = data[0];
  return NextResponse.json({
    success: row.result === "counted",
    result: row.result,
    ordersToday: Number(row.orders_today),
    earningsToday: Number(row.earnings_today),
    message: row.message,
    lastIntervalSeconds: row.last_interval_seconds == null ? null : Number(row.last_interval_seconds),
    medianIntervalSeconds: row.median_interval_seconds == null ? null : Number(row.median_interval_seconds),
    intervalCount: Number(row.interval_count ?? 0),
  });
}

export function GET() {
  return NextResponse.json({ success: false, result: "rejected", message: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
}
