"use client";
import { useEffect, useRef, useState } from "react";
import { FITS, FIT_LABELS, recommendSize, type Fit } from "@/lib/sizes";
import type { CatalogSizeProduct as SizeProduct } from "@/lib/catalog-visibility";
import { isTrousers, type SizeAiResult } from "@/lib/size-profile";
import { ColorSizeAnswers } from "./ColorSizeAnswers";

const emptyInput = { height: "", weight: "", halfWaist: "", shoulders: "", chestWidth: "", fit: "regular" as Fit };
const inRange = (value: string, min: number, max: number) => value !== "" && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;

export function SizeAiPicker({ product }: { product: SizeProduct }) {
  const [input, setInput] = useState(emptyInput);
  const [answer, setAnswer] = useState<{ body: string; result: SizeAiResult | null } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const profile = product.size_profile;
  const trousers = profile ? isTrousers(profile) : /брюк|джинс|штан/i.test(product.name);
  const valid = inRange(input.height, 100, 230) && inRange(input.weight, 25, 250)
    && (trousers ? !input.halfWaist || inRange(input.halfWaist, 20, 100)
      : (!input.shoulders || inRange(input.shoulders, 15, 100)) && (!input.chestWidth || inRange(input.chestWidth, 20, 150)));
  const body = valid ? JSON.stringify({ productId: product.id, revision: product.revision,
    height: Number(input.height), weight: Number(input.weight), fit: input.fit,
    ...(trousers && input.halfWaist ? { halfWaistCm: Number(input.halfWaist) } : {}),
    ...(!trousers && input.shoulders ? { shouldersCm: Number(input.shoulders) } : {}),
    ...(!trousers && input.chestWidth ? { chestWidthCm: Number(input.chestWidth) } : {}) }) : null;

  function change(values: Partial<typeof input>) {
    generation.current++;
    pending.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    setAnswer(null);
    setInput(previous => ({ ...previous, ...values }));
  }

  useEffect(() => {
    if (!body) return;
    const request = ++generation.current;
    const controller = new AbortController();
    pending.current = controller;
    const scheduled = setTimeout(async () => {
      if (controller.signal.aborted || request !== generation.current) return;
      try {
        let result: SizeAiResult;
        if (product.size_profile) {
          const response = await fetch("/api/sizes/recommend", {
            method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal,
          });
          if (!response.ok) throw new Error("SIZE_RECOMMENDATION_UNAVAILABLE");
          result = (await response.json()).result;
        } else {
          const customer = JSON.parse(body);
          const legacy = recommendSize(product, customer.height, customer.weight, customer.fit);
          result = { size: legacy.size, explanation: legacy.message, clarification: null, approximate: !!legacy.size };
        }
        if (!controller.signal.aborted && request === generation.current) setAnswer({ body, result });
      } catch {
        if (!controller.signal.aborted && request === generation.current) setAnswer({ body, result: null });
      }
    }, 500);
    timer.current = scheduled;
    return () => {
      clearTimeout(scheduled);
      controller.abort();
    };
  }, [body, product, input]);

  const current = answer?.body === body ? answer : null;
  const colors = current?.result?.colorResults ?? (current && profile?.colorGrids?.colors.map(color => ({ key: color.key, name: color.name, size: null })));
  return <div className="size-picker size-picker-compact" id={`picker-${product.id}`}>
    <div className="size-measurements">
      <label>Рост<input type="number" inputMode="decimal" min="100" max="230" step="any" required value={input.height} onChange={e => change({ height: e.target.value })} /></label>
      <label>Вес<input type="number" inputMode="decimal" min="25" max="250" step="any" required value={input.weight} onChange={e => change({ weight: e.target.value })} /></label>
      {trousers ? <label>Полупояс<input type="number" inputMode="decimal" min="20" max="100" step="any" value={input.halfWaist} onChange={e => change({ halfWaist: e.target.value })} /></label> : <>
        <label>Плечи<input type="number" inputMode="decimal" min="15" max="100" step="any" value={input.shoulders} onChange={e => change({ shoulders: e.target.value })} /></label>
        <label>Грудь<input type="number" inputMode="decimal" min="20" max="150" step="any" value={input.chestWidth} onChange={e => change({ chestWidth: e.target.value })} /></label>
      </>}
    </div>
    <fieldset className="size-fit"><legend>Посадка</legend>{FITS.map(fit => <label key={fit} className={input.fit === fit ? "selected" : ""}>
      <input type="radio" name={`fit-${product.id}`} checked={input.fit === fit} onChange={() => change({ fit })} />{fit === "regular" ? "В размер" : FIT_LABELS[fit]}
    </label>)}</fieldset>
    <div aria-live="polite" aria-atomic="true" aria-busy={!!body && !current} className="size-answer size-answer-compact">
      {colors ? <ColorSizeAnswers colors={colors}/> : current ? <p className="size-final-choice"><span className="size-color-name">Размер: </span><strong className="size-result-value">{current.result?.size && (current.result.approximate || (trousers ? !input.halfWaist : !input.shoulders || !input.chestWidth)) ? "≈ " : ""}{current.result?.size ?? "—"}</strong></p> : null}
    </div>
    <button type="button" className="secondary" onClick={() => change(emptyInput)}>Новый клиент</button>
  </div>;
}
