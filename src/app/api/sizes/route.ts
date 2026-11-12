import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";
import { sizeProductSchema } from "@/lib/sizes-validation";
import { snapshotFittings, type FitPerson, type FittingRecord } from "@/lib/size-fittings";
import { getDetailedSizeDefinition, getSizeVariants, isPantsProduct } from "@/lib/detailed-sizes";
import { changedExampleWithoutColor, confirmSizeExamples, needsExampleColor } from "@/lib/size-examples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const fields = "id,name,note,sizes,examples,fittings,active,show_in_availability,show_in_sizes,revision,updated_at,photo_count,stock_details";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: "Войдите на сайт заново." }, 401);
  const db = createAdminClient();
  // Paginate explicitly: don't silently truncate at Supabase's default row limit.
  const products = [];
  for (let offset = 0; ; offset += 200) {
    let query = db.from("size_products").select(fields).order("name").order("id").range(offset, offset + 199);
    if (session.role !== "admin") query = query.eq("active", true).eq("show_in_sizes", true).neq("sizes", "[]").gt("photo_count", 0);
    const { data, error } = await query;
    if (error) {
      logSupabaseError("size catalog read", error);
      return json({ error: session.role === "admin" ? "Не удалось открыть каталог. Проверьте миграцию 20261004_size_catalog.sql в Supabase." : "Каталог временно недоступен. Сообщите администратору." }, 503);
    }
    products.push(...(data ?? []).filter(p => session.role === "admin" || p.examples.length || p.fittings.length));
    if (!data || data.length < 200) break;
  }
  return json({ products });
}
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "admin") return json({ error: "Только администратор может менять каталог." }, 403);
  // Next.js may reconstruct request.url with an internal hostname behind a proxy.
  // Browser Origin must match the actual HTTP Host, never an arbitrary input URL.
  let sameOrigin = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    sameOrigin = ["https:", "http:"].includes(origin.protocol) && origin.host === request.headers.get("host");
  } catch { /* Missing/malformed Origin is rejected. */ }
  if (!sameOrigin) return json({ error: "Недопустимый источник запроса." }, 403);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 2500000) return json({ error: "Слишком большой запрос. Уменьшите фотографии." }, 413);
  // Bounded reader also covers chunked requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Нет данных карточки." }, 400);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 2500000) { await reader.cancel(); return json({ error: "Слишком большой запрос." }, 413); }
      chunks.push(value);
    }
  } catch { return json({ error: "Не удалось прочитать запрос." }, 400); }
  let input: unknown;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json({ error: "Некорректные данные карточки." }, 400); }
  const parsed = sizeProductSchema.safeParse(input);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля." }, 400);
  const { id, revision, photo, photos, fittings, ...values } = parsed.data;
  const incomingPhotos = photos ?? (photo ? [photo] : undefined);
  if (!id && !incomingPhotos?.length) return json({ error: "Добавьте фотографию вещи." }, 400);
  if (incomingPhotos) for (const candidate of incomingPhotos) {
    const image = Buffer.from(candidate.split(",")[1], "base64");
    if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff || image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9)
      return json({ error: "Некорректная фотография. Выберите другой файл." }, 400);
  }
  const db = createAdminClient();
  const current = id ? await db.from("size_products").select("examples,fittings,revision,stock_details,photo_count").eq("id", id).maybeSingle() : null;
  if (current?.error) { logSupabaseError("size catalog current read", current.error); return json({ error: "Не удалось прочитать карточку." }, 503); }
  if (id && (!current?.data || current.data.revision !== revision)) return json({ error: "Карточка уже изменена. Откройте её заново." }, 409);
  const examples = confirmSizeExamples(values.examples, current?.data?.examples ?? []);
  const candidate = { ...values, id: id ?? "preview", revision: revision ?? 1, updated_at: "", photo_count: 1, stock_details: current?.data?.stock_details };
  const colors = getSizeVariants(candidate).map(v => v.id);
  if (examples.some(r => r.colorId && r.colorId !== "all" && !colors.includes(r.colorId)))
    return json({ error: "Проверьте цвет каждой рекомендации: цвета карточки изменились." }, 400);
  if (needsExampleColor(id ? getDetailedSizeDefinition(id) : undefined) && changedExampleWithoutColor(values.examples, current?.data?.examples ?? []))
    return json({ error: "Для новой или изменённой рекомендации укажите цвет: у этой модели цвета отличаются по размеру." }, 400);
  let savedFittings: FittingRecord[] | undefined;
  if (fittings !== undefined) {
    const { data: people, error } = await db.from("size_fit_people").select("*");
    if (error) { logSupabaseError("fitting snapshot profiles", error); return json({ error: "Не удалось проверить профили примерки." }, 503); }
    try {
      if (fittings.some(r => !colors.includes(r.colorId))) return json({ error: "Проверьте цвет каждой примерки: цвета карточки изменились." }, 400);
      savedFittings = snapshotFittings(fittings, current?.data?.fittings ?? [], people as FitPerson[], isPantsProduct(candidate));
    } catch (e) { return json({ error: e instanceof Error ? e.message : "Проверьте примерки." }, 400); }
  }
  if (id && values.active && values.show_in_sizes !== false && !incomingPhotos?.length) {
    if (current?.data && current.data.photo_count < 1) return json({ error: "Добавьте фотографию для подбора размеров." }, 400);
  }
  const row = { ...values, examples, ...(savedFittings !== undefined ? { fittings: savedFittings } : {}), ...(incomingPhotos ? { photo: incomingPhotos[0], photos: incomingPhotos, photo_count: incomingPhotos.length } : {}), updated_at: new Date().toISOString() };
  const { data, error } = id
    ? await db.from("size_products").update({ ...row, revision: revision! + 1 }).eq("id", id).eq("revision", revision!).select(fields).maybeSingle()
    : await db.from("size_products").insert({ ...row, show_in_availability: values.show_in_availability ?? false, show_in_sizes: values.show_in_sizes ?? true, revision: 1 }).select(fields).single();
  if (error) { logSupabaseError("size catalog save", error); return json({ error: "Не удалось сохранить. Проверьте подключение и миграцию каталога." }, 503); }
  if (!data) return json({ error: "Карточку уже изменили в другом окне. Скопируйте свои правки, закройте редактор и откройте карточку заново." }, 409);
  return json({ product: data });
}
