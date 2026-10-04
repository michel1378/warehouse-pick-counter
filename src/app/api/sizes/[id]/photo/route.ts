import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response(null, { status: 400 });
  let query = createAdminClient().from("size_products").select("photo").eq("id", id);
  if (session.role !== "admin") query = query.eq("active", true);
  const { data, error } = await query.maybeSingle();
  if (error) return new Response(null, { status: 503 });
  if (!data?.photo?.startsWith("data:image/jpeg;base64,")) return new Response(null, { status: 404 });
  return new Response(Buffer.from(data.photo.slice("data:image/jpeg;base64,".length), "base64"), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
