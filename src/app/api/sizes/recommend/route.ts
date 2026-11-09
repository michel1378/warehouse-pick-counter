import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";
import { sizeProfileSchema } from "@/lib/size-profile";
import { sizeAiInputSchema } from "@/lib/sizes-ai";
import { cachedSizeResult, composeSizeResult, hasPendingSizeDecisions, planSizeRecommendation, resolveSizePlan } from "@/lib/size-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return json({ error: "Войдите на сайт заново." }, 401);
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    if (!["http:", "https:"].includes(origin.protocol) || origin.host !== request.headers.get("host")) throw new Error();
  } catch { return json({ error: "Недопустимый источник запроса." }, 403); }
  if (Number(request.headers.get("content-length") ?? 0) > 2048) return json({ error: "Слишком большой запрос." }, 413);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Укажите параметры клиента." }, 400);
  let bytes = 0; const chunks: Uint8Array[] = [];
  let input: unknown;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 2048) { await reader.cancel(); return json({ error: "Слишком большой запрос." }, 413); }
      chunks.push(value);
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return json({ error: "Некорректные параметры клиента." }, 400); }
  const parsed = sizeAiInputSchema.safeParse(input);
  if (!parsed.success) return json({ error: "Проверьте рост (100–230 см), вес (25–250 кг) и посадку. Полупояс необязателен; если указан — 20–100 см." }, 400);
  const db = createAdminClient();
  let query = db.from("size_products").select("id,name,note,sizes,examples,active,show_in_sizes,revision,size_profile,stock_details").eq("id", parsed.data.productId);
  if (session.role !== "admin") query = query.eq("active", true).eq("show_in_sizes", true);
  const { data: product, error } = await query.maybeSingle();
  if (error) { logSupabaseError("size AI product read", error); return json({ error: "Не удалось загрузить размерную таблицу. Сообщите администратору." }, 503); }
  if (!product) return json({ error: "Вещь недоступна. Обновите каталог." }, 404);
  if (product.revision !== parsed.data.revision) return json({ error: "Карточка изменилась. Обновите каталог и повторите подбор." }, 409);
  const profile = sizeProfileSchema.safeParse(product.size_profile);
  if (!profile.success && product.size_profile !== null) return json({ error: "Администратору нужно проверить размерную таблицу этой вещи." }, 409);
  if (parsed.data.colorKey && (!profile.success || !profile.data.colorGrids?.colors.some(color => color.key === parsed.data.colorKey)))
    return json({error:"Этот цвет недоступен. Обновите карточку и выберите цвет заново."},400);
  const plan = planSizeRecommendation(product, profile.success ? profile.data : null, parsed.data);
  if (!hasPendingSizeDecisions(plan)) return json({result:composeSizeResult(plan),revision:product.revision});
  const saved=cachedSizeResult(plan);if(saved)return json({result:saved,revision:product.revision});
  if (!process.env.OPENAI_API_KEY?.trim()) return json({result:composeSizeResult(plan,"not_configured"),revision:product.revision});
  // Atomic shared limit: concurrent requests and separate server instances use the same budget.
  const { data: allowed, error: limitError } = await db.rpc("take_size_ai_slot", { p_subject: session.sub });
  if (limitError) { logSupabaseError("size AI limit", limitError); return json({ error: "Подбор временно недоступен. Проверьте миграцию размерных таблиц." }, 503); }
  if (allowed !== true) return json({ result:composeSizeResult(plan,"limited"), retryAfterSeconds:5, revision:product.revision });
  try {
    const result = await resolveSizePlan(plan);
    return json({ result, revision: product.revision });
  } catch {
    // Provider messages may contain request content: never log or return them.
    return json({ error: "Не удалось получить надёжный ответ OpenAI. Повторите подбор позже или уточните мерки у владельца." }, 502);
  }
}
