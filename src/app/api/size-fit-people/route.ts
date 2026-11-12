import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";
import { personInputSchema } from "@/lib/size-fittings";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
const fields = "id,slot,label,height,weight,shoulders,chest_circumference,waist_circumference,revision";
export async function GET() {
  if ((await getSession())?.role !== "admin") return json({ error: "Профили доступны только администратору." }, 403);
  const { data, error } = await createAdminClient().from("size_fit_people").select(fields).order("slot");
  if (error) { logSupabaseError("fit people read", error); return json({ error: "Не удалось загрузить профили примерки." }, 503); }
  return json({ people: data });
}
export async function POST(request: Request) {
  if ((await getSession())?.role !== "admin") return json({ error: "Менять профили может только администратор." }, 403);
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    if (!["https:", "http:"].includes(origin.protocol) || origin.host !== request.headers.get("host")) return json({ error: "Недопустимый источник запроса." }, 403);
  } catch { return json({ error: "Недопустимый источник запроса." }, 403); }
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Нет данных профиля." }, 400);
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 8000) { await reader.cancel(); return json({ error: "Слишком большой запрос." }, 413); } chunks.push(value); }
    const parsed = personInputSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return json({ error: "Проверьте рост, вес и мерки тела. Рост и вес обязательны." }, 400);
    const { id, revision, ...values } = parsed.data;
    const { data, error } = await createAdminClient().from("size_fit_people").update({ ...values, revision: revision + 1, updated_at: new Date().toISOString() }).eq("id", id).eq("revision", revision).select(fields).maybeSingle();
    if (error) { logSupabaseError("fit person save", error); return json({ error: "Не удалось сохранить профиль." }, 503); }
    if (!data) return json({ error: "Профиль изменён в другом окне. Обновите профили и повторите правки." }, 409);
    return json({ person: data });
  } catch { return json({ error: "Некорректные данные профиля." }, 400); }
}
