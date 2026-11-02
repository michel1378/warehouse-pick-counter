import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";
import { availabilityFields, availabilitySaveSchema } from "@/lib/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: "Войдите на сайт заново." }, 401);
  const db = createAdminClient();
  const products = [];
  for (let offset = 0; ; offset += 200) {
    let query = db.from("size_products").select(availabilityFields).order("name").order("id").range(offset, offset + 199);
    if (session.role !== "admin") query = query.eq("active", true);
    const { data, error } = await query;
    if (error) {
      logSupabaseError("availability read", error);
      return json({ error: session.role === "admin" ? "Наличие недоступно. Примените миграцию availability из supabase/migrations." : "Наличие временно недоступно. Сообщите администратору." }, 503);
    }
    products.push(...(data ?? []));
    if (!data || data.length < 200) break;
  }
  return json({ products });
}
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: "Войдите на сайт заново." }, 401);
  if (session.role !== "admin") return json({ error: "Только администратор может менять наличие." }, 403);
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    if (!["http:", "https:"].includes(origin.protocol) || origin.host !== request.headers.get("host")) return json({ error: "Недопустимый источник запроса." }, 403);
  } catch { return json({ error: "Недопустимый источник запроса." }, 403); }
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Нет данных." }, 400);
  const chunks: Uint8Array[] = []; let length = 0;
  let input: unknown;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 2900000) { await reader.cancel(); return json({ error: "Фотографии слишком большие." }, 413); }
      chunks.push(value);
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return json({ error: "Некорректные данные." }, 400); }
  const parsed = availabilitySaveSchema.safeParse(input);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля." }, 400);
  const { id, revision, ...values } = parsed.data;
  const db = createAdminClient();
  const { data: current, error: readError } = await db.from("size_products").select("sizes,revision").eq("id", id).maybeSingle();
  if (readError) { logSupabaseError("availability validation", readError); return json({ error: "Не удалось прочитать товар." }, 503); }
  if (!current) return json({ error: "Товар не найден." }, 404);
  if (current.revision !== revision) return json({ error: "Товар уже изменили. Скопируйте правки и обновите каталог." }, 409);
  if (values.stock_details.colors.some(color => color.sizes?.some(size => !current.sizes.includes(size))))
    return json({ error: "Выберите размеры из существующего размерного ряда товара." }, 400);
  const row = { ...values, revision: revision + 1, updated_at: new Date().toISOString(),
    ...(values.stock_chart !== undefined ? { stock_has_chart: values.stock_chart !== null } : {}),
    ...(values.stock_models !== undefined ? { stock_model_count: values.stock_models.length } : {}),
  };
  const { data, error } = await db.from("size_products").update(row).eq("id", id).eq("revision", revision).select(availabilityFields).maybeSingle();
  if (error) { logSupabaseError("availability save", error); return json({ error: "Не удалось сохранить наличие. Проверьте миграцию и подключение." }, 503); }
  if (!data) return json({ error: "Товар уже изменили. Скопируйте правки и обновите каталог." }, 409);
  return json({ product: data });
}
