import { NextResponse } from "next/server";
import { logSupabaseError } from "@/lib/supabase";
export function databaseFailure(error: { code?: string; message?: string }) {
  logSupabaseError("scanner backend", error);
  const configuration = /^(42|P0002|PGRST20|PGRST10|configuration)/.test(error.code ?? "");
  return NextResponse.json({ ready: false, code: configuration ? "schema_mismatch" : "database_unavailable", message: configuration ? "Требуется обновление конфигурации backend" : "База временно недоступна" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
