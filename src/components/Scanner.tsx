"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { registerBarcode } from "@/app/actions";

type Notice = { kind: "success" | "duplicate" | "error"; text: string } | null;

export function Scanner({ initialCount, initialAmount, price }: { initialCount: number; initialAmount: number; price: number }) {
  const [count, setCount] = useState(initialCount);
  const [amount, setAmount] = useState(initialAmount);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number | null>(null);
  const pasted = useRef(false);

  const focus = () => input.current?.focus({ preventScroll: true });
  useEffect(() => {
    focus();
    const refocus = () => requestAnimationFrame(focus);
    window.addEventListener("pointerdown", refocus);
    window.addEventListener("focus", refocus);
    return () => {
      window.removeEventListener("pointerdown", refocus);
      window.removeEventListener("focus", refocus);
    };
  }, []);

  function show(next: Notice) {
    setNotice(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 1800);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const barcode = input.current?.value.trim() ?? "";
    if (!barcode || pending) { focus(); return; }
    const durationMs = startedAt.current === null ? 600_000 : Math.max(0, performance.now() - startedAt.current);
    const wasPaste = pasted.current;
    if (input.current) input.current.value = "";
    startedAt.current = null;
    pasted.current = false;
    startTransition(async () => {
      try {
        const result = await registerBarcode(barcode, durationMs, wasPaste);
        if (result.success) {
          setCount((v) => v + 1); setAmount((v) => v + price);
          show({ kind: "success", text: "Засчитано +1" });
        } else if (result.reason === "duplicate") {
          show({ kind: "duplicate", text: "Дубль — не засчитан" });
        } else {
          show({ kind: "error", text: "Ручной ввод — не засчитан" });
        }
      } catch { show({ kind: "error", text: "Ошибка сохранения. Проверьте соединение и повторите скан." }); }
      finally { requestAnimationFrame(focus); }
    });
  }

  return <>
    <section className="metric-grid"><div className="metric"><span>Заказов сегодня</span><strong>{count}</strong></div><div className="metric"><span>Заработано сегодня</span><strong>{amount.toLocaleString("ru-RU")} ₽</strong></div></section>
    <div className={`scanner-status ${pending ? "busy" : ""}`}><span className="status-dot" />{pending ? "Сохраняем…" : "Сканер готов"}</div>
    <form onSubmit={submit} className="scanner-form">
      <label htmlFor="barcode" className="visually-hidden">Ввод сканера</label>
      <input ref={input} id="barcode" name="barcode" className="scanner-input" aria-label="Ввод сканера штрихкодов" autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={pending}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { pasted.current = true; event.preventDefault(); return; }
          if (event.key.length === 1 && startedAt.current === null) startedAt.current = performance.now();
          if (["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) event.preventDefault();
        }}
        onPaste={(event) => { pasted.current = true; event.preventDefault(); }}
        onDrop={(event) => event.preventDefault()}
        onBlur={() => requestAnimationFrame(focus)} />
    </form>
    <div className="notice-space" aria-live="assertive">{notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}</div>
  </>;
}
