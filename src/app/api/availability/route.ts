import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";
import { availabilityCreateSchema, availabilityFields, availabilitySaveSchema } from "@/lib/availability";

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
    if (session.role !== "admin") query = query.eq("active", true).eq("show_in_availability", true);
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
      if (length > 4300000) { await reader.cancel(); return json({ error: "Суммарный размер фотографий слишком большой. Загрузите часть фото сейчас, остальные — после сохранения." }, 413); }
      chunks.push(value);
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return json({ error: "Некорректные данные." }, 400); }
  const creating = typeof input === "object" && input !== null && !("id" in input);
  if (creating) {
    const parsed = availabilityCreateSchema.safeParse(input);
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля." }, 400);
    const { photos, ...values } = parsed.data;
    if (values.stock_details.colors.some(color => color.sizes?.some(size => !values.sizes.includes(size))))
      return json({ error: "Добавьте выбранные размеры в размерный ряд товара." }, 400);
    const db = createAdminClient();
    const { data, error } = await db.from("size_products").insert({
      ...values, photo: photos[0] ?? "", photos, photo_count: photos.length,
      active: true, examples: [], revision: 1,
      stock_has_chart: Boolean(values.stock_chart), stock_model_count: values.stock_models?.length ?? 0,
    }).select(availabilityFields).single();
    if (error) { logSupabaseError("availability create", error); return json({ error: "Не удалось создать позицию. Проверьте миграцию создания позиций и подключение." }, 503); }
    return json({ product: data }, 201);
  }
  const parsed = availabilitySaveSchema.safeParse(input);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля." }, 400);
  const { id, revision, photos, stock_models, ...values } = parsed.data;
  const db = createAdminClient();
  const needsPhotos = photos?.some(photo => typeof photo !== "string");
  const needsModels = stock_models?.some(photo => typeof photo !== "string");
  const currentFields = "sizes,examples,revision" + (needsPhotos ? ",photo,photos" : "") + (needsModels ? ",stock_models" : "");
  const { data: currentData, error: readError } = await db.from("size_products").select(currentFields).eq("id", id).maybeSingle();
  const current = currentData as unknown as { sizes: string[]; examples: { size: string }[]; revision: number; photo?: string; photos?: string[]; stock_models?: string[] } | null;
  if (readError) { logSupabaseError("availability validation", readError); return json({ error: "Не удалось прочитать товар." }, 503); }
  if (!current) return json({ error: "Товар не найден." }, 404);
  if (current.revision !== revision) return json({ error: "Товар уже изменили. Скопируйте правки и обновите каталог." }, 409);
  // References are resolved only from this product at the checked revision, never from client URLs.
  const resolveImages = (incoming: typeof photos, stored: string[]): string[] | undefined => incoming?.map(photo => {
    if (typeof photo === "string") return photo;
    const saved = stored[photo.index];
    if (!saved) throw new Error("Сохранённая фотография не найдена. Обновите карточку.");
    return saved;
  });
  let resolvedPhotos: string[] | undefined, resolvedModels: string[] | undefined;
  try {
    const storedPhotos = needsPhotos ? [...(current.photos ?? [])] : [];
    if (needsPhotos && current.photo) storedPhotos[0] = current.photo;
    resolvedPhotos = resolveImages(photos, storedPhotos);
    resolvedModels = resolveImages(stock_models, needsModels ? current.stock_models ?? [] : []);
  } catch { return json({ error: "Сохранённая фотография не найдена. Обновите карточку." }, 400); }
  const sizes: string[] = values.sizes ?? current.sizes;
  if (values.sizes && (current.examples ?? []).some((example: { size: string }) => !sizes.includes(example.size)))
    return json({ error: "Нельзя удалить размер, используемый в примерах подбора. Проверьте примеры в разделе «Размеры»." }, 400);
  if (values.stock_details.colors.some(color => color.sizes?.some(size => !sizes.includes(size))))
    return json({ error: "Выберите размеры из существующего размерного ряда товара." }, 400);
  const row = { ...values, revision: revision + 1, updated_at: new Date().toISOString(),
    ...(resolvedPhotos !== undefined ? { photo: resolvedPhotos[0] ?? "", photos: resolvedPhotos, photo_count: resolvedPhotos.length } : {}),
    ...(values.stock_chart !== undefined ? { stock_has_chart: values.stock_chart !== null } : {}),
    ...(resolvedModels !== undefined ? { stock_models: resolvedModels, stock_model_count: resolvedModels.length } : {}),
  };
  const { data, error } = await db.from("size_products").update(row).eq("id", id).eq("revision", revision).select(availabilityFields).maybeSingle();
  if (error) { logSupabaseError("availability save", error); return json({ error: "Не удалось сохранить наличие. Проверьте миграцию и подключение." }, 503); }
  if (!data) return json({ error: "Товар уже изменили. Скопируйте правки и обновите каталог." }, 409);
  return json({ product: data });
}
