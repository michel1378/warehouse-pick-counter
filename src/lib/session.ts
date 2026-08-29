import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";
import type { AppSession, SessionRole } from "@/types";

const COOKIE_NAME = "warehouse_session";
const secret = () => new TextEncoder().encode(env().SESSION_SECRET);

export async function createSession(user: AppSession) {
  const token = await new SignJWT({ name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function getSession(): Promise<AppSession | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || typeof payload.name !== "string" || (payload.role !== "employee" && payload.role !== "admin")) return null;
    return { sub: payload.sub, name: payload.name, role: payload.role as SessionRole };
  } catch {
    return null;
  }
}

export async function clearSession() {
  (await cookies()).delete(COOKIE_NAME);
}
