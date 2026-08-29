"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { clearSession, createSession, getSession } from "@/lib/session";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";
import type { ScanResult } from "@/types";
import { isScannerInput } from "@/lib/scanner-policy";

export type FormState = { error?: string; ok?: string };

const pinSchema = z.string().trim().min(4, "PIN должен содержать минимум 4 символа").max(32);

export async function loginEmployee(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = pinSchema.safeParse(formData.get("pin"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const db = createAdminClient();
  const { data, error } = await db.from("employees").select("id,name,pin_hash").eq("active", true);
  if (error) {
    logSupabaseError("employee login query failed", error);
    return { error: "Не удалось подключиться к базе" };
  }
  for (const employee of data ?? []) {
    if (await bcrypt.compare(parsed.data, employee.pin_hash)) {
      await createSession({ sub: employee.id, name: employee.name, role: "employee" });
      redirect("/scan");
    }
  }
  return { error: "Неверный PIN или сотрудник отключен" };
}

export async function loginAdmin(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = pinSchema.safeParse(formData.get("pin"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const db = createAdminClient();
  const { data, error } = await db.from("admins").select("id,name,pin_hash").eq("active", true);
  if (error) {
    logSupabaseError("admin login query failed", error);
    return { error: "Не удалось подключиться к базе" };
  }
  for (const admin of data ?? []) {
    if (await bcrypt.compare(parsed.data, admin.pin_hash)) {
      await createSession({ sub: admin.id, name: admin.name, role: "admin" });
      redirect("/admin");
    }
  }
  return { error: "Неверный PIN администратора" };
}

export async function logout() {
  await clearSession();
  redirect("/");
}

export async function registerBarcode(barcode: string, durationMs: number, wasPaste: boolean): Promise<ScanResult> {
  const session = await getSession();
  if (!session || session.role !== "employee") throw new Error("UNAUTHORIZED");
  const clean = barcode.trim();
  if (!clean || clean.length > 512) throw new Error("INVALID_BARCODE");
  const safeDurationMs = Math.max(0, Math.min(Math.round(durationMs), 600_000));
  const scannerInput = isScannerInput(clean, { durationMs: safeDurationMs, wasPaste });
  const db = createAdminClient();
  const { data, error } = await db.rpc("register_scan", {
    p_barcode: clean,
    p_employee_id: session.sub,
    p_duration_ms: safeDurationMs,
    p_was_paste: wasPaste || !scannerInput,
  });
  if (error || !data?.[0]) throw new Error(error?.message ?? "SCAN_FAILED");
  const row = data[0];
  revalidatePath("/scan");
  if (row.input_type === "manual") return { success: false, reason: "manual" };
  return row.success
    ? { success: true, scannedAt: row.scanned_at }
    : { success: false, reason: "duplicate", scannedAt: row.scanned_at, employeeName: row.original_employee_name };
}

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") throw new Error("UNAUTHORIZED");
}

export async function saveEmployee(_: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const schema = z.object({
    id: z.string().uuid().optional().or(z.literal("")),
    name: z.string().trim().min(1, "Введите имя").max(120),
    pin: z.string().trim().max(32),
  });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, name, pin } = parsed.data;
  if (!id && !pinSchema.safeParse(pin).success) return { error: "Для нового сотрудника задайте PIN от 4 символов" };
  const db = createAdminClient();
  const values: { name: string; pin_hash?: string } = { name };
  if (pin) values.pin_hash = await bcrypt.hash(pin, 12);
  const result = id
    ? await db.from("employees").update(values).eq("id", id)
    : await db.from("employees").insert(values as { name: string; pin_hash: string });
  if (result.error) return { error: "Не удалось сохранить сотрудника" };
  revalidatePath("/admin/employees");
  return { ok: id ? "Данные обновлены" : "Сотрудник добавлен" };
}

export async function toggleEmployee(formData: FormData) {
  await requireAdmin();
  const id = z.string().uuid().parse(formData.get("id"));
  const active = formData.get("active") === "true";
  const { error } = await createAdminClient().from("employees").update({ active }).eq("id", id);
  if (error) throw new Error("Не удалось изменить статус");
  revalidatePath("/admin/employees");
}

export async function updatePrice(_: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = z.coerce.number().min(0).max(1_000_000).safeParse(formData.get("price"));
  if (!parsed.success) return { error: "Введите корректную ставку" };
  const { error } = await createAdminClient().from("settings").update({ price_per_order: parsed.data }).eq("id", 1);
  if (error) return { error: "Не удалось изменить ставку" };
  revalidatePath("/admin");
  return { ok: "Ставка сохранена" };
}
