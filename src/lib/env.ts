import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  WAREHOUSE_TIMEZONE: z.string().default("Europe/Moscow"),
  SCANNER_AGENT_API_TOKEN: z.string().min(32),
});

export function env() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Некорректные переменные окружения: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  return parsed.data;
}
