"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions";

export function SubmitForm({ action, children, className = "form" }: { action: (state: FormState, data: FormData) => Promise<FormState>; children: React.ReactNode; className?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.ok && <p className="success" role="status">{state.ok}</p>}
      <button className="primary" disabled={pending}>{pending ? "Сохранение…" : "Сохранить"}</button>
    </form>
  );
}
