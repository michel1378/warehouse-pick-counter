import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";
import type { AppSession } from "@/types";
import { createAdminClient, logSupabaseError } from "@/lib/supabase";

const COOKIE_NAME = "warehouse_session";
const secret = () => new TextEncoder().encode(env().SESSION_SECRET);

export async function createSession(user: AppSession) {
  const employee = user.role === "employee";
  // Employee identity only: names and access rights are read from the database.
  const payload = employee ? { role: "employee" } : { name: user.name, role: user.role, employeeRole: user.employeeRole, permissions: user.permissions };
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(employee ? "14d" : "12h")
    .sign(secret());
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: employee ? "lax" : "strict",
    path: "/",
    maxAge: employee ? 60 * 60 * 24 * 14 : 60 * 60 * 12,
  });
}

export async function getSession(): Promise<AppSession | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"], requiredClaims: ["sub", "exp", "iat"] });
    if (!payload.sub) return null;
    if (payload.role === "admin") {
      if (typeof payload.name !== "string") return null;
      return { sub: payload.sub, name: payload.name, role: "admin" };
    }
    if (payload.role !== "employee") return null;
    // No cross-request cache: deactivation and permission changes apply on the next request.
    // This also validates existing employee cookies issued before persistent login.
    const { data: employee, error } = await createAdminClient().from("employees")
      .select("id,name,active,role,permissions").eq("id", payload.sub).maybeSingle();
    if (error) {
      logSupabaseError("employee session validation", error);
      return null;
    }
    if (!employee || employee.active !== true) return null;
    const permissions = employee.permissions ?? (employee.role === "online" ? ["attendance"] : ["picking"]);
    if (!Array.isArray(permissions)) return null;
    const allowed = permissions.filter((permission): permission is string =>
      typeof permission === "string" && ["attendance", "picking", "reviews"].includes(permission));
    if (!allowed.length) return null;
    return { sub: employee.id, name: employee.name, role: "employee",
      employeeRole: employee.role === "online" ? "online" : "warehouse", permissions: allowed };
  } catch {
    return null;
  }
}

export async function clearSession() {
  (await cookies()).delete(COOKIE_NAME);
}
