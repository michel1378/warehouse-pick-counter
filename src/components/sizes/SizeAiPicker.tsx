"use client";
import { useEffect, useRef, useState } from "react";
import { FITS, FIT_LABELS, type Fit } from "@/lib/sizes";
import type { CatalogSizeProduct as SizeProduct } from "@/lib/catalog-visibility";
import { isTrousers, type SizeAiResult } from "@/lib/size-profile";
import { ColorSizeAnswers } from "./ColorSizeAnswers";

const emptyInput = { height: "", weight: "", age: "", halfWaist: "", shoulders: "", chestWidth: "", fit: "regular" as Fit };
const inRange = (value: string, min: number, max: number) => value !== "" && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;

export function SizeAiPicker({ product }: { product: SizeProduct }) {
  const [input, setInput] = useState(emptyInput);
  const [answer, setAnswer] = useState<{ body: string; result: SizeAiResult | null } | null>(null);
  const [freshProduct,setFreshProduct]=useState<SizeProduct|null>(null);
  const refreshAttempts=useRef(new Set<string>());
  const pending = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const selected=freshProduct?.id===product.id&&freshProduct.revision>=product.revision?freshProduct:product;
  const profile = selected.size_profile;
  const trousers = profile ? isTrousers(profile) : /брюк|джинс|штан/i.test(selected.name);
  const valid = inRange(input.height, 40, 230) && inRange(input.weight, 2, 250) && (!input.age || inRange(input.age,0,110))
    && (trousers ? !input.halfWaist || inRange(input.halfWaist, 10, 100)
      : (!input.shoulders || inRange(input.shoulders, 10, 100)) && (!input.chestWidth || inRange(input.chestWidth, 10, 150)));
  const body = valid ? JSON.stringify({ productId: selected.id, revision: selected.revision,
    height: Number(input.height), weight: Number(input.weight), fit: input.fit,
    ...(input.age ? {ageYears:Number(input.age)} : {}),
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
      let failure="Повторите подбор позже";
      try {
        let result: SizeAiResult;
        for(let attempt=0;;attempt++) {
          const response = await fetch("/api/sizes/recommend", {
            method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal,
          });
          const data = await response.json();
          if(!response.ok){
            failure=response.status===401?"Войдите на сайт заново":response.status===409?"Обновите карточку или проверьте сетку":response.status===400?"Проверьте введённые параметры":"Подбор временно недоступен";
            const versionKey=selected.id+":"+selected.revision;
            if(response.status===409&&!refreshAttempts.current.has(versionKey)){
              refreshAttempts.current.add(versionKey);
              const catalog=await fetch("/api/sizes",{cache:"no-store",signal:controller.signal});
              if(catalog.status===401)failure="Войдите на сайт заново";
              if(catalog.ok){
                const next=(await catalog.json()).products?.find((row:SizeProduct)=>row.id===selected.id);
                if(next&&next.revision!==selected.revision&&request===generation.current&&!controller.signal.aborted){setAnswer(null);setFreshProduct(next);return;}
              }
            }
            throw new Error("SIZE_RECOMMENDATION_UNAVAILABLE");
          }
          result=data.result;
          if(data.retryAfterSeconds && attempt < 1){
            if(!controller.signal.aborted&&request===generation.current)setAnswer({body,result});
            await new Promise<void>(resolve=>{
              const retry=setTimeout(done,Math.min(10,Math.max(1,data.retryAfterSeconds))*1000);
              function done(){clearTimeout(retry);controller.signal.removeEventListener("abort",done);resolve();}
              controller.signal.addEventListener("abort",done,{once:true});
            });
            if(controller.signal.aborted||request!==generation.current)return;
          }else break;
        }
        if (!controller.signal.aborted && request === generation.current) setAnswer({ body, result });
      } catch {
        if (!controller.signal.aborted && request === generation.current) setAnswer({ body, result:{size:null,explanation:"",clarification:failure,providerStatus:"unavailable"} });
      }
    }, 500);
    timer.current = scheduled;
    return () => {
      clearTimeout(scheduled);
      controller.abort();
    };
  }, [body, selected, input]);

  const current = answer?.body === body ? answer : null;
  const colors = current?.result?.colorResults ?? (current && profile?.colorGrids?.colors.map(color => ({ key: color.key, name: color.name, size: null, clarification:current.result?.clarification??"Повторите подбор позже" })));
  return <div className="size-picker size-picker-compact" id={`picker-${product.id}`}>
    <div className="size-measurements">
      <label>Рост<input type="number" inputMode="decimal" min="40" max="230" step="any" required value={input.height} onChange={e => change({ height: e.target.value })} /></label>
      <label>Вес<input type="number" inputMode="decimal" min="2" max="250" step="any" required value={input.weight} onChange={e => change({ weight: e.target.value })} /></label>
      {trousers ? <label>Полупояс<input type="number" inputMode="decimal" min="10" max="100" step="any" value={input.halfWaist} onChange={e => change({ halfWaist: e.target.value })} /></label> : <>
        <label>Плечи<input type="number" inputMode="decimal" min="10" max="100" step="any" value={input.shoulders} onChange={e => change({ shoulders: e.target.value })} /></label>
        <label>Грудь<input type="number" inputMode="decimal" min="10" max="150" step="any" value={input.chestWidth} onChange={e => change({ chestWidth: e.target.value })} /></label>
      </>}
      <label>Возраст<input type="number" inputMode="decimal" min="0" max="110" step="any" value={input.age} onChange={e=>change({age:e.target.value})}/></label>
    </div>
    <fieldset className="size-fit"><legend>Посадка</legend>{FITS.map(fit => <label key={fit} className={input.fit === fit ? "selected" : ""}>
      <input type="radio" name={`fit-${product.id}`} checked={input.fit === fit} onChange={() => change({ fit })} />{fit === "regular" ? "В размер" : FIT_LABELS[fit]}
    </label>)}</fieldset>
    <div aria-live="polite" aria-atomic="true" aria-busy={!!body && !current} className="size-answer size-answer-compact">
      {colors ? <ColorSizeAnswers colors={colors}/> : current ? <p className="size-final-choice">{current.result?.size ? <><span className="size-color-name">Размер: </span><strong className="size-result-value">{current.result.approximate ? "≈ " : ""}{current.result.size}</strong></> : <span className="size-clarification">{current.result?.clarification??"Повторите подбор позже"}</span>}</p> : null}
    </div>
    <button type="button" className="secondary" onClick={() => {refreshAttempts.current.clear();change(emptyInput);}}>Новый клиент</button>
  </div>;
}
