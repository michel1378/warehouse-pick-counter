import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";
import { sizeProductSchema } from "@/lib/sizes-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const fields = "id,name,note,sizes,examples,active,revision,updated_at,photo_count";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: "Войдите на сайт заново." }, 401);
  const db = createAdminClient();
  // Paginate explicitly: don't silently truncate at Supabase's default row limit.
  const products = [];
  for (let offset = 0; ; offset += 200) {
    let query = db.from("size_products").select(fields).order("name").order("id").range(offset, offset + 199);
    if (session.role !== "admin") query = query.eq("active", true);
    const { data, error } = await query;
    if (error) {
      logSupabaseError("size catalog read", error);
      return json({ error: session.role === "admin" ? "Не удалось открыть каталог. Проверьте миграцию 20261004_size_catalog.sql в Supabase." : "Каталог временно недоступен. Сообщите администратору." }, 503);
    }
    products.push(...(data ?? []));
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
  const { id, revision, photo, photos, ...values } = parsed.data;
  const incomingPhotos = photos ?? (photo ? [photo] : undefined);
  if (!id && !incomingPhotos?.length) return json({ error: "Добавьте фотографию вещи." }, 400);
  if (incomingPhotos) for (const candidate of incomingPhotos) {
    const image = Buffer.from(candidate.split(",")[1], "base64");
    if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff || image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9)
      return json({ error: "Некорректная фотография. Выберите другой файл." }, 400);
  }
  const db = createAdminClient();
  const row = { ...values, ...(incomingPhotos ? { photo: incomingPhotos[0], photos: incomingPhotos, photo_count: incomingPhotos.length } : {}), updated_at: new Date().toISOString() };
  const { data, error } = id
    ? await db.from("size_products").update({ ...row, revision: revision! + 1 }).eq("id", id).eq("revision", revision!).select(fields).maybeSingle()
    : await db.from("size_products").insert({ ...row, revision: 1 }).select(fields).single();
  if (error) { logSupabaseError("size catalog save", error); return json({ error: "Не удалось сохранить. Проверьте подключение и миграцию каталога." }, 503); }
  if (!data) return json({ error: "Карточку уже изменили в другом окне. Скопируйте свои правки, закройте редактор и откройте карточку заново." }, 409);
  return json({ product: data });
}
