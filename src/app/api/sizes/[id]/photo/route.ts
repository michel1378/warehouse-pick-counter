import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const failure = (status: number) => new Response(null, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return failure(401);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return failure(400);
  const indexValue = Number(new URL(request.url).searchParams.get("index") ?? "0");
  const index = Number.isInteger(indexValue) && indexValue >= 0 && indexValue < 6 ? indexValue : 0;
  let query = createAdminClient().from("size_products").select(index === 0 ? "revision,photo" : `revision,selected:photos->>${index}`).eq("id", id);
  if (session.role !== "admin") query = query.eq("active", true);
  const { data, error } = await query.maybeSingle();
  if (error) return failure(503);
  // Only the requested JSON element crosses the database connection, not the gallery.
  const row = data as unknown as { revision: number; selected?: string; photo?: string } | null;
  const candidate = row?.selected ?? (index === 0 ? row?.photo : undefined);
  if (!candidate?.startsWith("data:image/jpeg;base64,")) return failure(404);
  const etag = '"' + id + '-' + row!.revision + '-' + index + '"';
  const headers = { "Content-Type": "image/jpeg", "Cache-Control": "private, no-cache", "ETag": etag, "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
  // Authentication and active visibility are checked before every conditional response.
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(Buffer.from(candidate.slice("data:image/jpeg;base64,".length), "base64"), {
    headers,
  });
}
