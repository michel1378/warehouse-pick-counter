import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";
import { availabilityFields } from "@/lib/availability";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return json({ error: "Войдите на сайт заново." }, 401);
  if (session.role !== "admin") return json({ error: "Редактирование доступно только администратору." }, 403);
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return json({ error: "Некорректный товар." }, 400);
  const { data, error } = await createAdminClient().from("size_products").select(availabilityFields).eq("id", id).maybeSingle();
  if (error) { logSupabaseError("availability editor read", error); return json({ error: "Не удалось загрузить карточку." }, 503); }
  if (!data) return json({ error: "Товар не найден." }, 404);
  return json({ product: data });
}
