import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response(null, { status: 400 });
  const indexValue = Number(new URL(request.url).searchParams.get("index") ?? "0");
  const index = Number.isInteger(indexValue) && indexValue >= 0 && indexValue < 6 ? indexValue : 0;
  let query = createAdminClient().from("size_products").select("photo,photos").eq("id", id);
  if (session.role !== "admin") query = query.eq("active", true);
  const { data, error } = await query.maybeSingle();
  if (error) return new Response(null, { status: 503 });
  const candidate = data?.photos?.[index] ?? (index === 0 ? data?.photo : undefined);
  if (!candidate?.startsWith("data:image/jpeg;base64,")) return new Response(null, { status: 404 });
  return new Response(Buffer.from(candidate.slice("data:image/jpeg;base64,".length), "base64"), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
