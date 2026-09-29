import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { agentRateLimited, validAgentToken } from "@/lib/scanner-agent";
import { createAdminClient } from "@/lib/supabase";
import { databaseFailure } from "@/lib/agent-errors";
import { normalizeBarcode } from "@/lib/barcode";
export const runtime = "nodejs";
const schema = z.object({ event_id: z.string().uuid(), barcode: z.string().max(4096), employee_identifier: z.string().min(1).max(120), duration_ms: z.number().int().min(0).max(600000), scanner_device: z.string().min(1).max(1024), shift_id: z.string().uuid().nullable().optional(), scanned_at: z.string().datetime({ offset: true }).optional(), timestamp: z.string().datetime({ offset: true }).optional(), input_metadata: z.object({ average_interval_ms: z.number().min(0).max(600000), source: z.literal("windows-agent") }).optional() });
function requestId(r: NextRequest) { const value = r.headers.get("x-request-id"); return value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined; }
function authorized(r: NextRequest) { return validAgentToken(r.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? r.headers.get("x-agent-token"), env().SCANNER_AGENT_API_TOKEN); }
export async function GET(request: NextRequest) {
  const started = performance.now();
  try {
    if (!authorized(request)) return NextResponse.json({ ready: false, code: "invalid_token" }, { status: 401 });
    const { data, error } = await createAdminClient().rpc("scanner_scan_v2", { p_request: {}, p_probe: true });
    if (error) return databaseFailure(error);
    if (data?.ready !== true || data?.version !== 2) return databaseFailure({ code: "PGRST202" });
    console.info(JSON.stringify({ endpoint: "scan/readiness", readiness: "ready", request_id: requestId(request), latency_ms: Math.round(performance.now() - started) }));
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch { return databaseFailure({ code: "configuration", message: "Readiness initialization failed" }); }
}
export async function POST(request: NextRequest) {
  const started = performance.now();
  try {
    if (!authorized(request)) return NextResponse.json({ code: "invalid_token", message: "Неверный токен агента" }, { status: 401 });
    if (agentRateLimited(request.headers.get("x-forwarded-for")?.split(",")[0] ?? "agent")) return NextResponse.json({ code: "rate_limited" }, { status: 429 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ code: "invalid_envelope", message: "Некорректный формат события агента" }, { status: 422 });
    const body = parsed.data, db = createAdminClient();
    let employeeId: string | null = z.string().uuid().safeParse(body.employee_identifier).success ? body.employee_identifier : null;
    if (!employeeId) {
      const { data, error } = await db.from("employees").select("id,pin_hash").eq("active", true);
      if (error) return databaseFailure(error);
      for (const employee of data ?? []) if (await bcrypt.compare(body.employee_identifier, employee.pin_hash)) { employeeId = employee.id; break; }
    }
    // PostgreSQL text/jsonb cannot hold NUL or unpaired UTF-16 surrogates. Preserve
    // the rejection, not an unrepresentable value that would poison queue replay.
    const barcode = /\u0000|[\uD800-\uDFFF]/u.test(body.barcode) ? "[invalid encoding]" : normalizeBarcode(body.barcode);
    const { data, error } = await db.rpc("scanner_scan_v2", { p_request: { ...body, employee_identifier: undefined, employee_id: employeeId, barcode, scanned_at: body.scanned_at ?? body.timestamp ?? new Date().toISOString(), timezone: env().WAREHOUSE_TIMEZONE }, p_probe: false });
    if (error) return databaseFailure(error);
    if (!data?.acknowledged || data.eventId !== body.event_id) return databaseFailure({ code: "PGRST202" });
    console.info(JSON.stringify({ endpoint: "scan", request_id: requestId(request), event_id: body.event_id, result: data.result, reason: data.reason, latency_ms: Math.round(performance.now() - started) }));
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch { return databaseFailure({ message: "Scan request failed" }); }
}
