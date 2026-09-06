"use client";

import { useEffect, useState } from "react";
import { finishTimeSession, startTimeSession } from "@/app/actions";

function duration(seconds: number) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  return `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, "0")} мин`;
}

export function WorkClock({ startedAt, completedSeconds }: { startedAt: string | null; completedSeconds: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!startedAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [startedAt]);
  const activeSeconds = startedAt ? (now - new Date(startedAt).getTime()) / 1000 : 0;
  return <section className="card attendance-clock"><p className="eyebrow">Статус</p><h2>{startedAt ? `Работает с ${new Date(startedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : "Не работает"}</h2><div className="time-metrics"><div><span>Сегодня</span><strong>{duration(completedSeconds + activeSeconds)}</strong></div><div><span>Текущая сессия</span><strong>{duration(activeSeconds)}</strong></div></div><form action={startedAt ? finishTimeSession : startTimeSession}><button className={startedAt ? "danger work-button" : "primary work-button"}>{startedAt ? "Закончить работу" : "Начать работу"}</button></form></section>;
}
