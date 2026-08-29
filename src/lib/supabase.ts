import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

function normalizeSupabaseUrl(value: string) {
  const url = new URL(value);
  const originalPath = url.pathname;
  url.pathname = url.pathname.replace(/\/(?:rest\/v1)?\/*$/, "");

  if (originalPath !== url.pathname && originalPath !== "/") {
    console.warn("[Supabase config] NEXT_PUBLIC_SUPABASE_URL contained an API path; using the project root URL.");
  }

  return url.toString().replace(/\/$/, "");
}

export function createAdminClient() {
  const config = env();
  return createClient(normalizeSupabaseUrl(config.NEXT_PUBLIC_SUPABASE_URL), config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type SupabaseError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
};

function redact(value: string | undefined) {
  if (!value) return undefined;
  return value
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/https:\/\/[^\s/]+\.supabase\.co/gi, "[REDACTED_SUPABASE_URL]");
}

export function logSupabaseError(context: string, error: SupabaseError) {
  console.error(`[Supabase] ${context}`, {
    code: error.code,
    status: error.status,
    message: redact(error.message),
    details: redact(error.details),
    hint: redact(error.hint),
  });
}
