import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { validAgentToken } from "@/lib/scanner-agent";

export function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  return NextResponse.json({ ok: validAgentToken(token, env().SCANNER_AGENT_API_TOKEN) }, {
    status: validAgentToken(token, env().SCANNER_AGENT_API_TOKEN) ? 200 : 401,
    headers: { "Cache-Control": "no-store" },
  });
}
