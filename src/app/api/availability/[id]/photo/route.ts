import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const failure = (status: number) => new Response(null, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return failure(401);
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const kind = search.get("kind"); const index = Number(search.get("index") ?? "0");
  if (!z.string().uuid().safeParse(id).success || !["chart", "model"].includes(kind ?? "") || !Number.isInteger(index) || index < 0 || index > 5) return failure(400);
  let query = createAdminClient().from("size_products").select(kind === "chart" ? "revision,selected:stock_chart" : `revision,selected:stock_models->>${index}`).eq("id", id);
  if (session.role !== "admin") query = query.eq("active", true);
  const { data, error } = await query.maybeSingle();
  if (error) return failure(503);
  const row = data as unknown as { revision: number; selected: string } | null;
  if (!row?.selected?.startsWith("data:image/jpeg;base64,")) return failure(404);
  const etag = `"${id}-${row.revision}-${kind}-${index}"`;
  const headers = { "Content-Type": "image/jpeg", "Cache-Control": "private, no-cache", Vary: "Cookie", ETag: etag, "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(Buffer.from(row.selected.split(",")[1], "base64"), { headers });
}
