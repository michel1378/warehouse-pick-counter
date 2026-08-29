"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions";

export function LoginForm({ action, label }: { action: (state: FormState, data: FormData) => Promise<FormState>; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card login-form">
      <label htmlFor="pin">PIN-код</label>
      <input id="pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password" autoFocus required minLength={4} maxLength={32} />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button className="primary" disabled={pending}>{pending ? "Вход…" : label}</button>
    </form>
  );
}
