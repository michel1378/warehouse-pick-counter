import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { agentRateLimited, validAgentToken } from "@/lib/scanner-agent";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  if (!validAgentToken(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null, env().SCANNER_AGENT_API_TOKEN))
    return NextResponse.json({ message: "Неверный токен" }, { status: 401 });
  if (agentRateLimited(`employee:${request.headers.get("x-forwarded-for") ?? "agent"}`))
    return NextResponse.json({ message: "Повторите позже" }, { status: 429 });
  const parsed = z.object({ pin: z.string().trim().min(4).max(32) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Введите PIN" }, { status: 400 });
  const { data, error } = await createAdminClient().from("employees").select("id,name,pin_hash,role,permissions").eq("active", true);
  if (error) { logSupabaseError("agent employee resolve", error); return NextResponse.json({ message: "База недоступна" }, { status: 503 }); }
  for (const row of data ?? []) {
    if (!await bcrypt.compare(parsed.data.pin, row.pin_hash)) continue;
    const permissions = row.permissions ?? (row.role === "online" ? ["attendance"] : ["picking"]);
    if (!permissions.includes("picking")) break;
    return NextResponse.json({ id: row.id, name: row.name, role: row.role, permissions }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ message: "Неверный PIN или нет доступа к сборке" }, { status: 403 });
}
